# Persona 3: contenido, pallets mixtos y reingreso

## Estado de la entrega

- Ola 0: vista `pallet_contents`, interfaz compartida y adaptación de las lecturas existentes.
- TRZ-111, ola 1: tabla de ítems, migración de los pallets existentes, armado atómico, stock ERP por ítem, validación de despacho y recepción por ítem, inventario, consultas por lote y un QR por pallet.
- TRZ-24: reingreso completo por logística, escaneando o ingresando el QR, con motivo obligatorio y auditoría. Un reenvío usa otra orden.
- Ola 2 pendiente de personas 2 y 5: adaptar contrato ERP §5 y productores/consumidores del outbox para informar una línea por ítem. No se modificaron `src/lib/erp`, configuración por empresa ni el contrato publicado.

## Interfaz para el equipo

Toda lectura de contenido desde la aplicación pasa por `src/lib/pallets/contents.ts`:

```ts
const contentsByPallet = await getPalletContents(db, palletIds, companyId);
const palletsWithContents = await attachPalletContents(db, palletHeaders);
const relationsWithContents = await attachExpectedPalletContents(db, orderRelations);
```

`getPalletContents` devuelve un `Map<palletId, PalletContent[]>`. Deduplica IDs, divide consultas en grupos de 100 y pagina de a 500 ítems. Las consultas usan el cliente autenticado y respetan RLS. Un error de consulta se propaga; no se disfraza de contenido vacío.

`attachExpectedPalletContents` usa `order_pallets.expected_items`, con identidades y cantidades de esa orden. Se usa en el detalle de órdenes y los pronósticos para que reingresar o editar un pallet no cambie cantidades históricas. La descripción del producto/lote sigue siendo la del catálogo vigente.

No leer el contenido desde `pallets.batch_id` o `pallets.quantity`: esas columnas quedan como puente del primer ítem para los flujos monolote existentes. No representan todo el pallet ni una cantidad total. La fuente actual es `pallet_items` a través de `pallet_contents`. Las RPC de lectores QR, entregas y trazabilidad también fueron adaptadas; las RPC de escritura conservan controles transaccionales en la base.

`Pallet.contents` contiene los ítems. Los campos escalares de `Pallet` permanecen por compatibilidad: en mixtos, `productName` indica que es mixto y `quantity` es `null`. Usar los ítems para sumar cantidades **por unidad**, buscar productos/lotes o mostrar detalle. `itemId` es opaco: no asumir que coincide con el ID del pallet. El QR sigue siendo exclusivamente `pallet.qrCode`.

Para persona 6: la consulta `get_lot_traceability` incluye los ítems secundarios de un mixto. Los eventos de recepción guardan `expected_items`, `detected_items` y `normalized_items`; los de reingreso guardan motivo, estado anterior, depósito y contenido completo. No reemplazar el historial al construir las nuevas líneas de tiempo.

## Uso

### Armado

Logística: **Pallets → Armar pallet mixto**. Depósito: **Armar pallet** en el menú. La ruta es `/dashboard/pallets/armar`.

El formulario permite entre 1 y 100 ítems, de uno o varios productos/lotes, en el mismo depósito. No permite repetir un lote; se debe consolidar su cantidad en un ítem. La unidad viene del producto: unidades/cajas enteras, kilogramos con hasta dos decimales. Se usan lotes ya existentes; su alta conserva el flujo actual. La empresa con ERP utiliza lotes sincronizados y la base aplica el saldo de cada lote/depósito. Si falla un ítem, se revierte el pallet completo.

Los pallets anteriores se migran a un ítem, conservando QR, estado y cantidades desconocidas (`null`). El puente mantiene funcionando las altas y ediciones monolote existentes. El formulario de edición monolote no modifica pallets mixtos.

### Despacho y recepción

Cada asociación a una orden toma una copia de los ítems esperados. Al escanear se muestran producto/lote/cantidad esperados y se confirma lo detectado, pudiendo corregir SKU, lote y cantidad, quitar faltantes o agregar sobrantes. La comparación usa producto/lote/cantidad, independientemente del orden de las filas.

En despacho, una diferencia deja el pallet pendiente; si estaba validado, invalida esa validación. Hay que corregir y volver a escanear antes de confirmar. En recepción, el chofer registra las cantidades detectadas y la diferencia queda persistida como `content_mismatch`, con estado de entrega con diferencia. Los reintentos no duplican el procesamiento.

Las firmas anteriores de `validate_order_pallet` y `confirm_delivery_pallet` conservan compatibilidad con un ítem. Para mixtos exigen el contenido explícito mediante `validate_order_pallet_items` y `confirm_delivery_pallet_items`. Las funciones internas no tienen permiso de ejecución desde la API. Las antiguas RPC de recepción del operador de distribuidor ya fueron eliminadas por las migraciones previas; el flujo vigente pertenece al chofer asignado.

### Reingreso

Logística: **Pallets → Reingresar pallet**. Solo `logistics_manager` activo de la empresa puede ejecutarlo. Requiere QR y motivo no vacío, de hasta 1.000 caracteres.

Se aceptan `delivered` y `delivery_discrepancy`, y `received` histórico. Se registra la devolución **completa del contenido del pallet**, sin modificar cantidades ni borrar asociaciones, recepciones o movimientos anteriores. No es un flujo de devoluciones parciales ni de ajuste de diferencias de stock. La orden anterior conserva su contenido esperado/detectado. Un reintento estando en depósito no duplica auditoría.

El pallet vuelve a `in_warehouse`, al depósito original activo y sin posición física asignada. Se ubica después por el flujo existente de ubicaciones. Aparece nuevamente entre los disponibles para asociar a otra orden. Con lotes ERP se conserva el tope por saldo: el ERP debe reflejar el stock devuelto antes de admitirlo en depósito; la RPC no inventa saldo ERP ni realiza transferencias entre depósitos.

## Dependencia de ola 2

Mientras el contrato y los adaptadores no soporten varias líneas con el mismo `palletCode`, se rechaza asociar/confirmar mixtos en órdenes con `external_id` ERP (`TM111`). Esto impide publicar únicamente el primer ítem. Se pueden armar mixtos contra saldos ERP, pero su despacho mediante una orden ERP queda pendiente de la integración acordada. Las órdenes manuales usan el flujo completo de mixtos; las órdenes ERP monolote siguen funcionando.

Persona 2 debe confirmar, después del trabajo de persona 5 en outbox/config/panel:

1. Identidad de líneas, repetición de `palletCode` y versión del contrato (§5).
2. Payloads de despacho, carga/reversión de Pick List y entrega, con una línea por ítem y copias históricas de la orden.
3. Validaciones y consumidores del adaptador; idempotencia y reintentos.
4. Remover `trg_guard_mixed_erp_order` y la rama ERP de `guard_dispatch_content` solo cuando esos cambios estén integrados y probados. Conservar los controles de comparación de contenido.

## Migraciones y verificación

Aplicar las migraciones nuevas en orden, antes de desplegar la aplicación. La de ola 0 es `20261122100000_pallet_contents.sql`. Las de TRZ-111 son `20261122110000_mixed_pallet_items.sql` y `20261122110100_pallet_item_checks.sql`. El evento de reingreso se agrega en `20261122120000_pallet_return_event.sql`, separado de su uso en `20261122120100_pallet_return.sql` porque PostgreSQL exige confirmar el valor del enum antes de usarlo.

Las cinco migraciones se aplicaron el 22/11/2026 al proyecto remoto `prhsdpghhsjcmvlgtxgr` (TrazFlow, rama `main`, etiquetada `Production` en Supabase), con autorización explícita del usuario para esa base exacta. Se ejecutaron por separado y se registraron en `supabase_migrations.schema_migrations`, dentro de la misma transacción de cada migración. No se cargaron seeds ni datos de prueba. No se cambiaron configuración de seeds, scripts de package.json ni configuración de tests, que pertenecen a persona 1.

La verificación remota posterior confirmó cinco versiones registradas, los 10 pallets existentes conservados con 10 ítems, cero pallets sin ítems, cero diferencias entre lote/cantidad originales y contenido migrado, cero asociaciones sin snapshot, las cuatro RPC nuevas disponibles, RLS de ítems activo y las funciones internas sin permiso de ejecución para `authenticated`. Se solicitó la recarga del esquema de PostgREST.

Validación realizada:

- TypeScript: `npx tsc --noEmit --incremental false`.
- Vitest: `npm run test:unit`, con tests nuevos en `tests/unit/pallet-contents.test.ts` para respetar la configuración actual.
- Build de producción y ESLint.
- 70 migraciones de la aplicación cargadas en PostgreSQL embebido (PGlite temporal), con stubs de los esquemas de plataforma `auth`/`storage`. Se omitieron las tres migraciones de cron/pg_net ajenas al cambio y la instalación de pgcrypto; `gen_random_uuid()` está disponible en el motor.
- Diez archivos SQL aprobados: `trz111_mixed_pallets_and_return`, `trz100_dispatch_quantity_match`, `trz100_erp_stock_balances`, `trz100_assigned_pallet_quantity`, `us_erp01_ops07_driver_delivery`, `us13_lot_traceability`, `us3_pallet_validation`, `us5_confirm_dispatch`, `trz99_dissociate_state`, `ush1_stock_import`.

Resultado: 396/396 tests de Node, 52/52 tests de Vitest, TypeScript y ESLint aprobados. También se verificó el backfill creando un pallet antes de las migraciones nuevas y comprobando que conserva QR, lote y cantidad desconocida. El build de producción terminó correctamente; mantiene el aviso de seguridad de Next.js indicado al final.

La prueba nueva se ejecuta también en Supabase local con:

```sh
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/trz111_mixed_pallets_and_return.sql
```

Usar una base local migrada: el archivo crea fixtures dentro de una transacción y hace rollback. Verifica permisos, aislamiento entre empresas, stock ERP del ítem secundario, reversión del armado fallido, comparación por ítem, invalidación de una validación obsoleta, recepción con diferencia, reingreso idempotente y reasignación sin borrar la entrega anterior.

Se verificaron las migraciones y sus estructuras en Supabase remoto. Al validar la entrega inicial quedaban pendientes los flujos de la aplicación en navegador; la revisión posterior se detalla abajo. Las pruebas embebidas no reemplazan una prueba de concurrencia con dos sesiones independientes; el tope reutiliza los locks de `erp_stock_balances` y el armado toma los lotes en orden de UUID.

Se corrigió una línea de portabilidad en `src/lib/erp-sync/server-boundary.test.ts`: la comprobación de límites de servidor normaliza los separadores de rutas Windows antes de aplicar la expresión regular. No cambia la regla de seguridad ni la configuración de tests; persona 1 puede conservar esa normalización al migrarlo a Vitest.

El aviso de seguridad anterior correspondía a la versión instalada al validar la entrega inicial. Persona 1 ya actualizó Next.js a 16.4.6 en `develop`.

## Revisión de cierre del 23/11/2026

La entrega inicial de persona 3 ya está integrada en `develop` mediante la PR #87. La revisión continúa en `codex/persona3-cierre`, creada desde `origin/develop` (`abc95ad`), con cambios limitados a pallets y su documentación.

Se corrigieron validaciones de las acciones de armado y reingreso: depósitos, QR y motivos con tipos incorrectos devuelven un error controlado antes de escribir; el depósito respeta su límite de 40 caracteres. La validación de cantidades reutiliza la regla compartida de unidades, evitando rechazar kilos grandes con dos decimales por precisión binaria, y rechaza arrays con posiciones vacías. Se agregaron 29 casos de prueba en archivos de persona 3, incluidos permisos, lotes ERP de la empresa, fallos de stock, reingreso idempotente y respuestas de error sin éxito falso.

Verificación actual: `npm test` aprobó 588 pruebas, con 6 omitidas por la suite existente; TypeScript, ESLint, build de producción y la comprobación de versiones únicas de las 75 migraciones aprobaron. Playwright aprobó 9 pruebas de `driver-delivery`, `responsive-dashboard` y `main-integration`: recepción por QR, validación de despacho, contenido mixto en trazabilidad/remito y pantallas entre 320 y 1280 px. Se usaron los fixtures locales existentes; no se probó el recorrido mixto completo contra la base remota, una cámara física ni una impresora. Estas correcciones no requieren otra migración ni modifican la base remota.

### Pedidos concretos al equipo para cerrar la ola 2

- **Persona 2:** acordar la identidad de cada línea de ítem, permitir repetir `palletCode` entre líneas del mismo pallet y definir la versión del contrato §5. Confirmar soporte de esas líneas en los adaptadores y sus validadores para despacho y entrega. Hoy el contrato sigue en versión 1, su validador rechaza `palletCode` repetido y los métodos de despacho/entrega de Odoo siguen sin implementación.
- **Persona 5:** integrar primero TRZ-112 y avisar qué interfaz queda para empresa/configuración y productores del outbox. Persona 3 debe construir el payload por ítem sobre esa separación, respetando los snapshots de la orden, sin competir por los mismos archivos.
- **Persona 1 — resuelto en PR #93:** incorporó fixtures para `create_pallet_with_items`, `return_pallet_to_warehouse` y varios ítems esperados/detectados, junto con la suite `npm run test:e2e:pallets`. Cubre armado → despacho → recepción exacta o con diferencias → reingreso → nueva orden. La PR ya está en `develop` y se integró en `codex/persona3-cierre`. Esta dependencia de cobertura queda resuelta; no habilita el contrato ERP de mixtos ni reemplaza las pruebas SQL.

Personas 4, 6 y 7 no bloquean este cierre. El reingreso deja el pallet sin posición para ubicarlo por el flujo existente; trazabilidad/remitos pueden consumir `contents.ts` y los snapshots de las órdenes; el QR conserva su identidad actual.

Mientras falten las dependencias de personas 2 y 5 se mantiene el rechazo `TM111` al despacho mixto por ERP. La siguiente entrega de persona 3 debe cambiar el payload, ajustar el contrato coordinado, probar los consumidores y recién entonces retirar esa restricción.

### Verificación tras integrar la PR #93 de persona 1

Las 61 pruebas de pallets y fixtures pasaron (`npx vitest run src/lib/pallets tests/unit/pallet-contents.test.ts tests/unit/pallets-fixture.test.ts`). Los dos recorridos de `npm run test:e2e:pallets` se completaron: la primera ejecución aprobó el caso con diferencias y falló el exacto por `page.goto: net::ERR_ABORTED` al abrir el detalle de entrega después del login del chofer; `npm run test:e2e:pallets -- --last-failed` aprobó el caso exacto completo.

Observación para persona 1: el helper `login` de `tests/e2e/mixed-pallets.spec.ts` espera únicamente salir de `/login`, pero el flujo pasa por `/complete-registration`, `/dashboard` y finalmente `/dashboard/deliveries`. La navegación siguiente puede competir con esa redirección. Conviene esperar la URL y el contenido final del rol antes del siguiente `page.goto`. No se modificaron las pruebas compartidas desde persona 3. Es una falla intermitente de sincronización observada, no un bloqueo funcional de pallets.

La cobertura se ejecutó exclusivamente con fixtures locales, sin escribir en Supabase remoto. Quedan pendientes las dependencias ERP de personas 2 y 5 descritas arriba.

## Acuerdo de persona 3 sobre la propuesta ERP v2

Persona 3 acepta la propuesta de persona 2 como base de la ola 2. Este apartado registra nuestra decisión de integración; no publica todavía el contrato ni reemplaza el documento con los DTO y ejemplos definitivos que prepara persona 2.

1. **Despacho:** mantener el reporte por orden y la forma de sus líneas. En v2, permitir varias líneas con el mismo `palletCode`; la identidad dentro del reporte es la tupla `(palletCode, productExternalId, lotExternalId)`. Repetir esa tupla es error. Usar identificadores externos, no nombres ni SKU como identidad. Un pallet monolote conserva una sola línea.
2. **Pick List:** aceptar un reporte por pallet con `items[]` tanto para `scan` como para `unscan`. La operación se acepta o falla para el pallet completo; un array no garantiza por sí solo atomicidad en el ERP, así que el adaptador debe evitar escrituras parciales y contemplar conflictos concurrentes. El `unscan` referencia la clave del scan original y revierte exactamente sus ítems guardados, aunque el contenido actual del pallet haya cambiado. Una nueva ronda de validación tiene otra identidad de scan; un reintento conserva la misma.
3. **Entrega:** conservar el resultado por pallet y admitir `content_mismatch` tanto en su resultado como en las diferencias, con `needsReview = true`. El detalle debe poder expresar más de un ítem afectado y distinguir esperado/detectado. Cuando el producto o lote detectado sea desconocido, conservar el dato observado sin inventar IDs externos. Persona 2 debe precisar los campos opcionales de ese detalle y mostrar ejemplos de faltante, sobrante, producto/lote incorrecto y cantidad distinta.
4. **Compatibilidad:** emitir los nuevos eventos como v2 y seguir procesando los eventos v1 almacenados, con su semántica original. La compatibilidad debe cubrir tipos, validadores, clasificación del outbox y adaptadores; revisar también las comprobaciones de versión de la sincronización si sus respuestas pasan a v2. No reescribir eventos v1 pendientes ni generar claves nuevas al reintentarlos. Si el adaptador normaliza v1 a un array de un ítem, esa conversión no modifica el payload persistido.

### Preparación de los productores de persona 3

- `order_pallets.expected_items` conserva el contenido asignado a esa orden. `dispatch_items` conserva lo validado y `reception_items` lo normalizado en recepción. Los snapshots contienen IDs locales de producto/lote y cantidad; no contienen por sí solos los IDs externos ni la unidad ERP.
- Construir el reporte de despacho desde el snapshot validado de la relación con esa orden, comprobado contra el esperado. Resolver IDs externos y unidad ERP dentro de la empresa y congelarlos al encolar el payload, en la misma transacción de la operación. No reconstruir un evento pendiente desde el contenido vigente del pallet ni desde un catálogo actualizado durante el reintento.
- Guardar el contenido completo de cada scan en su evento para poder revertirlo posteriormente. No usar `pallets.batch_id` ni `pallets.quantity` como contenido del mixto. Conservar las familias actuales de claves (`dispatch:`, `pallet-scan:`, `pallet-unscan:`, `delivery:`); coordinar con persona 5 el aislamiento de esas identidades por empresa y con persona 2 su formato definitivo.
- Para la recepción, combinar el snapshot esperado, el normalizado y los datos observados de los eventos. Un faltante o sobrante no puede desaparecer por no tener correspondencia en el catálogo ERP. El payload queda congelado antes de reingresar o reasignar el pallet.
- Preparar los casos de integración: dos ítems del mismo QR; repetición inválida de una tupla; scan/unscan completos con error en el segundo ítem; reintento sin duplicados; unscan después de editar/reingresar; recepción con varias diferencias e ítems desconocidos; replay de v1; dos empresas con iguales IDs externos; snapshots anteriores conservados después de una nueva orden.

Persona 2 puede avanzar con contrato/adaptadores sin esperar TRZ-112. Persona 3 implementará los productores cuando estén definidos esos DTO y esté integrada la separación por empresa de persona 5. La protección `TM111` se mantiene hasta verificar los productores y consumidores juntos; no se cambió código ni se aplicaron migraciones con este acuerdo.
