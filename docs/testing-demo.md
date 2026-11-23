# Testing: ejecución y demo

## Preparación

Desde la raíz: `npm ci` y `npx playwright install chromium`.
En Windows con certificados corporativos: `$env:NODE_OPTIONS='--use-system-ca'`.

## Unitarios y cobertura

`npm test` ejecuta todos los tests de `src/**/*.test.{ts,tsx}` y
`tests/unit/**/*.test.{ts,tsx}` con Vitest. `npm run test:unit` es un alias del
mismo comando. Los tests nuevos usan imports explícitos desde `vitest`.
Se conservan las aserciones de `node:assert/strict` existentes.

`server-only` tiene un alias a `tests/helpers/server-only.ts` exclusivamente en
Vitest. La protección de Next en producción sigue vigente y las suites estáticas
de fronteras servidor/cliente siguen ejecutándose.

`npm run test:coverage` (también `test:coverage:unit`) usa únicamente V8 de Vitest.
El reporte queda en `coverage/index.html` y `coverage/coverage-summary.json`.
Incluye archivos TS/TSX de `src` sin ejecutar y excluye los tests. Los componentes
históricos evaluados con `transpileModule/new Function` no tienen atribución
completa al TSX original. SQL y E2E no se suman a estos porcentajes.

`npm run typecheck` ejecuta `next typegen && tsc --noEmit`: los tipos de rutas y
layouts se generan antes de comprobar TypeScript. `*.tsbuildinfo` ya está ignorado
y no forma parte del repositorio.

## Navegador: una configuración, ocho proyectos

Todas las suites usan `playwright.config.ts`. En sus servidores de desarrollo,
`NEXT_TEST_DIST_DIR` desactiva `serverComponentsHmrCache`: los fixtures y la base
cambian entre pasos y una recarga HMR no debe reutilizar respuestas viejas. La
configuración de producción conserva su comportamiento. Se ejecuta una suite por invocación,
porque las APIs de fixtures de `e2e` y `forecast` usan el mismo puerto y los modos
de importación requieren entornos distintos. Sin `--project` se elige `e2e`.
`npx playwright test --list` enumera los ocho proyectos sin iniciar servicios.

| Comando | Alcance |
| --- | --- |
| `npm run test:e2e` | `tests/e2e`, salvo pronósticos y pallets manuales; API HTTP de fixtures |
| `npm run test:e2e:pallets` | Pallet mixto, despacho/recepción por ítem, reingreso y reutilización; [escenario manual local](testing-pallets-mixtos.md) |
| `npm run test:demo` | Entrega del chofer, visible, QR real y pausas de presentación |
| `npm run test:e2e:forecast` | Pronósticos con su API HTTP de fixtures |
| `npm run test:e2e:plan-changes` | Cambios de plan contra Supabase local |
| `npm run test:e2e:stock-import` | Importación directa sin ERP contra Supabase local |
| `npm run test:e2e:stock-import-erp` | Importación con mock ERP contra Supabase local |
| `npm run test:e2e:subscription` | Suscripciones contra Supabase local |
| `npm run test:all` | Unitarios, proyecto `e2e` y proyecto `pallets-manual` |

También se admite `npx playwright test --project=<nombre>`.
`tests/e2e` valida navegación, cookies y acciones contra APIs simuladas:
no demuestra RLS ni RPC reales. `tests/local` requiere Docker y `npx supabase start`;
consulta las credenciales del stack local y rechaza una URL distinta de
`http://127.0.0.1:54321`. Crea y elimina datos sintéticos. Una interrupción puede
dejar fixtures que requieran limpieza local.

Los puertos 3100/54329 son para fixtures HTTP y 3102 para las suites con Supabase
real local. No se reutilizan servidores externos. Los fallos conservan trace,
video y captura en `test-results`; `npx playwright show-report` abre el reporte.
La demo conserva video incluso cuando aprueba.

## CI

`.github/workflows/ci.yml` corre en PR a `develop`/`main`, en push a esas ramas
y a `codex/persona-1-*`, y manualmente, con Node 24:
instalación reproducible, lint, tipos, todos los unitarios y build. Solo usa
variables falsas de Supabase. El check se llama `CI`.

Antes de lint también corre `npm run check:migrations`: versiones SQL duplicadas
o nombres sin versión hacen fallar CI antes de intentar desplegar. Se verificó
con dos archivos de prueba que compartían `20261122100000`.

Cata activó el ruleset que exige PR y el check CI en main/develop, verificado por
API. Crear el workflow no configura por sí solo esa protección. La ejecución
[45105103269](https://github.com/cataciucci24/TrazFlow-G8/actions/runs/45105103269)
del commit `96e0b5a` terminó correctamente en aproximadamente un minuto. La
ejecución del PR final debe consultarse para verificar su propio commit.

Los E2E quedan fuera del check obligatorio: las suites locales necesitan Docker,
migraciones y datos de prueba; las de fixtures verifican otra capa. Se ejecutan
por separado antes de entregar los flujos afectados. No se afirma un tiempo en
Actions hasta medirlo allí.

## Demo de calidad

No ejecutar un build mientras corre Playwright: Next limpia `.next` y puede
borrar los directorios de los servidores de prueba. Ejecutar build y suites
de navegador en secuencia.

1. Ejecutar `npm test` y mostrar el total real que informa Vitest.
2. Mostrar idempotencia/reintentos en `src/lib/erp-outbox/processor.test.ts`.
3. Mostrar reglas de negocio en `tests/unit/expiration-rules.test.ts`.
4. Ejecutar `npm run test:demo`: chofer, QR, confirmación y salida de pendientes.
5. Abrir cobertura y explicar las limitaciones anteriores.

## SQL

Las suites de `supabase/tests` usan aserciones y rollback, no pgTAP. Ejecutarlas
solo sobre una base local o descartable. El seed local vive en
`supabase/seeds/001_demo.sql`; `supabase/config.toml` carga `./seeds/*.sql` en orden.
Nunca ejecutar los seeds de demo contra la nube.

`npm run test:sql` ejecuta las 35 suites locales reproducibles contra el contenedor
Supabase identificado por `project_id` en config.toml. No acepta conexiones remotas.
Excluye explícitamente el fixture y los cuatro archivos `*_cloud_state_checks.sql`:
necesitan la réplica histórica y el orden de migraciones indicado en sus encabezados.
Un test sin rollback se rechaza; cualquier fallo hace terminar el comando en rojo.

```powershell
Get-Content -Raw supabase/tests/us_erp01_ops07_driver_delivery.sql | docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Falló la suite SQL' }
```

Algunas suites históricas pueden necesitar actualizar fixtures de roles retirados.
Aplicar migraciones no demuestra que pasen las pruebas SQL.
