import { z } from "zod";
import type { AgentConfig } from "./config.js";

const GenerateResponseSchema = z.object({
  response: z.string(),
  load_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional(),
});

const TagsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      size: z.number().optional(),
      digest: z.string().optional(),
      details: z
        .object({
          family: z.string().optional(),
          parameter_size: z.string().optional(),
          quantization_level: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

export type GenerateResult = z.infer<typeof GenerateResponseSchema>;
export type InstalledModel = z.infer<typeof TagsResponseSchema>["models"][number];

export class OllamaClient {
  public constructor(private readonly config: AgentConfig) {}

  public async generate(prompt: string, format: unknown): Promise<GenerateResult> {
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: this.config.model,
        prompt,
        stream: false,
        think: false,
        keep_alive: this.config.keepAlive,
        format,
        options: {
          num_ctx: this.config.numCtx,
          temperature: 0,
          seed: 42,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama respondió con HTTP ${response.status}: ${await response.text()}`,
      );
    }

    const result = GenerateResponseSchema.safeParse(await response.json());

    if (!result.success) {
      throw new Error(
        ["La respuesta de Ollama es inválida.", z.prettifyError(result.error)].join(
          "\n",
        ),
      );
    }

    return result.data;
  }

  public async listModels(): Promise<InstalledModel[]> {
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(
        `No se pudieron consultar los modelos: HTTP ${response.status}: ${await response.text()}`,
      );
    }

    const result = TagsResponseSchema.safeParse(await response.json());

    if (!result.success) {
      throw new Error(
        ["La lista de modelos es inválida.", z.prettifyError(result.error)].join(
          "\n",
        ),
      );
    }

    return result.data.models;
  }
}
