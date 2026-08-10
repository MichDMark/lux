import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { AgentConfig } from "./config.js";
import type { Tracer } from "./tracer.js";

export type ToolContext = {
  config: AgentConfig;
  tracer: Tracer;
};

export type ToolDefinition = {
  name: string;
  description: string;
  argumentsJsonSchema: Record<string, unknown>;
  parseArguments(value: unknown): unknown;
  execute(argumentsValue: unknown, context: ToolContext): Promise<unknown>;
};

const PathArgumentsSchema = z.strictObject({
  path: z.string().min(1).max(200),
});

type PathArguments = z.infer<typeof PathArgumentsSchema>;

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);

  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveSandboxPath(
  requestedPath: string,
  context: ToolContext,
): Promise<string> {
  context.tracer.log("SEGURIDAD", `Validando ruta: ${requestedPath}`);

  if (isAbsolute(requestedPath)) {
    throw new Error("No se aceptan rutas absolutas.");
  }

  const candidatePath = resolve(context.config.sandboxDirectory, requestedPath);

  if (!isPathInside(context.config.sandboxDirectory, candidatePath)) {
    throw new Error("La ruta intenta salir de la carpeta sandbox.");
  }

  try {
    const realSandbox = await realpath(context.config.sandboxDirectory);
    const realCandidate = await realpath(candidatePath);

    if (!isPathInside(realSandbox, realCandidate)) {
      throw new Error("La ruta resuelta está fuera de sandbox.");
    }

    return realCandidate;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("fuera de sandbox")) {
      throw error;
    }

    throw new Error(`No se pudo localizar la ruta: ${errorMessage(error)}`);
  }
}

const pathArgumentsJsonSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

const allowedExtensions = new Set([".txt", ".md", ".json", ".ts"]);

const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Lee el contenido de un archivo de texto dentro de sandbox.",
  argumentsJsonSchema: pathArgumentsJsonSchema,
  parseArguments: (value) => PathArgumentsSchema.parse(value),

  async execute(argumentsValue: unknown, context: ToolContext): Promise<unknown> {
    const args = PathArgumentsSchema.parse(argumentsValue);
    const realFilePath = await resolveSandboxPath(args.path, context);
    const extension = extname(realFilePath).toLowerCase();

    if (!allowedExtensions.has(extension)) {
      throw new Error(
        `La extensión ${extension || "(sin extensión)"} no está permitida.`,
      );
    }

    const fileStats = await stat(realFilePath);

    if (!fileStats.isFile()) {
      throw new Error("La ruta no corresponde a un archivo.");
    }

    if (fileStats.size > context.config.maxFileBytes) {
      throw new Error(
        `El archivo mide ${fileStats.size} bytes y supera el máximo de ${context.config.maxFileBytes}.`,
      );
    }

    return {
      kind: "file",
      path: args.path,
      bytes: fileStats.size,
      content: await readFile(realFilePath, "utf8"),
    };
  },
};

const listDirectoryTool: ToolDefinition = {
  name: "list_directory",
  description:
    "Lista nombres y tipos dentro de un directorio de sandbox; no devuelve el contenido de los archivos.",
  argumentsJsonSchema: pathArgumentsJsonSchema,
  parseArguments: (value) => PathArgumentsSchema.parse(value),

  async execute(argumentsValue: unknown, context: ToolContext): Promise<unknown> {
    const args = PathArgumentsSchema.parse(argumentsValue);
    const realDirectoryPath = await resolveSandboxPath(args.path, context);
    const directoryStats = await stat(realDirectoryPath);

    if (!directoryStats.isDirectory()) {
      throw new Error("La ruta no corresponde a un directorio.");
    }

    const entries = (await readdir(realDirectoryPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));

    const visibleEntries = entries.slice(0, context.config.maxDirectoryEntries);

    return {
      kind: "directory",
      path: args.path,
      entries: visibleEntries.map((entry) => ({
        name: entry.name,
        type: entry.isFile()
          ? "file"
          : entry.isDirectory()
            ? "directory"
            : entry.isSymbolicLink()
              ? "symbolic_link"
              : "other",
      })),
      truncated: entries.length > context.config.maxDirectoryEntries,
    };
  },
};

const tools = [readFileTool, listDirectoryTool];

export const toolRegistry = new Map(
  tools.map((tool) => [tool.name, tool] as const),
);

export function listTools(): ToolDefinition[] {
  return [...toolRegistry.values()];
}
