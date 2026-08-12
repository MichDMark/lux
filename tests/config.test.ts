import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const environmentKeys = [
  "OLLAMA_MODEL",
  "OLLAMA_BASE_URL",
  "OLLAMA_NUM_CTX",
  "OLLAMA_KEEP_ALIVE",
  "AGENT_MAX_STEPS",
  "MAX_FILE_BYTES",
  "MAX_DIRECTORY_ENTRIES",
  "SANDBOX_DIR",
  "AGENT_VERBOSE",
] as const;

const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("loadConfig", () => {
  it("uses the documented defaults", () => {
    for (const key of environmentKeys) {
      delete process.env[key];
    }

    const config = loadConfig();

    expect(config).toMatchObject({
      model: "gemma4:e2b",
      ollamaBaseUrl: "http://localhost:11434",
      numCtx: 4096,
      keepAlive: "5m",
      maxSteps: 7,
      maxFileBytes: 12_000,
      maxDirectoryEntries: 100,
      verbose: true,
    });
    expect(config.sandboxDirectory).toBe(resolve(config.projectRoot, "sandbox"));
  });

  it("gives CLI overrides priority over environment values", () => {
    process.env.OLLAMA_MODEL = "from-environment";
    process.env.SANDBOX_DIR = "environment-sandbox";

    const config = loadConfig({
      model: "from-cli",
      sandboxDirectory: "cli-sandbox",
      maxSteps: 3,
      numCtx: 1024,
      verbose: false,
    });

    expect(config.model).toBe("from-cli");
    expect(config.sandboxDirectory).toBe(resolve(config.projectRoot, "cli-sandbox"));
    expect(config.maxSteps).toBe(3);
    expect(config.numCtx).toBe(1024);
    expect(config.verbose).toBe(false);
  });

  it("rejects invalid environment values", () => {
    process.env.AGENT_MAX_STEPS = "0";

    expect(() => loadConfig()).toThrow();
  });
});
