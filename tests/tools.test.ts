import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../src/config.js";
import { Tracer } from "../src/tracer.js";
import { toolRegistry } from "../src/tools.js";

let sandboxDirectory: string;
let outsideDirectory: string;

function createConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    projectRoot: sandboxDirectory,
    model: "test-model",
    ollamaBaseUrl: "http://localhost:11434",
    numCtx: 1024,
    keepAlive: "0s",
    requestTimeoutMs: 120_000,
    maxSteps: 5,
    maxFileBytes: 32,
    maxDirectoryEntries: 2,
    maxSearchFiles: 100,
    maxSearchMatches: 20,
    maxSearchSnippetChars: 300,
    sandboxDirectory,
    verbose: false,
    ...overrides,
  };
}

async function executeTool(
  name: string,
  argumentsValue: unknown,
  config = createConfig(),
): Promise<unknown> {
  const tool = toolRegistry.get(name);

  if (!tool) {
    throw new Error(`La tool ${name} no está registrada.`);
  }

  return tool.execute(argumentsValue, {
    config,
    tracer: new Tracer(false),
  });
}

beforeEach(async () => {
  sandboxDirectory = await mkdtemp(join(tmpdir(), "lux-sandbox-"));
  outsideDirectory = await mkdtemp(join(tmpdir(), "lux-outside-"));
});

afterEach(async () => {
  await Promise.all([
    rm(sandboxDirectory, { recursive: true, force: true }),
    rm(outsideDirectory, { recursive: true, force: true }),
  ]);
});

describe("read_file", () => {
  it("reads an allowed text file inside the sandbox", async () => {
    await writeFile(join(sandboxDirectory, "note.md"), "contenido seguro");

    await expect(executeTool("read_file", { path: "note.md" })).resolves.toMatchObject({
      kind: "file",
      path: "note.md",
      bytes: 16,
      content: "contenido seguro",
    });
  });

  it("rejects absolute paths and parent-directory escapes", async () => {
    await expect(
      executeTool("read_file", { path: join(outsideDirectory, "outside.md") }),
    ).rejects.toThrow("rutas absolutas");
    await expect(
      executeTool("read_file", { path: "../outside.md" }),
    ).rejects.toThrow("salir de la carpeta sandbox");
  });

  it("rejects non-permitted extensions and oversized files", async () => {
    await writeFile(join(sandboxDirectory, "secret.env"), "value");
    await writeFile(join(sandboxDirectory, "large.md"), "x".repeat(33));

    await expect(executeTool("read_file", { path: "secret.env" })).rejects.toThrow(
      "no está permitida",
    );
    await expect(executeTool("read_file", { path: "large.md" })).rejects.toThrow(
      "supera el máximo",
    );
  });

  it("rejects directories and symlinks that resolve outside the sandbox", async () => {
    await mkdir(join(sandboxDirectory, "folder"));
    await writeFile(join(outsideDirectory, "outside.md"), "outside");
    await symlink(join(outsideDirectory, "outside.md"), join(sandboxDirectory, "escape.md"));

    await expect(executeTool("read_file", { path: "folder" })).rejects.toThrow(
      "no está permitida",
    );
    await expect(executeTool("read_file", { path: "escape.md" })).rejects.toThrow(
      "fuera de sandbox",
    );
  });
});

describe("list_directory", () => {
  it("returns sorted entries and marks truncated output", async () => {
    await writeFile(join(sandboxDirectory, "zeta.md"), "z");
    await writeFile(join(sandboxDirectory, "alpha.txt"), "a");
    await mkdir(join(sandboxDirectory, "middle"));

    await expect(executeTool("list_directory", { path: "." })).resolves.toEqual({
      kind: "directory",
      path: ".",
      entries: [
        { name: "alpha.txt", type: "file" },
        { name: "middle", type: "directory" },
      ],
      truncated: true,
    });
  });

  it("rejects a file, an absolute path, and a parent-directory escape", async () => {
    await writeFile(join(sandboxDirectory, "note.md"), "note");

    await expect(executeTool("list_directory", { path: "note.md" })).rejects.toThrow(
      "no corresponde a un directorio",
    );
    await expect(
      executeTool("list_directory", { path: sandboxDirectory }),
    ).rejects.toThrow("rutas absolutas");
    await expect(
      executeTool("list_directory", { path: ".." }),
    ).rejects.toThrow("salir de la carpeta sandbox");
  });
});

describe("search_text", () => {
  it("finds case-insensitive matches in allowed nested files", async () => {
    await mkdir(join(sandboxDirectory, "nested"));
    await writeFile(join(sandboxDirectory, "ignored.env"), "Autor: secreto");
    await writeFile(
      join(sandboxDirectory, "nested", "notes.md"),
      "Primera linea\nAUTOR: Mich DM\n",
    );

    await expect(executeTool("search_text", { path: ".", query: "autor" })).resolves.toEqual({
      kind: "search",
      path: ".",
      query: "autor",
      matches: [{ path: "nested/notes.md", line: 2, text: "AUTOR: Mich DM" }],
      scannedFiles: 1,
      truncated: false,
    });
  });

  it("limits matches and snippets", async () => {
    await writeFile(join(sandboxDirectory, "notes.md"), "Autor: Mich DM\nAutor: Otro");

    await expect(
      executeTool(
        "search_text",
        { path: ".", query: "autor" },
        createConfig({ maxSearchMatches: 1, maxSearchSnippetChars: 8 }),
      ),
    ).resolves.toEqual({
      kind: "search",
      path: ".",
      query: "autor",
      matches: [{ path: "notes.md", line: 1, text: "Autor: M..." }],
      scannedFiles: 1,
      truncated: true,
    });
  });

  it("skips oversized files and respects the file scan limit", async () => {
    await writeFile(join(sandboxDirectory, "large.md"), "x".repeat(33));
    await writeFile(join(sandboxDirectory, "first.md"), "Autor: Uno");
    await writeFile(join(sandboxDirectory, "second.md"), "Autor: Dos");

    await expect(
      executeTool(
        "search_text",
        { path: ".", query: "autor" },
        createConfig({ maxSearchFiles: 1 }),
      ),
    ).resolves.toMatchObject({
      matches: [{ path: "first.md", line: 1, text: "Autor: Uno" }],
      scannedFiles: 1,
      truncated: true,
    });
  });

  it("does not follow symbolic links", async () => {
    await writeFile(join(outsideDirectory, "outside.md"), "Autor: externo");
    await symlink(join(outsideDirectory, "outside.md"), join(sandboxDirectory, "escape.md"));

    await expect(
      executeTool("search_text", { path: ".", query: "autor" }),
    ).resolves.toMatchObject({
      matches: [],
      scannedFiles: 0,
      truncated: false,
    });
  });

  it("rejects a file, an absolute path, and a parent-directory escape", async () => {
    await writeFile(join(sandboxDirectory, "note.md"), "Autor: Mich DM");

    await expect(
      executeTool("search_text", { path: "note.md", query: "autor" }),
    ).rejects.toThrow("no corresponde a un directorio");
    await expect(
      executeTool("search_text", { path: sandboxDirectory, query: "autor" }),
    ).rejects.toThrow("rutas absolutas");
    await expect(
      executeTool("search_text", { path: "..", query: "autor" }),
    ).rejects.toThrow("salir de la carpeta sandbox");
  });
});
