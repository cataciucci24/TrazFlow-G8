# Testing unificado y términos del contrato ERP

Decisión de persona 1, 22 de noviembre de 2026 (TRZ-122, TRZ-119, TRZ-120).

## Tests

Todos los unitarios usan Vitest, tanto en `src` como en `tests/unit`. Se conservan
las aserciones de Node para que la migración no cambie lo comprobado. Un alias
de `server-only` exclusivo del runner sustituye el hook del antiguo `node --test`.
La cobertura usa una sola herramienta, `@vitest/coverage-v8`.

Playwright tiene siete proyectos en una configuración. Se ejecutan de a uno por
los puertos compartidos y los modos incompatibles de fixtures/importación. Las
pruebas HTTP simuladas y las pruebas contra Supabase local siguen diferenciadas;
ninguna demuestra por sí sola las garantías de la otra capa.

CI comprueba lint, tipos generados por Next, unitarios y build con valores falsos.
El check remoto y la protección de ramas necesitan verificarse en GitHub.

## Lenguaje y validaciones

Fuera del adaptador se usan «documento de preparación», «remito» y «movimiento de
stock pendiente de confirmar». El formato `CODE` de importación se conserva como
regla de entrada de TrazFlow: empieza con letra o número, admite letras ASCII,
números, punto, guion, guion bajo, barra y espacio; longitud máxima 140.
Cada adaptador valida además sus restricciones propias mediante `ErpError`.
No se amplía el formato aceptado como parte de una corrección de terminología.

Las migraciones ya aplicadas conservan sus comentarios históricos: describen el
adaptador que existía cuando se escribieron. No se reescribe su historial.

## Orden de despacho y entrega del mock

Por decisión confirmada por la responsable de persona 1, el mock exige un reporte
de despacho previo para registrar entrega o adjunto. Sin él devuelve `not_ready`
reintentable, igual que el adaptador real. El estado es en memoria: reiniciar el
proceso borra los reportes del mock. Para una demo que sobreviva reinicios usar un
ERP persistente y comprobar el outbox; no tratar el mock como almacenamiento real.
