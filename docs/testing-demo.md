# Testing: ejecución y demo

## Preparación

Desde la raíz del proyecto: `npm ci` y `npx playwright install chromium`.
Si el entorno usa certificados corporativos, ejecutar primero en PowerShell
`$env:NODE_OPTIONS='--use-system-ca'`.

## Comandos

| Comando | Alcance |
| --- | --- |
| `npm test` | Suite Node en `src/**/*.test.ts` |
| `npm run test:unit` | Suite Vitest en `tests/unit` |
| `npm run test:backend` | Las dos suites de código anteriores |
| `npm run test:coverage` | Cobertura V8/c8 de la suite Node, sobre todos los archivos TS/TSX de `src` |
| `npm run test:coverage:unit` | Reporte independiente de la suite Vitest |
| `npm run test:e2e` | Cuatro pruebas Chromium con servicios HTTP locales de fixtures |
| `npm run test:demo` | Recorrido visual del chofer en Chromium visible |
| `npm run test:all` | Las dos suites de código y la suite de navegador |

El reporte principal queda en `coverage/backend/index.html` y los números en
`coverage/backend/coverage-summary.json`. El reporte Vitest queda en `coverage/unit/index.html`.
Los porcentajes de ambos reportes no se suman ni se promedian: usan ejecuciones y
transformaciones diferentes. El reporte principal conserva la medición de la suite
existente de 186 pruebas; las 44 pruebas Vitest se informan separadamente.

## Demo breve sugerida (4–6 minutos)

1. Ejecutar `npm run test:backend` y mostrar las 186 + 44 pruebas aprobadas.
2. Abrir `src/lib/erp-outbox/processor.test.ts`: explicar idempotencia y errores/reintentos.
3. Abrir `tests/unit/expiration-rules.test.ts`: mostrar casos en los límites de vencimiento
   y la estructura arrange/act/assert de Vitest.
4. Ejecutar `npm run test:demo`: login del chofer, orden asignada, QR detectado por ZXing,
   confirmación, cierre y desaparición de pendientes. `test.step` describe las fases.
   La demo usa `playwright.demo.config.ts` con `slowMo: 1200` (1,2 segundos de demora
   en las operaciones del navegador). Para cambiar el ritmo, ajustar ese valor en
   milisegundos. `npm run test:e2e` conserva la velocidad normal.
   Además, se detiene cuatro segundos en las pantallas clave y ocho al final;
   conserva el video aun cuando el test aprueba, dentro de `test-results`.
5. Mostrar el reporte HTML y explicar el porcentaje de líneas; señalar páginas sin cobertura
   y proponer cubrir progresivamente acciones y consultas críticas antes de fijar una meta.

## Alcance real del recorrido visual

Playwright levanta Next en `127.0.0.1:3100` y un servicio HTTP de fixtures en
`127.0.0.1:54329`. Ambos puertos deben estar libres; no reutiliza servidores externos.
El servicio permite probar cookies, navegación, Server Components, Server Actions y
revalidación sin credenciales reales. Solo existe como proceso de test y nunca se
importa desde producción. Los endpoints no implementados fallan con HTTP 501.

La cámara sintética entrega imágenes de QR al lector ZXing real: no reemplaza el
lector ni llama directamente a su callback. La prueba verifica una única confirmación,
el progreso completo y la salida de la entrega de la lista pendiente.
Esto valida la integración de la aplicación con una API simulada; no demuestra RLS,
la RPC real de entrega ni funcionamiento con una cámara física.

El login comprueba HTTP 400, el código `invalid_credentials` y las credenciales de prueba
enviadas. Otro caso aborta la conexión y exige un mensaje distinto. El login actual usa
Supabase desde el navegador; por eso la interceptación de Playwright es válida.

Los fallos conservan captura, video y trace en `test-results`. El reporte HTML de
Playwright queda en `playwright-report`; abrirlo con `npx playwright show-report`.

## Interpretación de cobertura

Medición inicial: líneas/sentencias 21,45% (2724/12699), funciones 43,77% (116/265),
ramas 74,72% (618/827). Los archivos sin ejecutar están incluidos.
No significa que el 21,45% de las historias esté aprobado ni que el resto tenga errores.
V8 cuenta ramas observables y asigna rangos sintéticos a archivos sin ejecutar;
ese 74,72% no equivale a cubrir tres cuartos de todas las decisiones de negocio.
Los componentes evaluados mediante transpileModule/new Function no tienen atribución
completa a su TSX original. Los E2E y SQL no se agregan a estos porcentajes.

## SQL

Usar una base local o descartable; nunca correr fixtures sobre el proyecto compartido.
Iniciar Docker Desktop y ejecutar `npx supabase start`, que aplica las migraciones a
la base local nueva. No usar `db reset` sobre datos que se necesiten conservar.
Las suites son scripts con aserciones y rollback, no suites pgTAP.

En PowerShell, para la suite de chofer:

```powershell
Get-Content -Raw supabase/tests/us_erp01_ops07_driver_delivery.sql | docker exec -i supabase_db_TrazFlow-G8 psql -U postgres -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Falló la suite SQL' }
```

Algunas suites históricas mencionan roles retirados y pueden necesitar actualización
de fixtures. Conservar el error y distinguir un fixture desactualizado de una regresión.
Aplicar migraciones correctamente no demuestra por sí solo que pasen las pruebas SQL.

## Resultado de esta revisión

- Node: 186/186 aprobadas; Vitest: 44/44 aprobadas.
- Chromium: 4/4 aprobadas, incluido el recorrido de chofer con QR.
- TypeScript y ESLint: aprobados.
- SQL: no ejecutado. Docker Desktop inició, pero al descargar Supabase su almacenamiento
  pasó a solo lectura y el disco C quedó sin espacio. Se detuvo la descarga.
- Build: no completado por `ENOSPC` (sin espacio). Se eliminó únicamente la caché
  regenerable `.next/cache` para recuperar espacio; no se eliminaron datos ni código.

Liberar espacio y recuperar el funcionamiento de Docker es requisito para continuar
la validación SQL y repetir el build. No se hicieron cambios en la base remota.
