# Arquitectura

## Propósito

LUX enseña los componentes mínimos de un agente local sin delegar la autoridad al modelo. Usa Ollama para inferencia y TypeScript para el harness.

## Flujo de una solicitud

```text
Usuario → CLI → configuración → agent loop → Ollama
                                      ↓
                             decisión JSON validada
                                      ↓
                         tool permitida o respuesta final
                                      ↓
                               observación → agent loop
```

1. `src/cli.ts` lee opciones, carga la configuración y llama a `runAgent`.
2. `src/agent.ts` construye el prompt y el JSON Schema permitido para cada paso.
3. `src/ollama-client.ts` solicita una generación estructurada a Ollama.
4. Zod valida la decisión recibida. El modelo nunca ejecuta directamente acciones del sistema.
5. Si la decisión es una tool, `src/tools.ts` valida argumentos, ejecuta la operación y devuelve una observación.
6. La observación recibe un ID (`obs-1`, `obs-2`, …) y se incorpora al siguiente turno. `final_answer` es una decisión terminal, no una tool.

## Componentes y responsabilidades

| Componente | Responsabilidad |
| --- | --- |
| CLI | Interfaz de usuario y overrides de configuración. |
| Configuración | Valores por defecto, variables de entorno y rutas portables. |
| Agent loop | Estado, límite de pasos, prompt, esquemas y observaciones. |
| Cliente Ollama | Comunicación HTTP y validación de respuestas del runtime. |
| Tools | Capacidades explícitas, validación y operaciones de solo lectura. |
| Tracer | Eventos observables del harness; no razonamiento privado del modelo. |

## Métricas de inferencia

En modo verbose, el agent loop registra por turno las métricas devueltas por Ollama y la duración de pared medida por LUX. Incluye carga, tokens y tiempo de evaluación del prompt, tokens y tiempo de generación, duración total de Ollama y diferencia entre esta y la petición local. Estas métricas permiten distinguir un modelo cargando, un prompt que crece o una generación lenta. Si una petición alcanza `OLLAMA_REQUEST_TIMEOUT_MS`, LUX informa el límite y el tiempo transcurrido, pero Ollama no devuelve métricas finales para ese turno.

## Estado y evidencia

Cada paso permite solo las decisiones incluidas en el JSON Schema enviado a Ollama. El estado de evidencia se deriva de observaciones exitosas existentes:

```text
NO_EVIDENCE        → no hay observaciones exitosas
DIRECTORY_EVIDENCE → list_directory exitoso
FILE_EVIDENCE      → read_file exitoso
```

`FILE_EVIDENCE` tiene prioridad si hay ambos tipos de observación. No existe una regex ni otro estado mutable paralelo. El estado de evidencia por sí solo no habilita `final_answer`: cada requisito pendiente debe tener al menos una observación exitosa de su tool compatible.

Cuando está permitido, `final_answer` debe incluir al menos un ID de evidencia:

```json
{
  "type": "final_answer",
  "answer": "Respuesta final.",
  "evidence": ["obs-1"]
}
```

El JSON Schema solo ofrece IDs de observaciones exitosas y el harness vuelve a validar que cada referencia exista y sea exitosa. Esto ofrece trazabilidad, pero todavía no verifica que la evidencia demuestre semánticamente la respuesta.

## Estado de tarea

El primer turno del loop solo permite la decisión `task_requirements`. El mismo LLM enumera entre uno y cinco requisitos independientes con tipo `discovery` o `content`; el harness les asigna `req-1`, `req-2`, etc. y los inicia como `pending`.

- `discovery` solo puede resolverse con `list_directory` exitoso.
- `content` solo puede resolverse con `read_file` exitoso.

`discovery` se usa solo cuando la respuesta sale de nombres, rutas, tipos o carpetas. Ante duda, el modelo debe elegir `content`; scripts, dependencias y datos como el autor necesitan contenido de archivos.

`search_text` localiza coincidencias textuales en archivos permitidos para orientar la siguiente lectura. Cada llamada declara el requisito `content` que investiga. Sus resultados no resuelven requisitos: un requisito `content` requiere una lectura cuya ruta haya aparecido en una búsqueda exitosa de ese mismo requisito.

Las `tool_call` solo investigan y producen observaciones; no incluyen progreso de requisitos. La fase de planificación cuenta como un paso de `AGENT_MAX_STEPS`.

Cada `tool_call` declara `for_requirements` para indicar qué requisito investiga. `final_answer` conserva su campo `evidence` global e incluye `answers`, una respuesta no vacía con evidencia para cada requisito pendiente. Solo se ofrece en el JSON Schema cuando cada requisito tiene una fuente compatible: `list_directory` asociada al requisito `discovery`, o `read_file` de una ruta encontrada por `search_text` para el requisito `content`. El harness valida nuevamente esa cadena y exige que la evidencia global incluya la unión de evidencias de cada respuesta. Después aplica las resoluciones solo si toda la respuesta es válida. Si un `final_answer` que ya supera Zod incumple esta política, el harness registra un feedback de rechazo y continúa el loop; ese feedback no es una observación de tool ni evidencia válida. Esto evita finalizar con evidencia para solo una parte del objetivo, sin intentar todavía verificar que una lectura pruebe semánticamente una afirmación.

## Llamadas redundantes

Antes de ejecutar una tool, el harness compara su nombre y argumentos normalizados con las observaciones exitosas del loop actual. Si ya existe una coincidencia, no vuelve a ejecutar la tool y registra una nueva observación:

```json
{
  "id": "obs-3",
  "tool": "read_file",
  "status": "blocked",
  "reason": "duplicate_successful_tool_call",
  "existingObservationId": "obs-2"
}
```

`blocked` no es evidencia válida y no termina el loop. Indica al modelo que puede reutilizar `obs-2`, elegir otra acción o finalizar con evidencia exitosa existente. Los errores no se consideran duplicados: una llamada que falló puede volver a intentarse.

## Estructura actual

```text
src/
├── agent.ts
├── cli.ts
├── config.ts
├── ollama-client.ts
├── tools.ts
└── tracer.ts
sandbox/                 # Datos educativos seguros para inspeccionar
```
