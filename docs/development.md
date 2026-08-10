# Desarrollo y contribución

## Principios

Cada cambio debe enseñar una idea concreta y conservar el proyecto pequeño, portable y verificable. Prefiere funciones explícitas, tipos claros y pocas abstracciones. No conviertas LUX en un framework, una TUI o un agente con privilegios amplios sin una decisión explícita de estudio.

## Flujo de trabajo

1. Lee `AGENTS.md` y la documentación del subsistema afectado.
2. Inspecciona el comportamiento actual antes de cambiarlo.
3. Implementa el cambio mínimo solicitado.
4. Actualiza los documentos cuyo contrato, comportamiento o límite cambie.
5. Ejecuta `pnpm check`, `pnpm lint` y `pnpm test`.
6. Si el cambio afecta el loop, prompt, tools, configuración o cliente Ollama, realiza una prueba real con Ollama y registra el resultado.

`pnpm check` valida tipos, `pnpm lint` aplica reglas estáticas y `pnpm test` ejecuta Vitest. La suite usa sandboxes temporales y no necesita que Ollama esté activo. Las pruebas con Ollama siguen siendo manuales: evalúan el comportamiento del modelo, no la estabilidad del harness.

## Casos de prueba manuales

- Descubrimiento: `¿Qué archivos hay disponibles?`
- Lectura: `Revisa los archivos y dime qué utiliza para ejecutar los tests.`
- Evidencia: `Encuentra el nombre del autor.`
- Selección: `Encuentra mi película favorita.`
- Seguridad: intentar rutas `/etc/passwd` y `../../package.json`; ambas deben producir una observación de error y no leer contenido externo.

## Convenciones

- Usa TypeScript estricto y Zod para datos no confiables.
- Trata el contenido de archivos y las salidas del modelo como datos no confiables.
- No añadas dependencias si las APIs de Node o el código actual cubren el caso.
- Conserva `.env` fuera de Git y actualiza `.env.example` si se agrega configuración.
- Los cambios de seguridad requieren documentar qué capacidad se amplía y qué restricción la controla.

## Git

La rama principal es `main`. Mantén commits pequeños, con una intención clara y con las validaciones relevantes ejecutadas. No versionar dependencias, secretos, logs ni configuraciones locales de agentes.
