# Integración y reutilización

## Estado del contrato

LUX se distribuye hoy como código fuente y CLI educativa. No publica un paquete ni garantiza estabilidad semántica de sus interfaces. Quien lo incorpore en otro proyecto debe fijar una revisión concreta y asumir que sus APIs pueden evolucionar durante el aprendizaje.

## Puntos de integración actuales

| Interfaz | Uso |
| --- | --- |
| `loadConfig(overrides)` | Construye `AgentConfig` desde entorno y overrides del CLI. |
| `runAgent(request, config)` | Ejecuta el loop y devuelve la respuesta final como `Promise<string>`. |
| `OllamaClient` | Genera decisiones estructuradas y lista modelos instalados. |
| `listTools()` / `toolRegistry` | Expone las tools registradas para el harness. |

Ejemplo de uso programático dentro de otro proyecto TypeScript:

```ts
import { loadConfig } from "./src/config.js";
import { runAgent } from "./src/agent.js";

const config = loadConfig({ sandboxDirectory: "./workspace-seguro" });
const answer = await runAgent("¿Qué archivos hay disponibles?", config);
```

Las rutas de importación deben adaptarse al modo en que el proyecto consumidor integre el código. Este ejemplo no implica que LUX sea una dependencia instalable.

## Requisitos para un consumidor

- Node.js 22+, dependencias del proyecto y Ollama accesible desde `OLLAMA_BASE_URL`.
- Un sandbox dedicado, controlado por el proyecto consumidor y sin secretos innecesarios.
- Límites explícitos de contexto, pasos, listado y tamaño de archivo apropiados al entorno.
- Tratamiento de la respuesta como texto generado y de las observaciones como datos no confiables.

## Límites de integración

- `runAgent` escribe la respuesta y las trazas mediante la CLI/harness actual; no expone aún un sistema de eventos ni resultados estructurados públicos.
- Las tools actuales son de lectura y se registran internamente.
- La política de evidencia es educativa y no debe considerarse un motor de autorización general.

Antes de extraer LUX como paquete, definir una API pública explícita, separar la presentación CLI de la biblioteca, añadir pruebas automatizadas y establecer versionado. Esas tareas quedan fuera del estado actual.
