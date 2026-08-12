import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/agent.js";
import type { AgentLlmClient } from "../src/agent.js";
import type { AgentConfig } from "../src/config.js";
import { toolRegistry } from "../src/tools.js";

let sandboxDirectory: string;

function createConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    projectRoot: sandboxDirectory,
    model: "test-model",
    ollamaBaseUrl: "http://localhost:11434",
    numCtx: 1024,
    keepAlive: "0s",
    maxSteps: 5,
    maxFileBytes: 12_000,
    maxDirectoryEntries: 100,
    sandboxDirectory,
    verbose: false,
    ...overrides,
  };
}

function createSequencedClient(
  responses: string[],
  requirements = [{ description: "Completar la solicitud.", kind: "content" as const }],
): {
  client: AgentLlmClient;
  prompts: string[];
  formats: unknown[];
} {
  const prompts: string[] = [];
  const formats: unknown[] = [];
  const plannedResponses = [
    JSON.stringify({
      type: "task_requirements",
      requirements,
    }),
    ...responses.map((response) => {
      try {
        const decision: unknown = JSON.parse(response);

        if (typeof decision !== "object" || decision === null || !("type" in decision)) {
          return response;
        }

        if (decision.type === "tool_call") {
          return JSON.stringify(decision);
        }

        if (decision.type === "final_answer") {
          const evidence = "evidence" in decision ? decision.evidence : undefined;

          return JSON.stringify({
            ...decision,
            resolved_requirements:
              "resolved_requirements" in decision
                ? decision.resolved_requirements
                : Array.isArray(evidence)
                  ? [{ id: "req-1", evidence }]
                  : [],
          });
        }
      } catch {
        return response;
      }

      return response;
    }),
  ];
  let index = 0;

  return {
    client: {
      async generate(prompt, format) {
        prompts.push(prompt);
        formats.push(format);
        const response = plannedResponses[index];
        index++;

        if (response === undefined) {
          throw new Error("El cliente simulado no recibió una respuesta configurada.");
        }

        return { response };
      },
    },
    prompts,
    formats,
  };
}

beforeEach(async () => {
  sandboxDirectory = await mkdtemp(join(tmpdir(), "lux-agent-sandbox-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(sandboxDirectory, { recursive: true, force: true });
});

describe("runAgent", () => {
  it("rejects a response that is not syntactically valid JSON", async () => {
    const { client, prompts } = createSequencedClient(["{respuesta rota"]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "El modelo no produjo JSON válido:",
    );
    expect(prompts).toHaveLength(2);
  });

  it("rejects a decision that does not satisfy the schema", async () => {
    const { client } = createSequencedClient([
      JSON.stringify({ type: "tool_call", tool: 42, arguments: {} }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "La decisión fue rechazada por Zod.",
    );
  });

  it("rejects a final answer when there is no evidence", async () => {
    const { client, prompts } = createSequencedClient([
      JSON.stringify({
        type: "final_answer",
        answer: "Respuesta indebida.",
        evidence: ["obs-1"],
      }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "El modelo intentó finalizar en un estado no permitido.",
    );
    expect(prompts).toHaveLength(2);
  });

  it("does not offer final_answer in the schema while there is no evidence", async () => {
    const { client, formats } = createSequencedClient([
      JSON.stringify({
        type: "final_answer",
        answer: "Respuesta indebida.",
        evidence: ["obs-1"],
      }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "El modelo intentó finalizar en un estado no permitido.",
    );

    const receivedSchema = JSON.stringify(formats[1]);
    expect(receivedSchema).not.toContain("final_answer");
    expect(receivedSchema).toContain("read_file");
    expect(receivedSchema).toContain("list_directory");
  });

  it("uses DIRECTORY_EVIDENCE after listing and accepts a valid reference", async () => {
    const { client, prompts, formats } = createSequencedClient(
      [
        JSON.stringify({
          type: "tool_call",
          tool: "list_directory",
          arguments: { path: "." },
        }),
        JSON.stringify({
          type: "final_answer",
          answer: "Directorio inspeccionado.",
          evidence: ["obs-1"],
        }),
      ],
      [{ description: "Descubrir el directorio.", kind: "discovery" }],
    );

    await expect(runAgent("Responde brevemente.", createConfig(), client)).resolves.toBe(
      "Directorio inspeccionado.",
    );
    expect(prompts[2]).toContain("Estado de evidencia actual: DIRECTORY_EVIDENCE.");
    const secondStepSchema = JSON.stringify(formats[2]);
    expect(secondStepSchema).toContain("final_answer");
    expect(secondStepSchema).toContain("obs-1");
  });

  it("allows list_directory to resolve a discovery requirement", async () => {
    const { client } = createSequencedClient(
      [
        JSON.stringify({
          type: "tool_call",
          tool: "list_directory",
          arguments: { path: "." },
        }),
        JSON.stringify({
          type: "final_answer",
          answer: "Hay archivos disponibles.",
          evidence: ["obs-1"],
          resolved_requirements: [{ id: "req-1", evidence: ["obs-1"] }],
        }),
      ],
      [{ description: "Descubrir archivos disponibles.", kind: "discovery" }],
    );

    await expect(runAgent("¿Qué archivos hay?", createConfig(), client)).resolves.toBe(
      "Hay archivos disponibles.",
    );
  });

  it("rejects list_directory as evidence for a content requirement", async () => {
    const { client } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({
        type: "final_answer",
        answer: "Respuesta indebida.",
        evidence: ["obs-1"],
        resolved_requirements: [{ id: "req-1", evidence: ["obs-1"] }],
      }),
    ]);

    await expect(runAgent("Dime el autor.", createConfig(), client)).rejects.toThrow(
      "La evidencia obs-1 no puede resolver el requisito req-1 de tipo content.",
    );
  });

  it("uses FILE_EVIDENCE and assigns unique IDs to successful observations", async () => {
    await writeFile(join(sandboxDirectory, "note.md"), "contenido");
    const { client, prompts } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "note.md" },
      }),
      JSON.stringify({
        type: "final_answer",
        answer: "Archivo leído.",
        evidence: ["obs-1", "obs-2"],
        resolved_requirements: [{ id: "req-1", evidence: ["obs-2"] }],
      }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).resolves.toBe(
      "Archivo leído.",
    );
    expect(prompts[3]).toContain("Estado de evidencia actual: FILE_EVIDENCE.");
    expect(prompts[3]).toContain('"id": "obs-1"');
    expect(prompts[3]).toContain('"id": "obs-2"');
  });

  it("rejects a partial final answer when a requirement remains pending", async () => {
    await writeFile(
      join(sandboxDirectory, "example-package.json"),
      '{"scripts":{"test":"vitest run"}}',
    );
    const { client } = createSequencedClient(
      [
        JSON.stringify({
          type: "tool_call",
          tool: "list_directory",
          arguments: { path: "." },
        }),
        JSON.stringify({
          type: "tool_call",
          tool: "read_file",
          arguments: { path: "example-package.json" },
        }),
        JSON.stringify({
          type: "final_answer",
          answer: "El proyecto usa Vitest.",
          evidence: ["obs-2"],
          resolved_requirements: [{ id: "req-2", evidence: ["obs-2"] }],
        }),
      ],
      [
        { description: "Encontrar el nombre del autor.", kind: "content" },
        { description: "Encontrar la herramienta de tests.", kind: "content" },
      ],
    );

    await expect(
      runAgent(
        "dime el nombre del autor y qué herramienta usa el proyecto para ejecutar los tests",
        createConfig(),
        client,
      ),
    ).rejects.toThrow("No se puede finalizar: requisitos pendientes: req-1.");
  });

  it("rejects a final answer that omits evidence used by a resolved requirement", async () => {
    await writeFile(join(sandboxDirectory, "author.md"), "Autor: Mich DM");
    await writeFile(join(sandboxDirectory, "tests.json"), '{"test":"vitest run"}');
    const { client } = createSequencedClient(
      [
        JSON.stringify({
          type: "tool_call",
          tool: "read_file",
          arguments: { path: "author.md" },
        }),
        JSON.stringify({
          type: "tool_call",
          tool: "read_file",
          arguments: { path: "tests.json" },
        }),
        JSON.stringify({
          type: "final_answer",
          answer: "Respuesta incompleta en trazabilidad.",
          evidence: ["obs-1"],
          resolved_requirements: [
            { id: "req-1", evidence: ["obs-1"] },
            { id: "req-2", evidence: ["obs-2"] },
          ],
        }),
      ],
      [
        { description: "Encontrar el autor.", kind: "content" },
        { description: "Encontrar la herramienta de tests.", kind: "content" },
      ],
    );

    await expect(runAgent("Completa la tarea.", createConfig(), client)).rejects.toThrow(
      "final_answer.evidence debe incluir la evidencia de requisitos resueltos: obs-2.",
    );
  });

  it("completes a multi-requirement task only after each requirement has evidence", async () => {
    await writeFile(
      join(sandboxDirectory, "example-package.json"),
      '{"scripts":{"test":"vitest run"}}',
    );
    await writeFile(join(sandboxDirectory, "notes.md"), "Autor: Mich DM");
    const { client, prompts } = createSequencedClient(
      [
        JSON.stringify({
          type: "tool_call",
          tool: "list_directory",
          arguments: { path: "." },
        }),
        JSON.stringify({
          type: "tool_call",
          tool: "read_file",
          arguments: { path: "example-package.json" },
        }),
        JSON.stringify({
          type: "tool_call",
          tool: "read_file",
          arguments: { path: "notes.md" },
        }),
        JSON.stringify({
          type: "final_answer",
          answer: "El autor es Mich DM y los tests usan Vitest.",
          evidence: ["obs-2", "obs-3"],
          resolved_requirements: [
            { id: "req-1", evidence: ["obs-3"] },
            { id: "req-2", evidence: ["obs-2"] },
          ],
        }),
      ],
      [
        { description: "Encontrar el nombre del autor.", kind: "content" },
        { description: "Encontrar la herramienta de tests.", kind: "content" },
      ],
    );

    await expect(
      runAgent(
        "dime el nombre del autor y qué herramienta usa el proyecto para ejecutar los tests",
        createConfig(),
        client,
      ),
    ).resolves.toBe("El autor es Mich DM y los tests usan Vitest.");
    expect(prompts[4]).toContain('"id": "req-2"');
    expect(prompts[4]).toContain('"status": "pending"');
    expect(prompts[4]).toContain('"id": "obs-2"');
    expect(prompts[4]).toContain('"id": "obs-3"');
  });

  it("rejects a requirement resolution for an unknown requirement", async () => {
    const { client } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({
        type: "final_answer",
        answer: "Respuesta indebida.",
        evidence: ["obs-1"],
        resolved_requirements: [{ id: "req-99", evidence: ["obs-1"] }],
      }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "El requisito req-99 no existe en la tarea actual.",
    );
  });

  it("rejects a final answer that references an observation that does not exist", async () => {
    const { client } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({
        type: "final_answer",
        answer: "Respuesta indebida.",
        evidence: ["obs-99"],
      }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "La evidencia obs-99 no existe en el agent loop actual.",
    );
  });

  it("rejects a final answer that references a failed observation", async () => {
    const { client } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "../outside.md" },
      }),
      JSON.stringify({
        type: "final_answer",
        answer: "Respuesta indebida.",
        evidence: ["obs-2"],
      }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "La evidencia obs-2 no corresponde a una observación exitosa.",
    );
  });

  it("blocks a duplicate successful tool call without executing it again", async () => {
    const listDirectory = toolRegistry.get("list_directory");

    if (!listDirectory) {
      throw new Error("list_directory no está registrada.");
    }

    const executeSpy = vi.spyOn(listDirectory, "execute");
    const { client, prompts } = createSequencedClient(
      [
        JSON.stringify({
          type: "tool_call",
          tool: "list_directory",
          arguments: { path: "." },
        }),
        JSON.stringify({
          type: "tool_call",
          tool: "list_directory",
          arguments: { path: "." },
        }),
        JSON.stringify({
          type: "final_answer",
          answer: "Directorio reutilizado.",
          evidence: ["obs-1"],
        }),
      ],
      [{ description: "Descubrir el directorio.", kind: "discovery" }],
    );

    await expect(runAgent("Responde brevemente.", createConfig(), client)).resolves.toBe(
      "Directorio reutilizado.",
    );
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(prompts[3]).toContain('"id": "obs-2"');
    expect(prompts[3]).toContain('"status": "blocked"');
    expect(prompts[3]).toContain('"reason": "duplicate_successful_tool_call"');
    expect(prompts[3]).toContain('"existingObservationId": "obs-1"');
  });

  it("rejects a final answer that references a blocked observation", async () => {
    const { client } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({
        type: "final_answer",
        answer: "Respuesta indebida.",
        evidence: ["obs-2"],
      }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "La evidencia obs-2 no corresponde a una observación exitosa.",
    );
  });

  it("allows the same tool with different arguments", async () => {
    await writeFile(join(sandboxDirectory, "first.md"), "primero");
    await writeFile(join(sandboxDirectory, "second.md"), "segundo");
    const readFile = toolRegistry.get("read_file");

    if (!readFile) {
      throw new Error("read_file no está registrada.");
    }

    const executeSpy = vi.spyOn(readFile, "execute");
    const { client } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "first.md" },
      }),
      JSON.stringify({
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "second.md" },
      }),
      JSON.stringify({
        type: "final_answer",
        answer: "Dos archivos leídos.",
        evidence: ["obs-1", "obs-2"],
      }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).resolves.toBe(
      "Dos archivos leídos.",
    );
    expect(executeSpy).toHaveBeenCalledTimes(2);
  });

  it("does not block a repeated tool call after its earlier execution failed", async () => {
    const readFile = toolRegistry.get("read_file");

    if (!readFile) {
      throw new Error("read_file no está registrada.");
    }

    const executeSpy = vi.spyOn(readFile, "execute");
    const { client, prompts } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "../outside.md" },
      }),
      JSON.stringify({
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "../outside.md" },
      }),
    ]);

    await expect(
      runAgent("Responde brevemente.", createConfig({ maxSteps: 3 }), client),
    ).rejects.toThrow("El agente alcanzó el límite de 3 pasos sin terminar.");
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(prompts[2]).toContain('"status": "error"');
    expect(prompts[2]).not.toContain('"status": "blocked"');
  });

  it("records a tool error and lets a later valid final answer finish", async () => {
    const { client, prompts } = createSequencedClient(
      [
        JSON.stringify({
          type: "tool_call",
          tool: "list_directory",
          arguments: { path: "." },
        }),
        JSON.stringify({
          type: "tool_call",
          tool: "read_file",
          arguments: { path: "../outside.md" },
        }),
        JSON.stringify({
          type: "final_answer",
          answer: "La ruta fue rechazada.",
          evidence: ["obs-1"],
        }),
      ],
      [{ description: "Descubrir el directorio.", kind: "discovery" }],
    );

    await expect(runAgent("Completa la tarea.", createConfig(), client)).resolves.toBe(
      "La ruta fue rechazada.",
    );
    expect(prompts).toHaveLength(4);
    expect(prompts[3]).toContain('"id": "obs-2"');
    expect(prompts[3]).toContain('"status": "error"');
    expect(prompts[3]).toContain("La ruta intenta salir de la carpeta sandbox.");
  });

  it("stops after the configured maximum number of non-terminal steps", async () => {
    const { client, prompts } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
    ]);

    await expect(
      runAgent("Completa la tarea.", createConfig({ maxSteps: 2 }), client),
    ).rejects.toThrow("El agente alcanzó el límite de 2 pasos sin terminar.");
    expect(prompts).toHaveLength(2);
  });

  it("requires evidence in every final answer", async () => {
    const { client } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
      }),
      JSON.stringify({ type: "final_answer", answer: "Respuesta simulada." }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "La decisión fue rechazada por Zod.",
    );
  });
});
