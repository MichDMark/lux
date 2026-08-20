import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    requestTimeoutMs: 120_000,
    maxSteps: 7,
    maxFileBytes: 12_000,
    maxDirectoryEntries: 100,
    maxSearchFiles: 100,
    maxSearchMatches: 20,
    maxSearchSnippetChars: 300,
    sandboxDirectory,
    verbose: false,
    ...overrides,
  };
}

function createClient(decisions: unknown[]): {
  client: AgentLlmClient;
  prompts: string[];
  formats: unknown[];
} {
  const responses = decisions.map((decision) => JSON.stringify(decision));
  const prompts: string[] = [];
  const formats: unknown[] = [];
  let index = 0;

  return {
    client: {
      async generate(prompt, format) {
        prompts.push(prompt);
        formats.push(format);
        const response = responses[index++];

        if (response === undefined) {
          throw new Error("El cliente simulado no recibió una respuesta configurada.");
        }

        return { response, requestDurationMs: 0 };
      },
    },
    prompts,
    formats,
  };
}

const contentRequirement = {
  type: "task_requirements",
  requirements: [{ description: "Encontrar el autor.", kind: "content" }],
};

beforeEach(async () => {
  sandboxDirectory = await mkdtemp(join(tmpdir(), "lux-agent-sandbox-"));
});

afterEach(async () => {
  await rm(sandboxDirectory, { recursive: true, force: true });
});

describe("runAgent", () => {
  it("rejects malformed JSON", async () => {
    const client: AgentLlmClient = {
      async generate() {
        return { response: "{broken", requestDurationMs: 0 };
      },
    };

    await expect(runAgent("Completa la tarea.", createConfig(), client)).rejects.toThrow(
      "El modelo no produjo JSON válido:",
    );
  });

  it("requires search_text before read_file can resolve content", async () => {
    await writeFile(join(sandboxDirectory, "notes.md"), "Autor: Mich DM");
    const { client, formats } = createClient([
      contentRequirement,
      {
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
        for_requirements: ["req-1"],
      },
      {
        type: "tool_call",
        tool: "search_text",
        arguments: { path: ".", query: "autor" },
        for_requirements: ["req-1"],
      },
      {
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "notes.md" },
        for_requirements: ["req-1"],
      },
      {
        type: "final_answer",
        evidence: ["obs-3"],
        answers: [{ id: "req-1", answer: "Mich DM", evidence: ["obs-3"] }],
      },
    ]);

    await expect(runAgent("Dime el autor.", createConfig(), client)).resolves.toBe("Mich DM");
    expect(JSON.stringify(formats[2])).not.toContain("final_answer");
    expect(JSON.stringify(formats[3])).not.toContain("final_answer");
    expect(JSON.stringify(formats[4])).toContain("final_answer");
  });

  it("blocks a final answer until every same-file content requirement has a search", async () => {
    await writeFile(
      join(sandboxDirectory, "notes.md"),
      "Autor: Mich DM\nPelicula Favorita: Iron Man 1",
    );
    const { client, prompts } = createClient([
      {
        type: "task_requirements",
        requirements: [
          { description: "Autor.", kind: "content" },
          { description: "Pelicula favorita.", kind: "content" },
        ],
      },
      {
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
        for_requirements: ["req-1", "req-2"],
      },
      {
        type: "tool_call",
        tool: "search_text",
        arguments: { path: ".", query: "autor" },
        for_requirements: ["req-1"],
      },
      {
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "notes.md" },
        for_requirements: ["req-1"],
      },
      {
        type: "final_answer",
        evidence: ["obs-3"],
        answers: [
          { id: "req-1", answer: "Mich DM", evidence: ["obs-3"] },
          { id: "req-2", answer: "Iron Man 1", evidence: ["obs-3"] },
        ],
      },
      {
        type: "tool_call",
        tool: "search_text",
        arguments: { path: ".", query: "pelicula favorita" },
        for_requirements: ["req-2"],
      },
      {
        type: "final_answer",
        evidence: ["obs-3"],
        answers: [
          { id: "req-1", answer: "Autor: Mich DM", evidence: ["obs-3"] },
          { id: "req-2", answer: "Pelicula favorita: Iron Man 1", evidence: ["obs-3"] },
        ],
      },
    ]);

    await expect(runAgent("Completa la tarea.", createConfig(), client)).resolves.toBe(
      "Autor: Mich DM\nPelicula favorita: Iron Man 1",
    );
    expect(prompts[5]).toContain('"id": "feedback-1"');
  });

  it("requires independent searches and reads for different files", async () => {
    await writeFile(join(sandboxDirectory, "author.md"), "Autor: Mich DM");
    await writeFile(join(sandboxDirectory, "package.json"), '{"devDependencies":{"vitest":"4"}}');
    const { client } = createClient([
      {
        type: "task_requirements",
        requirements: [
          { description: "Autor.", kind: "content" },
          { description: "devDependencies.", kind: "content" },
        ],
      },
      {
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
        for_requirements: ["req-1", "req-2"],
      },
      {
        type: "tool_call",
        tool: "search_text",
        arguments: { path: ".", query: "autor" },
        for_requirements: ["req-1"],
      },
      {
        type: "tool_call",
        tool: "search_text",
        arguments: { path: ".", query: "devDependencies" },
        for_requirements: ["req-2"],
      },
      {
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "author.md" },
        for_requirements: ["req-1"],
      },
      {
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "package.json" },
        for_requirements: ["req-2"],
      },
      {
        type: "final_answer",
        evidence: ["obs-4", "obs-5"],
        answers: [
          { id: "req-1", answer: "Autor: Mich DM", evidence: ["obs-4"] },
          { id: "req-2", answer: "devDependencies: vitest", evidence: ["obs-5"] },
        ],
      },
    ]);

    await expect(runAgent("Completa la tarea.", createConfig(), client)).resolves.toBe(
      "Autor: Mich DM\ndevDependencies: vitest",
    );
  });

  it("rejects a read_file path not found by the requirement search", async () => {
    await writeFile(join(sandboxDirectory, "notes.md"), "Autor: Mich DM");
    await writeFile(join(sandboxDirectory, "other.md"), "otro contenido");
    const { client, prompts } = createClient([
      contentRequirement,
      {
        type: "tool_call",
        tool: "search_text",
        arguments: { path: ".", query: "autor" },
        for_requirements: ["req-1"],
      },
      {
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "other.md" },
        for_requirements: ["req-1"],
      },
      {
        type: "tool_call",
        tool: "read_file",
        arguments: { path: "notes.md" },
        for_requirements: ["req-1"],
      },
    ]);

    await expect(
      runAgent("Completa la tarea.", createConfig({ maxSteps: 4 }), client),
    ).rejects.toThrow("El agente alcanzó el límite de 4 pasos sin terminar.");
    expect(prompts[3]).toContain("read_file debe usar una ruta encontrada por search_text");
  });

  it("returns discovery evidence only when list_directory targets the requirement", async () => {
    const { client } = createClient([
      {
        type: "task_requirements",
        requirements: [{ description: "Listar archivos.", kind: "discovery" }],
      },
      {
        type: "tool_call",
        tool: "list_directory",
        arguments: { path: "." },
        for_requirements: ["req-1"],
      },
      {
        type: "final_answer",
        evidence: ["obs-1"],
        answers: [{ id: "req-1", answer: "No hay archivos.", evidence: ["obs-1"] }],
      },
    ]);

    await expect(runAgent("Lista archivos.", createConfig(), client)).resolves.toBe(
      "No hay archivos.",
    );
  });
});
