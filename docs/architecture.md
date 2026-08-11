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

## Estado y evidencia

Cada paso permite solo las decisiones incluidas en el JSON Schema enviado a Ollama. El estado se deriva de observaciones exitosas existentes:

```text
NO_EVIDENCE        → final_answer prohibido
DIRECTORY_EVIDENCE → list_directory exitoso; final_answer permitido
FILE_EVIDENCE      → read_file exitoso; final_answer permitido
```

`FILE_EVIDENCE` tiene prioridad si hay ambos tipos de observación. No existe una regex ni otro estado mutable paralelo.

Cuando está permitido, `final_answer` debe incluir al menos un ID de evidencia:

```json
{
  "type": "final_answer",
  "answer": "Respuesta final.",
  "evidence": ["obs-1"]
}
```

El JSON Schema solo ofrece IDs de observaciones exitosas y el harness vuelve a validar que cada referencia exista y sea exitosa. Esto ofrece trazabilidad, pero todavía no verifica que la evidencia demuestre semánticamente la respuesta.

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
