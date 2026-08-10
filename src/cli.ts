import { z } from "zod";
import { loadConfig } from "./config.js";
import type { CliOverrides } from "./config.js";
import { OllamaClient } from "./ollama-client.js";
import { runAgent } from "./agent.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePositiveInteger(value: string, option: string): number {
  const result = z.coerce.number().int().positive().safeParse(value);

  if (!result.success) {
    throw new Error(`${option} debe ser un entero positivo.`);
  }

  return result.data;
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];

  if (value === undefined) {
    throw new Error(`Falta el valor de ${option}.`);
  }

  return value;
}

function printHelp(): void {
  console.log(`
Uso:
  pnpm agent -- [opciones] "solicitud"

Opciones:
  --model <nombre>       Modelo de Ollama
  --sandbox <ruta>       Carpeta segura
  --max-steps <número>   Máximo de pasos
  --context <tokens>     Ventana de contexto
  --list-models          Lista modelos instalados
  --quiet                Oculta la traza detallada
  --help                 Muestra esta ayuda
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const overrides: CliOverrides = {};
  const requestParts: string[] = [];
  let listModels = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];

    if (argument === undefined) {
      continue;
    }

    switch (argument) {
      case "--model":
        overrides.model = readValue(args, index, argument);
        index++;
        break;
      case "--sandbox":
        overrides.sandboxDirectory = readValue(args, index, argument);
        index++;
        break;
      case "--max-steps":
        overrides.maxSteps = parsePositiveInteger(
          readValue(args, index, argument),
          argument,
        );
        index++;
        break;
      case "--context":
        overrides.numCtx = parsePositiveInteger(
          readValue(args, index, argument),
          argument,
        );
        index++;
        break;
      case "--quiet":
        overrides.verbose = false;
        break;
      case "--list-models":
        listModels = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        return;
      default:
        requestParts.push(argument);
    }
  }

  const config = loadConfig(overrides);

  if (listModels) {
    const models = await new OllamaClient(config).listModels();
    console.table(
      models.map((model) => ({
        name: model.name,
        family: model.details?.family ?? "n/d",
        parameters: model.details?.parameter_size ?? "n/d",
        quantization: model.details?.quantization_level ?? "n/d",
        digest: model.digest?.slice(0, 12) ?? "n/d",
      })),
    );
    return;
  }

  const request = requestParts.join(" ").trim();

  if (request.length === 0) {
    printHelp();
    throw new Error("Debes proporcionar una solicitud.");
  }

  console.log(`Modelo: ${config.model}`);
  console.log(`Sandbox: ${config.sandboxDirectory}`);
  console.log(`Contexto: ${config.numCtx}`);
  console.log(`Máximo de pasos: ${config.maxSteps}`);

  const answer = await runAgent(request, config);

  console.log("\nRespuesta final:\n");
  console.log(answer);
}

main().catch((error: unknown) => {
  console.error(`\n❌ ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
