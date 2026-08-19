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
| `OLLAMA_REQUEST_TIMEOUT_MS` | `120000` | Límite por petición a Ollama, en milisegundos. |
| `AGENT_MAX_STEPS` | `7` | Máximo experimental de iteraciones; deja margen para planificación y consultas multiarchivo. |
| `MAX_FILE_BYTES` | `12000` | Máximo de bytes por lectura de archivo. |
| `MAX_DIRECTORY_ENTRIES` | `100` | Máximo de entradas devueltas al listar un directorio. |
| `MAX_SEARCH_FILES` | `100` | Máximo de archivos permitidos a examinar por búsqueda. |
| `MAX_SEARCH_MATCHES` | `20` | Máximo de coincidencias devueltas por búsqueda. |
| `MAX_SEARCH_SNIPPET_CHARS` | `300` | Máximo de caracteres por fragmento devuelto. |
| `SANDBOX_DIR` | `sandbox` | Raíz permitida para las tools. |
| `AGENT_VERBOSE` | `true` | Activa las trazas educativas. |

`.env` es local y no debe versionarse. `SANDBOX_DIR` admite una ruta absoluta o una ruta relativa a la raíz del proyecto.

Con `AGENT_VERBOSE=true`, LUX muestra métricas por turno de Ollama: carga del modelo, evaluación del prompt, generación y tiempo total. Las duraciones de Ollama se convierten de nanosegundos a milisegundos; las tasas se muestran en tokens por segundo. Para investigar un modelo lento, puede aumentarse temporalmente `OLLAMA_REQUEST_TIMEOUT_MS` sin cambiar su valor predeterminado.

`search_text` localiza texto literal sin distinguir mayúsculas y minúsculas en archivos permitidos bajo un directorio del sandbox. Sus coincidencias indican qué archivo leer; no sustituyen a `read_file` como evidencia de contenido.

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
