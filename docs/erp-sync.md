# Sincronización ERP → TrazFlow (US-ERP-03)

> Depende del contrato de US-ERP-02 ([`erp-contract.md`](erp-contract.md)). Código: `src/lib/erp-sync/` y las
> migraciones `20261019120000_erp_sync_schema.sql` y `20261019120100_erp_sync_rpcs.sql`.

## Qué hace

Importa y actualiza desde `ErpClient`, sin conocer el proveedor:

| ERP | TrazFlow | `external_id` |
|---|---|---|
| `products[]` | `products` | `externalId` del producto |
| `lots[]` | `batches` (cantidad 0) | `externalId` del lote |
| `stock[]` (lote × depósito) | `pallets` en `in_warehouse` | `stock:{lotExternalId}@{warehouseExternalId}` |
| `customer` de cada orden | `distributors` | `customer.externalId` |
| órdenes abiertas (solo cabecera) | `dispatch_orders` en `draft` | `externalId` de la orden |

Las entidades sincronizadas tienen `source_system` (`trazflow` | `erp`), `external_id` y `synced_at`. Productos y
lotes además tienen `external_active` (`false` = deshabilitado en el ERP; no se borra). La clave de upsert es siempre
`(company_id, external_id)` (índice único parcial). Nunca se usa el nombre visible ni el SKU.

## Cuándo está habilitada

`isErpEnabled(companyId)` (`src/lib/erp-sync/enabled.ts`) es la única función que decide. Hoy devuelve `true` si
`ERP_PROVIDER` está definido explícitamente. Con ERP habilitado:

- Se ocultan los formularios de alta de producto, lote y pallet, y la edición de pallets. Las Server Actions
  `createLot`, `createPallet` y `updatePallet` también lo rechazan del lado servidor. El código de alta manual
  sigue intacto para las empresas sin ERP.
- Pallets y Órdenes muestran el panel *Integración ERP* (solo logística) y la columna *Origen* (badge ERP,
  identificador externo y última sincronización).

## Flujo

`syncErpNow()` (Server Action) → `requireUserProfile()` + rol `logistics_manager` → `syncCompanyFromErp()`:

1. `erp_sync_start(company, actor, provider)` abre el registro en `erp_sync_runs`. Admite una sola ejecución por
   empresa a la vez; una que quedó `running` más de 15 minutos se cierra como `failed`.
2. `pullMasterData()` → `erp_sync_apply_products`, `_lots` y `_stock`.
3. `pullDispatchOrders()` → `erp_sync_apply_orders`.
4. `erp_sync_finish(run, error)` deja `success`, `partial` (hubo registros con error, o falló una etapa después de
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
- **Pallets:** la cantidad solo se actualiza si el pallet está `in_warehouse` y no tiene historia (eventos de
  trazabilidad, incluida la ubicación física, movimientos u órdenes asociadas). Si no, solo se toca `synced_at`
  (`protected`). Si un saldo baja a 0 o desaparece, el pallet queda como está y se cuenta en `absent`.
- **QR:** lo genera TrazFlow (`PAL-<uuid>`), nunca viene del ERP y sigue sin poder editarse.
- **Datos del ERP de solo lectura:** el trigger `guard_erp_synced_row` impide que la API (`authenticated`/`anon`)
  escriba `external_id`, `source_system`, `synced_at` o `external_active`. Tampoco deja editar los campos que vienen
  del ERP en los registros importados (SKU, nombre, unidad, lote, vencimiento, cantidad, cliente, fecha) ni borrar
  esos registros. El estado operativo (`status`, ubicación) sigue el flujo normal.

## Depósitos

Hoy TrazFlow tiene un solo depósito por empresa (`DEP-01`). Cada depósito del ERP se vincula a mano desde
*Pallets → Integración ERP* (tabla `erp_warehouse_mappings`). Un saldo de un depósito sin vincular es un error de
ese registro y queda auditado. El pallet importado queda con `current_location = 'DEP-01'` y sin ubicación física:
la asigna el operador desde Ubicaciones.

## Validaciones por registro (cada una se audita en `erp_sync_runs.errors`)

- Falta `externalId`, o viene repetido en la misma respuesta.
- Unidad sin equivalente. `Caja/Box/CJ` → `cajas`, `Kg/Kilogramo` → `kilogramos`, `Unidad/Unit/Nos` → `unidades`
  (`src/lib/erp-sync/units.ts`).
- Producto con un SKU que ya usa otro producto de TrazFlow (cargado a mano). No se fusionan por SKU.
- Lote cuyo producto no está sincronizado, o que ya está asociado a otro producto.
- Saldo sin lote, de un lote que no corresponde al producto, con una unidad distinta a la del producto, con
  decimales en `unidades`/`cajas` (o más de 2 en `kilogramos`), o de un depósito sin vincular.
- Orden sin cliente, con estado desconocido o con fecha que no es `YYYY-MM-DD`.

## `erp_sync_runs`

| Columna | Descripción |
|---|---|
| `status` | `running` \| `success` \| `partial` \| `failed` |
| `counters` | Por entidad (`products`, `lots`, `stock`, `orders`): `received`, `created`, `updated`, `unchanged`, `failed`; además `protected` (stock, órdenes), `absent` (stock), `skipped`, `customers_created` y `customers_updated` (órdenes). |
| `errors` | `[{ entity, external_id, message }]`, hasta 200 por ejecución. |
| `error_message` | Falla que cortó la ejecución (ERP caído, configuración inválida…). |

RLS: solo `logistics_manager` de la empresa puede leer. Nadie escribe directo: solo las RPC `erp_sync_*`.
`anon` no tiene privilegios sobre las tablas ni sobre las funciones nuevas.

## Pallets importados ≠ pallets físicos

Un pallet importado representa un **saldo de stock del ERP** (lote × depósito), no un pallet físico verificado. La
etiqueta QR se imprime recién cuando el pallet se prepara físicamente (US-OPS-08).

## Pruebas

- `supabase/tests/us_erp03_erp_sync.sql`: autorización (solo logística de la empresa, actor = sesión), escrituras
  directas denegadas, registros parciales, colisiones (SKU manual, `externalId` repetido, lote de otro producto), la
  segunda sincronización no duplica nada, la re-sincronización no pisa órdenes avanzadas ni pallets con historia,
  saldos ausentes, QR generado y no editable, concurrencia, ejecución cerrada y RLS por empresa y rol. Correr con
  `psql -v ON_ERROR_STOP=1 -f supabase/tests/us_erp03_erp_sync.sql` sobre una base local migrada.
- `src/lib/erp-sync/*.test.ts` (`npm test`): orden de las llamadas, traducción de unidades, fallas del ERP
  (timeout, 401, configuración, contrato), errores sin filtrar detalles y frontera servidor/cliente.

## Mejoras futuras

- Líneas de orden (`dispatch_order_lines`): hoy solo se importa la cabecera.
- Flag de ERP por empresa: cambiar `isErpEnabled`.
- Cron o webhook sin usuario: permitir `service_role` en las RPC con un actor técnico.
- Sincronización incremental con `updatedSince`. Hoy se trae todo, porque el stock es una foto completa y así se
  pueden contar los saldos ausentes.
- `manufacturingDate` del lote no se guarda (no hay columna).
