# Sincronización ERP → TrazFlow (US-ERP-03)

> Depende del contrato de US-ERP-02 ([`erp-contract.md`](erp-contract.md)). Código: `src/lib/erp-sync/` y las
> migraciones `20261019120000_erp_sync_schema.sql` y `20261019120100_erp_sync_rpcs.sql`. TRZ-100 separó el saldo
> del ERP de los pallets físicos: migraciones `20261028100000` a `20261028100300` (`trz100_*`).

## Qué hace

Importa y actualiza desde `ErpClient`, sin conocer el proveedor:

| ERP | TrazFlow | `external_id` |
|---|---|---|
| `products[]` | `products` | `externalId` del producto |
| `lots[]` | `batches` (cantidad 0) | `externalId` del lote |
| `stock[]` (lote × depósito) | `erp_stock_balances` (saldo, solo lectura) | clave natural `(empresa, lote, depósito del ERP)` |
| `customer` de cada orden | `distributors` | `customer.externalId` |
| órdenes abiertas | `dispatch_orders` en `draft` | `externalId` de la orden |
| `lines[]` de cada orden | `dispatch_order_lines` | `(order_id, externalId de la línea)` |

Hasta TRZ-100 cada saldo se convertía en un pallet `stock:{lote}@{depósito}`. Esos pallets **heredados** se
conservan (tienen trazabilidad) y se ven con el badge "Heredado de saldo ERP", pero la sincronización ya no crea ni
toca pallets. Ver "Saldo del ERP ≠ pallets físicos".

Las entidades sincronizadas tienen `source_system` (`trazflow` | `erp`), `external_id` y `synced_at`. Productos y
lotes además tienen `external_active` (`false` = deshabilitado en el ERP; no se borra). La clave de upsert es siempre
`(company_id, external_id)` (índice único parcial). Nunca se usa el nombre visible ni el SKU.

## Cuándo está habilitada

`isErpEnabled(companyId)` (`src/lib/erp-sync/enabled.ts`) es la única función que decide. Hoy devuelve `true` si
`ERP_PROVIDER` está definido explícitamente. Con ERP habilitado:

- Se ocultan los formularios de alta de producto y lote (`createLot` también lo rechaza en el servidor).
- **Pallets (TRZ-100):** solo `logistics_manager` los arma, eligiendo un lote sincronizado del ERP (activo, de
  producto activo y con saldo) y cargando la cantidad real ("Armar pallet" en Pallets). `createPallet` rechaza en
  el servidor un lote que no sea del ERP. `updatePallet` solo cambia la cantidad de pallets `in_warehouse`,
  `source_system = 'trazflow'` y de lote del ERP. El tope por saldo lo valida la base. Los heredados no se editan.
  Sin ERP, alta y edición siguen exactamente igual que antes.
- **Las órdenes de despacho solo entran por la sincronización (TRZ-102).** Órdenes no muestra "Nueva orden" sino
  el aviso "Las órdenes se crean en el ERP y entran a TrazFlow al sincronizar.", `/dashboard/orders/new` muestra
  ese aviso en lugar del formulario, y `createDispatchOrder` rechaza la creación del lado servidor (después del
  chequeo de rol y antes de escribir; la decisión está en `src/lib/orders/erp-policy.ts`). Motivo: el contrato
  del ERP no permite crear órdenes, y `confirm_dispatch_order` solo genera el reporte al ERP si la orden tiene
  `external_id`; una orden manual se despacharía sin informarse y el ERP seguiría contando ese stock.
  - La protección es solo del servidor. La base no sabe si el ERP está activo (es una variable de entorno del
    servidor, global), así que no hay trigger: con la policy `orders_insert`, un `logistics_manager` que
    escribiera directo contra la API de Supabase podría insertar una orden manual. Cuando exista un flag de ERP
    por empresa en la base, conviene sumar ahí un trigger que rechace los inserts con `source_system = 'trazflow'`.
  - Las órdenes manuales creadas antes de activar el ERP eran datos de prueba y se borran a mano junto con sus
    pallets; no se conservan ni se listan como "no informadas al ERP".
- Pallets y Órdenes muestran el panel *Integración ERP* (solo logística) y la columna *Origen* (badge ERP,
  identificador externo y última sincronización).

## Flujo

`syncErpNow()` (Server Action) → `requireUserProfile()` + rol `logistics_manager` → `syncCompanyFromErp()`:

1. `erp_sync_start(company, actor, provider)` abre el registro en `erp_sync_runs`. Admite una sola ejecución por
   empresa a la vez; una que quedó `running` más de 15 minutos se cierra como `failed`.
2. **Estado de los remitos (TRZ-100):** `checkErpDispatchDocuments` consulta en el ERP los remitos de los
   despachos ya reportados y guarda el resultado (`erp_sync_save_dispatch_documents`, contadores en
   `counters.dispatch_documents`, errores con `entity: "dispatch_document"`). Va **antes** de `pullMasterData` a
   propósito: primero se ve la confirmación del remito y después se trae el saldo, que ya la refleja, así que los
   pallets despachados se liberan del tope en la misma corrida. Si falla, la sincronización sigue y termina
   `partial`. Ver "Estado del remito".
3. `pullMasterData()` → `erp_sync_apply_products`, `_lots` y `_stock`.
4. `pullDispatchOrders()` → `erp_sync_apply_orders` (con sus líneas).
5. `erp_sync_finish(run, error)` deja `success`, `partial` (hubo registros con error, o falló una etapa después de
   aplicar algo) o `failed` (no se aplicó nada).

Las llamadas al ERP se hacen entre RPC, nunca con una transacción abierta. Cada RPC procesa sus registros de a uno en
un subbloque con savepoint: si un registro falla, se audita y se sigue con el resto. Los errores del ERP se guardan
con el mensaje sanitizado de `ErpError`. Cualquier otro error inesperado se guarda como "Error inesperado durante la
sincronización", sin el detalle.

`syncCompanyFromErp({ db, companyId, actorId, provider, getClient })` es reutilizable: recibe al actor y un cliente de
base autenticado como ese actor. Un cron o webhook sin usuario queda para más adelante: hoy las RPC exigen que
`actorId` sea `auth.uid()`, con rol de logística en esa empresa.

## Reglas que protegen el trabajo local

- **Nunca se borra nada** porque deje de venir del ERP.
- **Órdenes:** una orden nueva entra en `draft`, con `created_by` igual a quien sincroniza. Si `scheduledDate` es
  null, se usa la fecha del día de la sincronización. Una orden existente solo se actualiza (cliente y fecha) si
  sigue en `draft`. En cualquier otro estado (validando, con diferencia, despachada, entregada…) solo se toca
  `synced_at` y se cuenta como `protected`. Las órdenes `delivered` o `cancelled` en el ERP se cuentan como
  `skipped`.
- **Saldos:** upsert de `erp_stock_balances` por `(empresa, lote, depósito del ERP)`. Un saldo que baja a 0 se
  guarda en 0 y uno que deja de venir pasa a 0 (`absent`): nunca se borran. Cada sincronización actualiza
  `synced_at` de todos los saldos de la empresa, también los que pasan a 0, **salvo** los de registros que
  fallaron en esa corrida: no se pudieron confirmar, y si se marcaran como sincronizados el tope liberaría pallets
  contra un saldo viejo. `quantity_changed_at` cambia solo si cambia la cantidad. La sincronización no toca
  pallets; ya no hay contador `protected` en stock.
- **Líneas de orden:** se crean o actualizan solo mientras la orden está en `draft`. En ese estado son un espejo
  del ERP: las que dejan de venir se borran. Con la orden en cualquier otro estado no se tocan. Una línea con
  producto no sincronizado, unidad distinta de la del producto o cantidad inválida para esa unidad **rechaza la
  orden entera** (error auditado, `failed`), igual que una orden sin líneas: no se importa una orden que después no
  se podría comparar ni reportar bien. Las órdenes que ya existían fuera de `draft` quedan sin líneas.
- **QR:** lo genera TrazFlow (`PAL-<uuid>`), nunca viene del ERP y sigue sin poder editarse.
- **Datos del ERP de solo lectura:** el trigger `guard_erp_synced_row` impide que la API (`authenticated`/`anon`)
  escriba `external_id`, `source_system`, `synced_at` o `external_active`. Tampoco deja editar los campos que vienen
  del ERP en los registros importados (SKU, nombre, unidad, lote, vencimiento, cantidad, cliente, fecha) ni borrar
  esos registros. El estado operativo (`status`, ubicación) sigue el flujo normal.

## Depósitos

Hoy TrazFlow tiene un solo depósito por empresa (`DEP-01`). Cada depósito del ERP se vincula a mano desde
*Pallets → Integración ERP* (tabla `erp_warehouse_mappings`); se pueden vincular varios al mismo depósito de
TrazFlow y sus saldos se suman. Un saldo de un depósito sin vincular es un error de ese registro y queda auditado.

Cada pallet sabe en qué depósito está (`pallets.warehouse_code`, backfill `DEP-01`; para los entregados es el
depósito de origen). La app no lo elige: no está en los grants de insert/update y la base usa el default, el mismo
que `warehouse_locations` y `erp_warehouse_mappings`. Si el pallet tiene ubicación física, una FK compuesta exige
que sea del mismo depósito (`pallets_location_warehouse_fkey`; con `current_location_id` null no se verifica).

**Preparado para TRZ-101 etapa 2 (tabla `warehouses`):** el depósito de TrazFlow se identifica siempre por
`(company_id, warehouse_code)` en texto en `warehouse_locations`, `erp_warehouse_mappings`, `erp_stock_balances` y
`pallets`. Las tablas y columnas nuevas no tienen `check (warehouse_code = 'DEP-01')` (las dos anteriores sí): la
etapa 2 solo tiene que agregar las FK y sacar esos checks. El default `'DEP-01'` de `pallets.warehouse_code`
habría que reemplazarlo por el depósito que corresponda al alta.

## Validaciones por registro (cada una se audita en `erp_sync_runs.errors`)

- Falta `externalId`, o viene repetido en la misma respuesta.
- Unidad sin equivalente. `Caja/Box/CJ` → `cajas`, `Kg/Kilogramo` → `kilogramos`, `Unidad/Unit/Nos` → `unidades`
  (`src/lib/erp-sync/units.ts`).
- Producto con un SKU que ya usa otro producto de TrazFlow (cargado a mano). No se fusionan por SKU.
- Lote cuyo producto no está sincronizado, o que ya está asociado a otro producto.
- Saldo sin lote, de un lote que no corresponde al producto, con una unidad distinta a la del producto, con
  cantidad negativa, con decimales en `unidades`/`cajas` (o más de 2 en `kilogramos`), o de un depósito sin
  vincular. El `external_id` del error es `{lote}@{depósito}`.
- Orden sin cliente, con estado desconocido, con fecha que no es `YYYY-MM-DD`, sin líneas, o con una línea
  inválida (ver "Líneas de orden").

## `erp_sync_runs`

| Columna | Descripción |
|---|---|
| `status` | `running` \| `success` \| `partial` \| `failed` |
| `counters` | Por entidad (`products`, `lots`, `stock`, `orders`): `received`, `created`, `updated`, `unchanged`, `failed`; además `absent` (stock), `protected`, `skipped`, `customers_created` y `customers_updated` (órdenes). `dispatch_documents`: `received`, `draft`, `confirmed`, `cancelled`, `not_found`, `failed`. |
| `errors` | `[{ entity, external_id, message }]`, hasta 200 por ejecución. `entity`: `products`, `lots`, `stock`, `orders` o `dispatch_document`. |
| `error_message` | Falla que cortó la ejecución (ERP caído, configuración inválida…). |

RLS: solo `logistics_manager` de la empresa puede leer. Nadie escribe directo: solo las RPC `erp_sync_*`.
`anon` no tiene privilegios sobre las tablas ni sobre las funciones nuevas.

## Saldo del ERP ≠ pallets físicos (TRZ-100)

**Saldo** es cuánto hay de un lote en un depósito según el ERP: un número. **Pallet** es el objeto físico con su QR y
su cantidad real, que solo conoce TrazFlow. Antes, cada saldo se convertía en un pallet; eso hacía despachar e
informar al ERP más de lo pedido (orden de 65 cajas con pallets de 120 y 80: salían los dos y se informaban 200),
impedía despachar parte de un lote y el QR no correspondía a nada físico. Ahora:

- los saldos están en `erp_stock_balances` (lectura para logística y depósito; escritura solo por la sincronización);
- logística arma los pallets físicos contra un lote del ERP (por ejemplo 40 + 25 del lote de 120);
- la base impide superar el saldo (tope).

## Tope por saldo

Por **(empresa, lote, `warehouse_code`)**: la suma de los pallets que cuentan no puede superar el saldo, que es la
suma de los `erp_stock_balances` de ese lote cuyos depósitos del ERP están vinculados a ese `warehouse_code`. Solo
para lotes del ERP (`batches.source_system = 'erp'`): los lotes manuales no tienen tope, así que una empresa sin ERP
no cambia en nada.

| Situación del pallet | Fase (`erp_pallet_stock_usage`) | ¿Cuenta? |
|---|---|---|
| `in_warehouse` o `assigned` (en depósito o en una orden sin confirmar) | `in_warehouse` | Sí |
| Despachado; el reporte al ERP no se envió (evento `pending`/`processing`/`failed`) | `report_pending` | Sí |
| Despachado; reporte enviado, remito sin consultar o en borrador | `document_pending` | Sí |
| Despachado; remito confirmado, pero el saldo no se sincronizó después de que TrazFlow vio la confirmación | `confirmed_unsynced` | Sí |
| Despachado; remito confirmado y saldo sincronizado después | `released` | **No** (el ERP ya lo descontó) |
| Despachado; remito anulado o no encontrado | `document_problem` | Sí (el stock nunca salió del ERP) |
| Despachado con un evento anterior a TRZ-100 (`not_tracked`) | `not_tracked` | No |
| Despachado en una orden manual (sin `external_id`, sin reporte) | `manual_order` | No. Con ERP activo ya no se pueden crear (TRZ-102) |
| Orden del ERP despachada sin evento en el outbox (anterior a US-ERP-04) | `untracked_dispatch` | No |
| Salió del depósito sin un despacho confirmado (no debería pasar) | `departed_without_dispatch` | Sí (por las dudas) |

**Qué es "despachado":** el pallet ya no está `in_warehouse`/`assigned`. Los 7 estados de `pallet_status`:
`in_warehouse` y `assigned` → primera fila; `in_transit`, `received`, `discrepancy`, `delivered` y
`delivery_discrepancy` → despachado, porque solo se llega a ellos después de `confirm_dispatch_order` (que los
deja `in_transit`; la entrega del chofer los pasa a `delivered`/`delivery_discrepancy`, y `received`/`discrepancy`
son los estados de recepción viejos). El despacho que cuenta es la orden confirmada (`confirmed_at` no nulo) donde
el pallet estaba con `expected = true`, y su evento `dispatch_confirmed` del outbox. La desasociación de TRZ-99 solo
devuelve a `in_warehouse` pallets `assigned` de órdenes en borrador, así que un pallet desasociado vuelve a la
primera fila.

**"Se sincronizó después de la confirmación"** = el `synced_at` más viejo entre los saldos de ese lote en ese
`warehouse_code` es posterior a `erp_document_confirmed_seen_at` del evento. Se compara contra el momento en que
TrazFlow **vio** la confirmación, no contra la hora del ERP: no depende de la zona horaria de ERPNext, y cualquier
saldo sincronizado después ya refleja la confirmación.

**Por qué así:** si los despachados no contaran nunca, con ERPNext habría una ventana para armar de más (entre que
se envía el remito y alguien lo confirma, el saldo sigue alto). Si contaran siempre, después de confirmar el remito
el saldo baja y la mercadería se resta dos veces, bloqueando stock que existe.

**Ejemplo (lote de 120):** se arman 40 + 25 → disponible 55. Se despachan; el remito queda en borrador → siguen
contando, disponible 55, aviso "Esperando remito (MAT-DN-…)". Administración confirma; la próxima sincronización ve
la confirmación y trae el saldo en 55 → los 65 dejan de contar, disponible 55 (saldo nuevo, sin restar dos veces).
Con el mock, que no descuenta stock, el saldo vuelve a ser 120 y el disponible también: es esperable.

**Dónde se valida:** en la base, con el trigger `trg_pallets_erp_stock_cap` (`before insert or update of quantity,
batch_id, warehouse_code`), porque logística puede insertar pallets directo por la API de Supabase. Bloquea con
`select … for update` las filas de `erp_stock_balances` del lote y depósito, suma lo que cuenta (sin la fila que se
edita) y rechaza:

| `errcode` | Caso | Mensaje en la app (`src/lib/pallets/erp-stock-errors.ts`) |
|---|---|---|
| `TF100` | Supera el saldo. `DETAIL` = `{"available", "unit", "lot", "warehouseCode"}` | "La cantidad supera el saldo del ERP: quedan 55 cajas disponibles del lote L-2026-0915 en DEP-01." |
| `TF101` | El lote no tiene saldo en el ERP para ese depósito | "Ese lote no tiene saldo en el ERP para este depósito…" |
| `TF102` | Lote o producto inactivo en el ERP | "El lote o su producto está inactivo en el ERP…" |

Una edición que no sube la cantidad ni cambia lote o depósito no se valida (bajar siempre se puede).

**Concurrencia:** dos altas simultáneas del mismo lote se serializan en el `for update`. En `read committed`, cada
sentencia del trigger toma una foto nueva, así que la suma que corre después de obtener el lock ya ve el pallet que
confirmó la primera transacción. La sincronización también bloquea esas filas al actualizar el saldo. Los pasos
para probarlo a mano con dos sesiones `psql` están en el encabezado de `supabase/tests/trz100_erp_stock_balances.sql`.

**Lo que la base no puede impedir:** que el saldo baje en una sincronización, o que un remito se anule y sus pallets
vuelvan a contar. La suma puede quedar por encima del saldo. No se rompe nada: el disponible queda negativo y el
selector de "Armar pallet" no ofrece ese lote.

**Dónde se ve:** el selector de lote de "Armar pallet" muestra producto, lote y disponible, y un aviso que no
bloquea: la etiqueta del remito ("Esperando remito (MAT-DN-…)", "Remito confirmado, falta sincronizar", "Remito
anulado / no encontrado en el ERP") y "Hay X despachadas con remito todavía sin confirmar en el ERP". Los números
salen de `erp_stock_overview()` (logística y depósito), con la misma regla que el trigger.

## Estado del remito

`getDispatchStatus(idempotencyKey)` es una operación del contrato ([`erp-contract.md`](erp-contract.md) §5.2). El
resultado se guarda en el evento del outbox (`erp_document_status`, `erp_document_checked_at` y
`erp_document_confirmed_seen_at`, que se fija solo la primera vez que se ve `confirmed`). Los eventos que ya estaban
`sent` cuando se aplicó la migración quedaron `not_tracked`: eran remitos del mock que ERPNext no conoce, no se
consultan y sus pallets no cuentan.

- `erp_outbox_dispatch_documents_due(company, limit)` devuelve los enviados sin consultar, en borrador, no
  encontrados o anulados. Los anulados y no encontrados se reconsultan porque en ERPNext un remito anulado se puede
  corregir y un borrador borrado se puede volver a crear. Los confirmados no se reconsultan: **si alguien anula un
  remito ya confirmado, TrazFlow no se entera** (limitación conocida).
- `erp_outbox_record_dispatch_document(event, status, reference)` guarda la respuesta.
- Las dos aceptan `service_role` (con la empresa como parámetro), `logistics_manager` y `warehouse_operator` de su
  empresa (`erp_outbox_actor_company()`). Escrituras directas denegadas, `anon` sin privilegios.

`checkErpDispatchDocuments({ db, getClient, companyId, limit })` (`src/lib/erp-outbox/dispatch-documents.ts`) **no
depende de una sesión de usuario**: TRZ-104 la va a llamar desde un cron con un cliente `service_role`, por empresa.
Nunca lanza: devuelve contadores y errores. Si el ERP no responde (timeout, red, 5xx, 429) corta la consulta y los
eventos que faltan se retoman la próxima vez.

## Pedido vs. armado

En el detalle de una orden del ERP (logística) y en la pantalla de confirmación de despacho (depósito) se ve, por
producto, lo pedido (suma de líneas), lo armado (suma de pallets asociados con `expected = true`) y la diferencia,
con un aviso "sobran X" / "faltan X". **Es solo un aviso:** no bloquea la validación ni la confirmación. Una orden
del ERP sin líneas muestra "Esta orden se importó sin líneas del ERP". Las órdenes manuales y las empresas sin ERP
no muestran la tabla.

## Pruebas

- `supabase/tests/us_erp03_erp_sync.sql`: autorización (solo logística de la empresa, actor = sesión), escrituras
  directas denegadas, registros parciales, colisiones (SKU manual, `externalId` repetido, lote de otro producto), la
  segunda sincronización no duplica nada, la re-sincronización no pisa órdenes avanzadas ni toca pallets (físicos
  o heredados), saldos ausentes, QR no editable, concurrencia, ejecución cerrada y RLS por empresa y rol.
- `supabase/tests/trz100_erp_stock_balances.sql`: saldos (alta, cambio, 0, ausentes, `synced_at`,
  `quantity_changed_at`, depósito sin vincular), líneas (import, espejo en borrador, intactas fuera de borrador,
  órdenes rechazadas), tope (dos depósitos sumados, sin saldo, inactivos, lotes manuales, insert y edición directos
  por la API, depósito no elegible), cada fila de la tabla del tope, la vista, las RPC del remito por rol y empresa,
  auditoría en la sincronización, RLS y payload del outbox. Incluye los pasos de la prueba de concurrencia manual.
- `supabase/tests/trz100_cloud_state_fixture.sql` + `trz100_cloud_state_checks.sql`: la migración sobre una réplica
  del estado de la nube (el método está en el encabezado del fixture).
- Correr cada uno con `psql -v ON_ERROR_STOP=1 -f …` sobre una base local migrada.
- `src/lib/erp-sync/*.test.ts` (`npm test`): orden de las llamadas (los remitos antes de `pullMasterData`), líneas
  de orden, traducción de unidades, fallas del ERP (timeout, 401, configuración, contrato, consulta de remitos que
  deja la corrida `partial`), errores sin filtrar detalles y frontera servidor/cliente.
- `src/lib/erp-outbox/dispatch-documents.test.ts`, `src/lib/pallets/erp-stock-errors.test.ts`,
  `src/lib/erp-stock/*.test.ts` y `src/lib/orders/lines.test.ts`.

## Mejoras futuras

- Flag de ERP por empresa: cambiar `isErpEnabled`.
- Repartir un pallet entre dos líneas del mismo producto: hoy el reporte va con `orderLineExternalId` null en ese
  caso.
- Reconsultar remitos confirmados para detectar una anulación posterior.
- Cron o webhook sin usuario: permitir `service_role` en las RPC con un actor técnico.
- Sincronización incremental con `updatedSince`. Hoy se trae todo, porque el stock es una foto completa y así se
  pueden contar los saldos ausentes.
- `manufacturingDate` del lote no se guarda (no hay columna).
