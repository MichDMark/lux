import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/agent.js";
import type { AgentLlmClient } from "../src/agent.js";
import type { AgentConfig } from "../src/config.js";

let sandboxDirectory: string;

function createConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    projectRoot: sandboxDirectory,
    model: "test-model",
    ollamaBaseUrl: "http://localhost:11434",
    numCtx: 1024,
    keepAlive: "0s",
    maxSteps: 3,
    maxFileBytes: 12_000,
    maxDirectoryEntries: 100,
    sandboxDirectory,
    verbose: false,
    ...overrides,
  };
}

function createSequencedClient(responses: string[]): {
  client: AgentLlmClient;
  prompts: string[];
} {
  const prompts: string[] = [];
  let index = 0;

  return {
    client: {
      async generate(prompt) {
        prompts.push(prompt);
        const response = responses[index];
        index++;

        if (response === undefined) {
          throw new Error("El cliente simulado no recibió una respuesta configurada.");
        }

        return { response };
      },
    },
    prompts,
  };
}

beforeEach(async () => {
  sandboxDirectory = await mkdtemp(join(tmpdir(), "lux-agent-sandbox-"));
});

afterEach(async () => {
  await rm(sandboxDirectory, { recursive: true, force: true });
});

describe("runAgent", () => {
  it("rejects a response that is not syntactically valid JSON", async () => {
    const { client, prompts } = createSequencedClient(["{respuesta rota"]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "El modelo no produjo JSON válido:",
    );
    expect(prompts).toHaveLength(1);
  });

  it("rejects a decision that does not satisfy the schema", async () => {
    const { client } = createSequencedClient([
      JSON.stringify({ type: "tool_call", tool: 42, arguments: {} }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).rejects.toThrow(
      "La decisión fue rechazada por Zod.",
    );
  });

  it("rejects a final answer when file evidence is still required", async () => {
    const { client, prompts } = createSequencedClient([
      JSON.stringify({ type: "final_answer", answer: "Respuesta indebida." }),
    ]);

    await expect(runAgent("Revisa la configuración", createConfig(), client)).rejects.toThrow(
      "El modelo intentó finalizar en un estado no permitido.",
    );
    expect(prompts).toHaveLength(1);
  });

  it("records a tool error and lets a later valid final answer finish", async () => {
    const { client, prompts } = createSequencedClient([
      JSON.stringify({
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "../outside.md" },
      }),
      JSON.stringify({ type: "final_answer", answer: "La ruta fue rechazada." }),
    ]);

    await expect(runAgent("Completa la tarea.", createConfig(), client)).resolves.toBe(
      "La ruta fue rechazada.",
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('"status": "error"');
    expect(prompts[1]).toContain("La ruta intenta salir de la carpeta sandbox.");
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

  it("returns a valid final answer without calling a real Ollama client", async () => {
    const { client, prompts } = createSequencedClient([
      JSON.stringify({ type: "final_answer", answer: "Respuesta simulada." }),
    ]);

    await expect(runAgent("Responde brevemente.", createConfig(), client)).resolves.toBe(
      "Respuesta simulada.",
    );
    expect(prompts).toHaveLength(1);
  });
});
