# LUX

LUX es un laboratorio educativo para comprender cómo se construye un agente local alrededor de un LLM. Es una aplicación CLI en TypeScript que usa Ollama, salida estructurada y tools de solo lectura dentro de un sandbox.

El modelo propone decisiones; el harness las valida, aplica las políticas de seguridad y ejecuta las tools. No es un framework ni un producto de automatización general.

## Requisitos

- Node.js 22 o posterior;
- pnpm;
- Ollama activo;
- al menos un modelo instalado.

Comprueba el entorno:

```bash
node --version
pnpm --version
ollama --version
curl http://localhost:11434/api/version
ollama list
```

## Instalación

```bash
pnpm install
cp .env.example .env
ollama pull gemma4:e2b
```

El archivo `.env` se carga con `process.loadEnvFile()` de Node.js, por lo que no se necesita `dotenv`. No subas ese archivo a Git.

## Ejecutar el agente

```bash
pnpm lux -- \
  "Revisa los archivos disponibles y dime qué utiliza el proyecto para ejecutar tests"
```

También se puede ejecutar directamente:

```bash
pnpm exec tsx src/cli.ts \
  "Revisa los archivos disponibles"
```

## Comandos principales

```bash
pnpm check                 # Comprueba TypeScript sin generar archivos.
pnpm lint                  # Aplica reglas de calidad a código y pruebas.
pnpm test                  # Ejecuta las pruebas automatizadas.
pnpm test:watch            # Ejecuta pruebas al guardar cambios.
pnpm models                # Lista modelos disponibles en Ollama.
pnpm lux -- --help         # Muestra las opciones del CLI.
```

## Elegir modelo

Por opción del CLI:

```bash
pnpm lux -- \
  --model phi4-mini \
  "Revisa los archivos disponibles"
```

Por variable de entorno:

```bash
OLLAMA_MODEL=gemma4:e2b \
pnpm lux -- \
  "Revisa los archivos disponibles"
```

La opción `--model` tiene prioridad sobre `.env`.

## Opciones disponibles

```text
--model <nombre>
--sandbox <ruta>
--max-steps <número>
--context <tokens>
--list-models
--quiet
--help
```

Ejemplo:

```bash
pnpm lux -- \
  --model gemma4:e2b \
  --context 4096 \
  --max-steps 5 \
  "Encuentra la configuración de tests"
```

## Documentación

La documentación de trabajo está en [`docs/`](docs/README.md):

- [Arquitectura y flujo](docs/architecture.md)
- [Configuración y uso](docs/configuration.md)
- [Guía de desarrollo](docs/development.md)
- [Modelo de seguridad](docs/security.md)
- [Integración y reutilización](docs/integration.md)

Para instrucciones específicas de agentes de desarrollo, consulta [`AGENTS.md`](AGENTS.md).
