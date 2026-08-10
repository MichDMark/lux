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
6. La observación se incorpora al siguiente turno. `final_answer` es una decisión terminal, no una tool.

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

Cada paso permite solo las decisiones incluidas en el JSON Schema enviado a Ollama. Hoy, la disponibilidad de `final_answer` se determina por una política de evidencia: ciertas solicitudes requieren una lectura exitosa de archivo. Esta política es una limitación conocida porque aún usa una heurística de palabras clave; no debe ampliarse agregando términos sin una decisión de estudio explícita.

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
