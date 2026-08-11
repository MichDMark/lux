# Modelo de seguridad

## Principio de autoridad

Gemma propone una decisión; el harness valida y ejecuta. El modelo no tiene acceso directo al sistema operativo, a la red externa ni a comandos de shell.

## Capacidades actuales

| Tool | Permitido | No permitido |
| --- | --- | --- |
| `list_directory` | Listar nombres y tipos dentro del sandbox. | Leer contenido, modificar o salir del sandbox. |
| `read_file` | Leer texto permitido dentro del sandbox. | Escribir, ejecutar, leer rutas externas o archivos grandes/no permitidos. |

`final_answer` es una decisión del agent loop y no una tool registrada. Solo se habilita después de una observación exitosa y debe citar uno o más IDs de evidencia del loop actual.

## Restricciones aplicadas por código

- Solo se aceptan rutas relativas para las tools.
- Las rutas con escape (`..`) y las rutas absolutas se rechazan.
- Se resuelven enlaces simbólicos y se comprueba que el destino final permanezca dentro del sandbox.
- `read_file` solo permite `.txt`, `.md`, `.json` y `.ts`.
- Cada lectura está limitada por `MAX_FILE_BYTES`.
- Los listados se limitan con `MAX_DIRECTORY_ENTRIES`.
- Las decisiones y argumentos se validan con JSON Schema y Zod.
- Cada referencia de `final_answer.evidence` debe existir y corresponder a una observación exitosa; las observaciones fallidas y los IDs inventados se rechazan.
- El loop termina al alcanzar `AGENT_MAX_STEPS`.

## Datos no confiables

El contenido leído puede incluir instrucciones, datos incorrectos o material sensible. Se procesa como observación, no como autoridad para cambiar políticas, ejecutar acciones o revelar secretos.

## Límites explícitos

LUX no ofrece actualmente escritura de archivos, ejecución de shell, instalación de paquetes, acceso fuera del workspace autorizado, acceso a proveedores cloud, MCP ni herramientas de red. Cualquier ampliación debe diseñarse como una nueva capacidad limitada, validada y documentada; un prompt no es una barrera de seguridad suficiente.
