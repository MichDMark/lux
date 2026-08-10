# Configuración y uso

## Requisitos

- Node.js 22 o posterior.
- pnpm.
- Ollama en ejecución y al menos un modelo instalado.

Instalación local:

```bash
pnpm install
cp .env.example .env
ollama pull gemma4:e2b
```

## Variables de entorno

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `OLLAMA_MODEL` | `gemma4:e2b` | Modelo solicitado a Ollama. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Endpoint local de Ollama. |
| `OLLAMA_NUM_CTX` | `4096` | Ventana de contexto por generación. |
| `OLLAMA_KEEP_ALIVE` | `5m` | Tiempo para mantener cargado el modelo. |
| `AGENT_MAX_STEPS` | `5` | Máximo de iteraciones del agent loop. |
| `MAX_FILE_BYTES` | `12000` | Máximo de bytes por lectura de archivo. |
| `MAX_DIRECTORY_ENTRIES` | `100` | Máximo de entradas devueltas al listar un directorio. |
| `SANDBOX_DIR` | `sandbox` | Raíz permitida para las tools. |
| `AGENT_VERBOSE` | `true` | Activa las trazas educativas. |

`.env` es local y no debe versionarse. `SANDBOX_DIR` admite una ruta absoluta o una ruta relativa a la raíz del proyecto.

## CLI

```bash
pnpm agent -- [opciones] "solicitud"
```

Opciones: `--model`, `--sandbox`, `--max-steps`, `--context`, `--list-models`, `--quiet` y `--help`. Las opciones del CLI tienen prioridad sobre las variables correspondientes.

Ejemplos:

```bash
pnpm agent -- "¿Qué archivos hay disponibles?"
pnpm agent -- --model phi4-mini --quiet "Revisa los archivos disponibles"
pnpm models
pnpm check
```

Para liberar recursos al terminar las pruebas: `ollama stop <modelo>`.
