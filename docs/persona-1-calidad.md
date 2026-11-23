# Persona 1: resultado de calidad e infraestructura

Rama final: `codex/persona-1-verificacion-final`.
Worktree: `C:\Users\ambar\TrazFlow-G8-persona-1`.
Base integrada: `origin/develop` en `a5b1ee3`, incluidos los PR #83 y #85 de Odoo.
El trabajo original de `codex/persona-1-calidad-infra` se conserva en el historial.

## Tests unitarios y contrato ERP — TRZ-122 / TRZ-114

Vitest ejecuta todos los tests de `src` y `tests/unit`, incluidos los tests nuevos
de Odoo. Se conserva `node:assert/strict`; se eliminaron el runner Node, su hook
server-only y c8. Hay una única cobertura V8. `server-only` tiene un alias vacío
solo en tests; las pruebas estáticas de fronteras cliente/servidor siguen activas.

Resultado: **77 archivos, 524 tests aprobados, 6 omitidos con motivo, sin todo**.
Los 417 tests originales pasaron tras la migración; los adicionales corresponden
a importación, filtros, contrato compartido y Odoo integrado desde develop.

`runErpClientContract` corre los mismos casos contra mock, ERPNext y Odoo con
respuestas externas simuladas. Odoo ejecuta lectura, relaciones, fechas, unidades,
identificadores, depósitos completos y errores; sus cuatro escrituras no
implementadas se omiten explícitamente. El mock omite HTTP 403 separado y
transporte porque no los simula. No se afirma una prueba contra ERP remotos reales.

Por decisión confirmada por la responsable de persona 1, el mock exige despacho
previo para registrar entrega o adjunto. Devuelve not_ready reintentable y las
pruebas comprueban el reintento después del despacho. Su estado sigue siendo
volátil: reiniciar el proceso borra la memoria del mock.

Prueba de sensibilidad realizada: cambiar temporalmente el mapeo de vencimiento
de ERPNext a `31/12/2027` hizo fallar el contrato. El mapeo fue restaurado.

## Importación y SQL — TRZ-117

Casos tabulados y pruebas de las acciones reales verifican archivo, encabezados,
unidades, fechas, cantidades, duplicados, permisos, dry-run, límite de 4 MB y que
las filas inválidas no lleguen a la RPC en modo manual ni ERP. Se conserva la
política existente de procesar solo las filas válidas, sin inventar otra regla.

`src/lib/stock-import/rows.ts`: **100% de líneas, ramas y funciones**.
La cobertura global del proyecto es 26,75% de líneas; no debe confundirse con
la cobertura específica de reglas ni con el porcentaje de historias terminadas.

`supabase/tests/ush1_stock_import.sql` pasó contra PostgreSQL local y terminó con
rollback. Verifica permisos, aislamiento de empresas, depósitos inválidos/inactivos,
idempotencia y escritura de stock/eventos según el modo.

## Seeds

El seed se movió a `supabase/seeds/001_demo.sql` sin cambiar contenido (mismo hash
Git). `config.toml` carga `./seeds/*.sql`. El arranque nuevo aplicó todas las
migraciones y el seed: tres usuarios demo y un depósito. Los tests locales crean
y eliminan sus propias empresas y usuarios. No se modificó la base remota.

## Navegador y configuración Playwright

Hay siete proyectos en `playwright.config.ts`, ejecutados por separado por los
puertos y modos distintos. La suite elegida se transmite a los workers, que
recargan el archivo sin los argumentos del comando inicial.

Se corrigió la caché HMR de los servidores de prueba: reutilizaba respuestas
anteriores al cambiar fixtures y podía presentar una caída de catálogo como datos
vacíos. `serverComponentsHmrCache` se desactiva con `NEXT_TEST_DIST_DIR`, sin
cambiar la configuración normal de producción. La prueba de error volvió a pasar.
Next agregó los includes de tipos para los directorios aislados de cada suite;
se conservan en tsconfig para no ensuciar la rama en cada ejecución.

Los resultados finales por proyecto se registran al terminar debajo de esta sección.
Reportes locales: `playwright-report/<proyecto>/index.html` y
`test-results/<proyecto>/results.json`; están ignorados por Git.

## Filtros de órdenes y términos neutrales — TRZ-32 / TRZ-120

Estado y distribuidora se combinan en la consulta de servidor, conservando empresa
y RLS. La URL mantiene la selección; limpiar reinicia resultados y selectores.
Hay estados vacíos específicos y verificación móvil sin desborde horizontal.

El código de negocio usa términos del contrato en lugar de nombres de documentos
de ERPNext. La búsqueda sin distinguir mayúsculas de frappe, erpnext, stock entry,
pick list, delivery note y doctype no devuelve resultados en src fuera del
adaptador y tests. No se modificaron migraciones históricas. CODE se mantiene
como regla de entrada de TrazFlow, documentada en el ADR.

## Build, runtime y CI — TRZ-119

Lint y TypeScript con `next typegen` aprobaron. El build pasó con valores falsos
para Supabase. Next y su configuración ESLint se actualizaron a 16.4.6: la versión
anterior detenía el primer arranque/build por vulnerabilidades conocidas.

CI usa **Node 24**, igual que la verificación local, y hay `.nvmrc`. Se corrigió
la propuesta de Node 20 del ticket porque el Supabase instalado exige Node 22+
y Vite exige 22.12+. `package.json` declara el mínimo 22.12. No se cambió la
versión de Supabase ni se bajaron dependencias para mantener Node 20.

El workflow ejecuta npm ci, lint, tipos, Vitest y build sin secretos reales. Se
activa en PR a develop/main, push a esas ramas y ramas de persona 1, y manualmente.
La validación de protección de develop/main devolvió 403: requiere administración.
No se puede afirmar que esas reglas estén activas ni modificarlas con esta conexión.

## Documentación y pendientes — TRZ-73 / TRZ-124 / TRZ-118

Onboarding describe registro, solicitud, aprobación/rechazo, revocación/restauración
y asignación de choferes; el antiguo vínculo operador-distribuidor ya no existe.
README corrige importación de líneas de órdenes, seeds, tests, roles y proveedores,
e incluye una captura con datos sintéticos. El cierre final espera las historias
de las otras personas y una revisión cruzada.

Lo que falta, por qué y los pasos para retomarlo están en
[persona-1-pendientes.md](persona-1-pendientes.md). Incluye acceso a Oracle/Vercel,
IP reservada, HTTPS, rotación, protección de ramas y dependencias de documentación.
La [plantilla Caddy](../infra/erpnext/Caddyfile.example) se validó en un contenedor
sin red: prueba sintaxis, no DNS, certificados ni conectividad al ERP real.

## Resultado final de navegador — 22 de noviembre de 2026

| Proyecto | Aprobados | Fallos | Flaky |
| --- | ---: | ---: | ---: |
| e2e | 21 | 0 | 0 |
| forecast | 3 | 0 | 0 |
| stock-import | 4 | 0 | 0 |
| stock-import-erp | 1 | 0 | 0 |
| plan-changes | 6 | 0 | 0 |
| subscription | 2 | 0 | 0 |
| demo | 2 | 0 | 0 |

**Total: 39 aprobados.** Incluye importación real local de 5.000 filas, importación
con outbox y ERP simulado, filtros, permisos, cambios de plan, suscripciones y QR.
La demo se ejecutó con su proyecto y ritmo de presentación en navegador headless.
Las pruebas de APIs simuladas no se presentan como pruebas de ERP remotos reales.

## Avance de infraestructura posterior al push de verificación

Se confirmó acceso SSH como ambar a la IP reservada `132.226.26.114`. Caddy 2.11.9,
regla 80/443 persistida y host_name final configurados. HTTPS público Let's Encrypt
validado desde afuera: login 200, ping pong y HTTP 308. 8080 no accesible externamente.
API key y secret renovados: lecturas correctas con las nuevas credenciales y rechazo
de las anteriores. Cata confirmó Vercel. El 23/11 se detectó y corrigió la política
on-failure de nueve contenedores; un segundo reinicio comprobó arranque automático,
IP conservada, TLS válido, firewall persistido y lecturas con ErpNextClient real.
El archivo temporal de entrega se retiró. La interfaz de Vercel no se inspeccionó
en esta prueba. Ver [estado de HTTPS](trz118-https-estado.md).
