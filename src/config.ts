import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

try {
  loadEnvFile();
} catch (error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  if (code !== "ENOENT") {
    throw error;
  }
}

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));

const EnvironmentSchema = z.object({
  OLLAMA_MODEL: z.string().min(1).default("gemma4:e2b"),
  OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(4096),
  OLLAMA_KEEP_ALIVE: z.string().min(1).default("5m"),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().max(50).default(5),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(12_000),
  MAX_DIRECTORY_ENTRIES: z.coerce.number().int().positive().default(100),
  SANDBOX_DIR: z.string().min(1).default("sandbox"),
  AGENT_VERBOSE: z
    .string()
    .default("true")
    .transform((value) => !["false", "0", "no"].includes(value.toLowerCase())),
});

export type CliOverrides = {
  model?: string;
  sandboxDirectory?: string;
  maxSteps?: number;
  numCtx?: number;
  verbose?: boolean;
};

export type AgentConfig = {
  projectRoot: string;
  model: string;
  ollamaBaseUrl: string;
  numCtx: number;
  keepAlive: string;
  maxSteps: number;
  maxFileBytes: number;
  maxDirectoryEntries: number;
  sandboxDirectory: string;
  verbose: boolean;
};

export function loadConfig(overrides: CliOverrides = {}): AgentConfig {
  const env = EnvironmentSchema.parse(process.env);
  const sandboxValue = overrides.sandboxDirectory ?? env.SANDBOX_DIR;

  return {
    projectRoot: PROJECT_ROOT,
    model: overrides.model ?? env.OLLAMA_MODEL,
    ollamaBaseUrl: env.OLLAMA_BASE_URL.replace(/\/+$/, ""),
    numCtx: overrides.numCtx ?? env.OLLAMA_NUM_CTX,
    keepAlive: env.OLLAMA_KEEP_ALIVE,
    maxSteps: overrides.maxSteps ?? env.AGENT_MAX_STEPS,
    maxFileBytes: env.MAX_FILE_BYTES,
    maxDirectoryEntries: env.MAX_DIRECTORY_ENTRIES,
    sandboxDirectory: isAbsolute(sandboxValue)
      ? resolve(sandboxValue)
      : resolve(PROJECT_ROOT, sandboxValue),
    verbose: overrides.verbose ?? env.AGENT_VERBOSE,
  };
}
