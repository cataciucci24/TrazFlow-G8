# US-C1 — Contrato de integración TrazFlow ↔ ERP

> Estado: **diseño aprobado** (no hay código implementado). Desbloquea US-C2, US-C3 y US-C4.
> ERP de referencia para la demo: **Odoo 19** (Community, instalable localmente).
> Las decisiones tomadas están registradas en la [§6](#6-decisiones-tomadas).

## 0. Principio rector

TrazFlow **no duplica** lo que un ERP ya resuelve: alta y gestión de stock, valorización, lógica FIFO/FEFO y
cálculo de vencimientos/alertas. Esto lo confirmó la entrevista con el cliente que usa Softplan.

TrazFlow aporta lo que el ERP **no ve**: la realidad física.

| Dueño | Responsabilidad |
|---|---|
| **ERP** | Maestro de productos, **alta de stock** (compras/producción), lotes y sus fechas de vencimiento/alerta, reglas FIFO/FEFO, documentos de entrada/salida. |
| **TrazFlow** | Identidad física del pallet (QR), **armado de pallets** con stock que ya existe en el ERP, ubicación real, validación de carga por escaneo, discrepancias de despacho/recepción, trazabilidad de movimientos. |

Regla práctica: si un dato se **calcula** a partir de reglas de negocio de inventario, o es un dato maestro, se lee
del ERP. Si un dato se **observa** en el depósito o en la ruta, nace en TrazFlow y se reporta al ERP.

La integración es **opcional por empresa**: si la empresa no tiene un ERP conectado, TrazFlow funciona como hoy
(alta manual de productos y lotes, sin eventos).

---

## 1. Resumen: qué entra y qué sale

| # | Dirección | Evento / dato | Disparador en TrazFlow | Destino en Odoo | Frecuencia |
|---|---|---|---|---|---|
| 1 | ERP → TrazFlow | **Productos** (SKU, nombre, unidad) | Sincronización | `product.product` (lectura) | Programada |
| 2 | ERP → TrazFlow | **Lotes con vencimientos y alertas** | Sincronización | `stock.lot` (`expiration_date`, `alert_date`, `removal_date`, `product_expiry_alert`) | Programada |
| 3 | ERP → TrazFlow | **Stock actual** por producto/lote/paquete/ubicación | Sincronización | `stock.quant` (lectura) | Programada |
| 4 | TrazFlow → ERP | **Pallet armado** (`pallet.packed`) | Insert en `pallets` | Transferencia interna que mete stock suelto del lote en un `stock.package` (= QR) | Por evento |
| 5 | TrazFlow → ERP | **Pallet ajustado** (`pallet.adjusted`) | Update de cantidad/lote/unidad de un pallet en depósito | Transferencia interna que reacomoda la diferencia entre el paquete y el stock suelto | Por evento |
| 6 | TrazFlow → ERP | **Pallet desarmado** (`pallet.unpacked`) | Delete de un pallet en depósito | Transferencia interna que vacía el paquete al stock suelto | Por evento |
| 7 | TrazFlow → ERP | **Consumo de lote / salida física** (`dispatch.confirmed`) | RPC `confirm_dispatch_order` | `stock.picking` de entrega con una línea por pallet validado | Por evento |
| — | Fuera de alcance | Recepción en distribuidor (`receive_order_pallet`) | — | La mercadería ya salió del stock de la empresa (ver §3.4) | — |

Ninguno de los eventos 4, 5 y 6 cambia el **total** de stock en el ERP: solo agrupan o desagrupan stock que el
ERP ya tiene. La única operación de TrazFlow que reduce stock en el ERP es el despacho (7).

---

## 2. Mecanismo elegido para la demo

### 2.1 Decisión

- **Transporte:** API externa de Odoo 19, protocolo **JSON-2** (`POST /json/2/<modelo>/<método>`, autenticación
  con API key como `Authorization: bearer <key>`).
- **Dónde corre:** una **Supabase Edge Function** (`erp-sync`) que contiene el adaptador de Odoo. Ni el navegador ni
  la app Next.js hablan con el ERP.
- **Cuándo corre:** la dispara **`pg_cron`** (vía `pg_net`) desde la propia base:

  | Job | Frecuencia | Qué hace |
  |---|---|---|
  | `erp-outbox-drain` | cada 1 minuto | Envía los eventos pendientes de `erp_outbox` (TrazFlow → ERP). |
  | `erp-snapshot-sync` | cada 15 minutos | Lee productos, lotes y stock del ERP y actualiza las tablas espejo (ERP → TrazFlow). |

  Además, logística puede forzar un `erp-snapshot-sync` desde la UI (por ejemplo, antes de armar pallets).
- **Desacople:** **patrón outbox**. Las acciones de TrazFlow escriben un evento en `erp_outbox` dentro de la misma
  transacción de Postgres; la Edge Function lo envía después.

### 2.2 Por qué JSON-2 y no XML-RPC / JSON-RPC

El backlog mencionaba XML-RPC/JSON-RPC. Al revisar la documentación oficial de Odoo 19 aparece que:

- Odoo 19 introduce la **API JSON-2**: HTTP + JSON + bearer token, una URL por modelo y método. Es lo más
  parecido a REST que ofrece Odoo y se consume con `fetch` sin librerías extra.
- Los endpoints `/xmlrpc`, `/xmlrpc/2` y `/jsonrpc` están **deprecados** y su remoción está anunciada para
  **Odoo 22 (otoño 2028)**. Construir una integración nueva sobre ellos es deuda técnica desde el día uno.
- El modelo de datos y los métodos son **los mismos** (`search_read`, `create`, `write`, `button_validate`…): lo
  único que cambia es el transporte. Si hubiera que usar Odoo 17/18, el adaptador puede pasar a `execute_kw` vía
  `/jsonrpc` sin tocar el resto del diseño.

### 2.3 Por qué Edge Function + `pg_cron`

| Alternativa | Descartada porque |
|---|---|
| Vercel Cron llamando a un Route Handler de Next.js | En el plan gratuito de Vercel un cron corre como máximo **una vez por día**: no alcanza ni para el outbox ni para la sincronización. |
| Llamar a Odoo desde dentro de las funciones PL/pgSQL | Una llamada HTTP dentro de la transacción del RPC la alarga, la hace fallar si el ERP está caído y no se puede deshacer en el ERP si luego la transacción hace rollback. |
| Llamar a Odoo desde la Server Action que hizo el cambio | Si la llamada falla después del insert, el evento se pierde; además, los RPCs de despacho no pasan por Server Actions con lógica propia. |
| Acceso directo a la base de Postgres de Odoo | Saltea reglas de negocio y permisos del ERP; acopla al schema interno. Contradice el principio rector. |
| Webhooks de Odoo (reglas de automatización) | Útiles para que el ERP *avise* cambios; quedan como mejora futura de la sincronización. Para la demo alcanza con polling. |

`pg_cron` y `pg_net` vienen incluidos en Supabase, y la Edge Function corre cerca de la base con la service role,
así que todo el circuito queda dentro de Supabase.

### 2.4 Consecuencias que el diseño tiene que absorber

- **Cada llamada JSON-2 es su propia transacción en Odoo.** Un flujo de varios pasos (crear paquete → crear
  transferencia → validar) no es atómico. El adaptador tiene que ser **idempotente y reanudable**: antes de crear,
  busca por la referencia externa (`origin = "TRZ-<event_id>"`).
- **Orden por pallet.** Los eventos de un mismo pallet (`packed` → `adjusted` → `unpacked`) se envían en orden de
  `created_at`; si uno queda pendiente, los siguientes de ese pallet esperan. Así un ajuste nunca llega al ERP
  antes que el armado.
- **El ERP puede estar caído.** La operación física en TrazFlow **nunca se bloquea** por el ERP: el despacho se
  confirma igual y el evento queda pendiente con reintentos.
- **Los espejos pueden estar desactualizados** (hasta 15 minutos). TrazFlow los usa para guiar al usuario (qué lotes
  hay, cuánto stock suelto queda), pero quien decide si una operación es posible es el ERP al recibir el evento.
- **Credenciales:** la API key de Odoo se guarda como secreto de la Edge Function (`supabase secrets set`), nunca en
  la base ni en variables `NEXT_PUBLIC_*`. Va asociada a un usuario técnico de Odoo con permisos de
  Inventario/Usuario.

---

## 3. Puntos de enganche en el código actual

> Las migraciones existentes no se editan: cada enganche en SQL se hace con una **migración nueva** que redefine la
> función (`create or replace`) o agrega un trigger.
>
> Todos los enganches **solo encolan eventos si la empresa tiene una conexión ERP activa** (`erp_connections`, §4.1).

### 3.1 Alta, edición y baja de pallets (hoy: operaciones directas desde Server Actions)

| Qué | Dónde | Cambio con ERP conectado |
|---|---|---|
| Upsert de producto por SKU | [src/lib/pallets/actions.ts:47-51](../src/lib/pallets/actions.ts#L47-L51) y [:99-103](../src/lib/pallets/actions.ts#L99-L103) | El producto se elige con un **selector alimentado por `erp_products`**; la fila local de `products` se crea o actualiza desde el espejo. Sin ERP, sigue el alta manual. |
| Insert de lote (`createLot`) | [src/lib/pallets/actions.ts:56-61](../src/lib/pallets/actions.ts#L56-L61) | **No se usa**: los lotes los da de alta el ERP. La fila local de `batches` se crea desde `erp_lot_snapshots` (con su `expiration_date`). Sin ERP, sigue el alta manual. |
| Insert de pallet (`createPallet`) | [src/lib/pallets/actions.ts:114-120](../src/lib/pallets/actions.ts#L114-L120) | Se elige un lote del ERP y se muestra el stock suelto disponible (`erp_unpacked_stock`, §3.3) como referencia. Encola **`pallet.packed`**. |
| Edición de pallet (`updatePallet`) | [src/lib/pallets/actions.ts:180-184](../src/lib/pallets/actions.ts#L180-L184) | Si cambia `quantity`, `unit_of_measure` o `batch_id`, encola **`pallet.adjusted`**. Cambiar solo `current_location` no genera evento (es dato propio de TrazFlow). |
| Baja de pallet (`deletePallet`) | [src/lib/pallets/actions.ts:213-218](../src/lib/pallets/actions.ts#L213-L218) | Solo pallets `in_warehouse` (ya era así). Encola **`pallet.unpacked`**. |
| Tablas | [supabase/migrations/0001_init_schema.sql:115-139](../supabase/migrations/0001_init_schema.sql#L115-L139) | `batches` y `pallets`. Cantidad del pallet en [20260918000100_add_pallet_quantity.sql](../supabase/migrations/20260918000100_add_pallet_quantity.sql). |

**Propuesta de enganche:** triggers sobre `pallets` que escriben en `erp_outbox`:

- `AFTER INSERT` → `pallet.packed`.
- `AFTER UPDATE OF batch_id, quantity, unit_of_measure`, solo si `old.status = 'in_warehouse'` y algún valor
  cambió → `pallet.adjusted` (con valores anteriores y nuevos). La lista de columnas importa: los RPCs de despacho
  y recepción actualizan `status` y `current_location`, y eso **no** debe disparar ajustes.
- `AFTER DELETE` → `pallet.unpacked` (con el QR en el payload, porque la fila ya no existe).

Se prefiere trigger antes que código en la Server Action porque las operaciones son directas con el cliente de
Supabase (cualquier camino futuro queda cubierto) y el evento se guarda en la misma transacción que el cambio.

### 3.2 Despacho

| Qué | Dónde | Observación |
|---|---|---|
| `validate_order_pallet` (versión vigente) | [supabase/migrations/20260901035906_persist_dispatch_discrepancies.sql:102-125](../supabase/migrations/20260901035906_persist_dispatch_discrepancies.sql#L102-L125) | Marca el pallet como validado por escaneo. **No reporta al ERP**: validar no es mover stock. El dato que deja (`order_pallets.validated_at`) es el que se usa al confirmar. |
| Discrepancia de despacho (`wrong_order`) | mismo archivo, [:62-86](../supabase/migrations/20260901035906_persist_dispatch_discrepancies.sql#L62-L86) | Informativo; opcional enviarlo como nota (`message_post`) en la transferencia. No mueve stock. |
| `confirm_dispatch_order` | [supabase/migrations/20260901120000_confirm_dispatch_order.sql:119-148](../supabase/migrations/20260901120000_confirm_dispatch_order.sql#L119-L148) | **Enganche del evento `dispatch.confirmed`.** Después del insert del evento `dispatch_confirmed` (línea 148) y antes del `return` (línea 150), encolar un evento con el detalle de cada pallet esperado y validado (QR, lote, SKU, cantidad, unidad). |
| Llamadas desde la app | [src/lib/orders/actions.ts:302](../src/lib/orders/actions.ts#L302), [src/lib/pallet-validation/actions.ts:54](../src/lib/pallet-validation/actions.ts#L54) | No cambian: la integración queda del lado de la base + Edge Function. |

`confirm_dispatch_order` es `security invoker` y corre como `warehouse_operator`. Para que ese rol no tenga
escritura directa sobre `erp_outbox`, el insert se hace con una función `enqueue_erp_event(...)`
`security definer` (mismo patrón que `order_belongs_to_auth_company`). Los triggers de §3.1 usan la misma función.

### 3.3 Lectura de productos, lotes, stock y alertas

| Qué | Dónde | Problema actual / cambio |
|---|---|---|
| `getCompanyProducts` | [src/lib/pallets/queries.ts:202](../src/lib/pallets/queries.ts#L202) | Con ERP conectado, alimenta el selector desde `erp_products`. |
| `getExpirationAlerts` | [src/lib/pallets/queries.ts:256-296](../src/lib/pallets/queries.ts#L256-L296) | **Duplica lógica del ERP**: calcula umbrales propios (≤30 crítico, ≤60 advertencia, ≤90 próximo) sobre `batches.expiration_date`. Con ERP conectado, lee `erp_expiration_alerts`. |
| Consumidores de alertas | [src/app/dashboard/alerts/page.tsx:21-22](../src/app/dashboard/alerts/page.tsx#L21-L22), [src/app/dashboard/page.tsx:72](../src/app/dashboard/page.tsx#L72) | Pasan a leer la vista nueva cuando hay ERP. |
| `getDistributorStockAlerts` | [src/lib/stock-alerts/queries.ts:34](../src/lib/stock-alerts/queries.ts#L34) | **No se toca**: es stock informado por las distribuidoras (que no están en el ERP de la empresa). Es dato propio de TrazFlow. |

**Tablas y vistas nuevas** (espejo de solo lectura; las escribe solo `erp-snapshot-sync`, se pisan en cada corrida):

```sql
-- Espejo de product.product (dato maestro del ERP)
create table erp_products (
  company_id        uuid not null references companies(id) on delete cascade,
  erp_product_id    bigint not null,
  sku               text not null,        -- product.product.default_code
  name              text not null,
  uom               text not null,        -- uom_id (nombre)
  tracking          text not null,        -- 'lot' esperado
  synced_at         timestamptz not null,
  primary key (company_id, erp_product_id),
  unique (company_id, sku)
);

-- Espejo de stock.lot (fechas calculadas por el ERP)
create table erp_lot_snapshots (
  company_id        uuid not null references companies(id) on delete cascade,
  erp_lot_id        bigint not null,
  product_sku       text not null,
  lot_name          text not null,        -- stock.lot.name == batches.batch_number
  expiration_date   timestamptz,
  use_date          timestamptz,
  removal_date      timestamptz,
  alert_date        timestamptz,
  is_expired        boolean not null,     -- stock.lot.product_expiry_alert
  qty_on_hand       numeric,              -- stock.lot.product_qty
  synced_at         timestamptz not null,
  primary key (company_id, erp_lot_id)
);

-- Espejo de stock.quant (stock por lote/paquete/ubicación interna)
create table erp_stock_snapshots (
  company_id        uuid not null references companies(id) on delete cascade,
  erp_quant_id      bigint not null,
  product_sku       text not null,
  lot_name          text,
  package_name      text,                 -- stock.package.name == pallets.qr_code; null = stock suelto
  location_name     text not null,
  quantity          numeric not null,
  reserved_quantity numeric not null,
  uom               text not null,
  synced_at         timestamptz not null,
  primary key (company_id, erp_quant_id)
);

-- Stock del lote que todavía no está en ningún pallet: lo que se puede empaquetar
create view erp_unpacked_stock as
select company_id, product_sku, lot_name, location_name, uom,
       sum(quantity - reserved_quantity) as available_quantity
from erp_stock_snapshots
where package_name is null
group by company_id, product_sku, lot_name, location_name, uom;

-- Alertas = lo que dice el ERP + dónde están físicamente los pallets (aporte de TrazFlow)
create view erp_expiration_alerts as
select l.company_id, l.product_sku, l.lot_name, l.expiration_date, l.alert_date,
       case when l.is_expired then 'expired' else 'alert' end as erp_status,
       p.id as pallet_id, p.qr_code, p.current_location, p.quantity, p.unit_of_measure
from erp_lot_snapshots l
join products pr on pr.company_id = l.company_id and pr.sku = l.product_sku
join batches  b  on b.product_id = pr.id and b.batch_number = l.lot_name
join pallets  p  on p.batch_id = b.id and p.status = 'in_warehouse'
where l.is_expired or l.alert_date <= now();
```

TrazFlow **no calcula** umbrales: solo compara `alert_date`/`is_expired` que el ERP ya resolvió con su
configuración por producto (`alert_time`, `expiration_time`). Con ERP conectado, `batches.expiration_date` se
completa desde el espejo y deja de cargarse a mano.

`erp_stock_snapshots` habilita además una vista de **conciliación** (pallet en TrazFlow vs. paquete en el ERP con
distinta cantidad o inexistente), que es exactamente la visibilidad física que el ERP no tiene.

### 3.4 Recepción en distribuidor

[supabase/migrations/20261001190000_fix_reception_pallet_id_ambiguity.sql:95-113](../supabase/migrations/20261001190000_fix_reception_pallet_id_ambiguity.sql#L95-L113)
(`receive_order_pallet`). **Sin enganche en esta etapa**: el stock ya salió del ERP al confirmar el despacho. Si en
el futuro se quiere reflejar devoluciones por pallets `damaged`/`wrong_order`, el punto es después de la línea 104
(evento `reception_discrepancy`) y en Odoo correspondería una transferencia de devolución.

---

## 4. Esquema de eventos y datos

### 4.1 Infraestructura común

```sql
-- Qué empresas tienen ERP conectado. Sin fila activa, TrazFlow funciona como hoy.
create table erp_connections (
  company_id    uuid primary key references companies(id) on delete cascade,
  provider      text not null check (provider in ('odoo')),
  base_url      text not null,
  database      text not null,
  enabled       boolean not null default true,
  config        jsonb not null default '{}'  -- ids de ubicaciones, tipos de operación y unidades en el ERP
  -- La API key NO va acá: es un secreto de la Edge Function.
);

create table erp_outbox (
  id            uuid primary key default gen_random_uuid(),  -- = idempotency key
  company_id    uuid not null references companies(id) on delete cascade,
  event_type    text not null check (event_type in
                  ('pallet.packed', 'pallet.adjusted', 'pallet.unpacked', 'dispatch.confirmed')),
  aggregate_id  uuid not null,                                -- pallet u orden: define el orden de envío
  payload       jsonb not null,                               -- evento canónico (§4.2)
  status        text not null default 'pending' check (status in ('pending','sent','failed','needs_attention')),
  attempts      integer not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

-- Correspondencia id local <-> id del ERP (lo que hace reanudable al adaptador)
create table erp_external_refs (
  company_id    uuid not null references companies(id) on delete cascade,
  entity_type   text not null,       -- 'product' | 'batch' | 'pallet' | 'distributor' | 'dispatch_order'
  local_id      uuid not null,       -- sin FK: el pallet puede haberse borrado (pallet.unpacked)
  erp_model     text not null,       -- p. ej. 'stock.package'
  erp_id        bigint not null,
  primary key (company_id, entity_type, local_id)
);
```

Las tablas `erp_*` no tienen acceso de escritura desde el cliente (RLS sin policies de escritura para
`authenticated`): solo la Edge Function con service role y la función `enqueue_erp_event`. Los espejos de §3.3
tienen policy de lectura por empresa.

`needs_attention` = error de datos que un reintento no arregla (por ejemplo, el ERP no tiene stock suelto suficiente
del lote). Se muestra a logística en lugar de reintentar para siempre, y bloquea los eventos siguientes del mismo
pallet hasta que se resuelva.

La Edge Function toma eventos con una función `claim_erp_outbox(limit)` que usa
`for update skip locked`, para que dos corridas superpuestas del cron no envíen el mismo evento.

### 4.2 TrazFlow → ERP (eventos canónicos y su traducción a Odoo)

Todas las llamadas a Odoo usan:

```
POST https://<odoo>/json/2/<modelo>/<método>
Authorization: bearer <ODOO_API_KEY>
Content-Type: application/json
X-Odoo-Database: <db>
```

Los many2one de Odoo se envían como id y vuelven en lecturas como `[id, "nombre"]`. Los ids de configuración
(ubicaciones, tipos de operación, unidades) salen de `erp_connections.config`.

En los ejemplos: `8` = WH/Stock, `5` = Partners/Customers, `2` = tipo de operación "WH: Transferencias internas",
`3` = "WH: Entregas", `17` = producto ACE-500, `52` = lote L-2026-0915, `31` = unidad "Caja".

#### a) `pallet.packed` (armado de pallet con stock existente)

Evento canónico (independiente del ERP):

```json
{
  "event_id": "41c2…",
  "event_type": "pallet.packed",
  "occurred_at": "2026-10-02T13:10:00Z",
  "company_id": "c1…",
  "pallet": { "local_id": "e9…", "qr_code": "PAL-3f1d…", "quantity": 48, "unit_of_measure": "cajas" },
  "lot": { "number": "L-2026-0915" },
  "product": { "sku": "ACE-500" }
}
```

En Odoo:

1. Resolver producto y lote por `default_code` y `name` (`search_read` sobre `product.product` y `stock.lot`).
   Si no existen → `needs_attention`.
2. Paquete: `search_read` de `stock.package` por `name` (idempotencia) y, si no existe,
   `POST /json/2/stock.package/create` → `{ "vals_list": [{ "name": "PAL-3f1d…" }] }`.
3. Transferencia interna de stock suelto al paquete: `POST /json/2/stock.picking/create`
   ```json
   { "vals_list": [{
       "picking_type_id": 2,
       "location_id": 8,
       "location_dest_id": 8,
       "origin": "TRZ-41c2…",
       "move_ids": [[0, 0, {
         "product_id": 17, "product_uom_qty": 48, "product_uom": 31,
         "location_id": 8, "location_dest_id": 8,
         "move_line_ids": [[0, 0, {
           "product_id": 17, "quantity": 48, "product_uom_id": 31,
           "lot_id": 52, "package_id": false, "result_package_id": 90,
           "location_id": 8, "location_dest_id": 8
         }]]
       }]]
   }] }
   ```
   `package_id: false` = se toma stock que no está en ningún paquete; `result_package_id` = el pallet.
4. Validar: `POST /json/2/stock.picking/button_validate` → `{ "ids": [301], "context": { "skip_backorder": true } }`.
   Respuesta `true` = hecho. Si devuelve un diccionario (acción de wizard) o un error de stock insuficiente, el
   evento queda en `needs_attention`.
5. Guardar `erp_external_refs(pallet, e9…, stock.package, 90)`.

Mapeo de unidades (`pallets.unit_of_measure` → `uom.uom`): `unidades` → *Units*, `kilogramos` → *kg*,
`cajas` → unidad creada en Odoo (p. ej. "Caja"); los ids están en `erp_connections.config`.

#### b) `pallet.adjusted` (edición de un pallet ya armado)

```json
{
  "event_id": "5b10…",
  "event_type": "pallet.adjusted",
  "occurred_at": "2026-10-02T13:25:00Z",
  "company_id": "c1…",
  "pallet": { "local_id": "e9…", "qr_code": "PAL-3f1d…" },
  "before": { "lot_number": "L-2026-0915", "product_sku": "ACE-500", "quantity": 48, "unit_of_measure": "cajas" },
  "after":  { "lot_number": "L-2026-0915", "product_sku": "ACE-500", "quantity": 45, "unit_of_measure": "cajas" }
}
```

En Odoo, siempre como **transferencia interna** en WH/Stock (mismo esquema que el armado), según el caso:

| Cambio | Línea de la transferencia |
|---|---|
| Aumenta la cantidad | `quantity` = diferencia, `package_id: false` → `result_package_id: <paquete>` (entra stock suelto al pallet) |
| Disminuye la cantidad | `quantity` = diferencia, `package_id: <paquete>` → `result_package_id: false` (sale del pallet al stock suelto) |
| Cambia el lote, el producto o la unidad | Dos líneas: vaciar el paquete con los valores de `before` y volver a llenarlo con los de `after` |

Es un **reacomodo**, no un ajuste de inventario: el total del lote en el ERP no cambia. Si la edición refleja una
diferencia real de conteo (mercadería perdida, rota), ese ajuste de inventario lo registra el ERP, no TrazFlow.

#### c) `pallet.unpacked` (baja de un pallet en depósito)

```json
{
  "event_id": "c7e3…",
  "event_type": "pallet.unpacked",
  "occurred_at": "2026-10-02T13:40:00Z",
  "company_id": "c1…",
  "pallet": { "local_id": "e9…", "qr_code": "PAL-3f1d…" }
}
```

En Odoo: transferencia interna con todo el contenido del paquete (`package_id: <paquete>` →
`result_package_id: false`). Si el pallet no tiene `erp_external_refs` (nunca se llegó a armar en el ERP), el evento
se marca `sent` sin llamar al ERP: no hay nada que deshacer.

#### d) `dispatch.confirmed` (consumo de lote / salida física)

Se arma en `confirm_dispatch_order` con los pallets que efectivamente se validaron por escaneo:

```json
{
  "event_id": "77ad…",
  "event_type": "dispatch.confirmed",
  "occurred_at": "2026-10-02T15:40:00Z",
  "company_id": "c1…",
  "order": { "local_id": "d3…", "confirmed_at": "2026-10-02T15:40:00Z" },
  "distributor": { "local_id": "a5…", "name": "Distribuidora Norte" },
  "pallets": [
    { "qr_code": "PAL-3f1d…", "product_sku": "ACE-500", "lot_number": "L-2026-0915",
      "quantity": 45, "unit_of_measure": "cajas", "validated_at": "2026-10-02T15:31:12Z" },
    { "qr_code": "PAL-90be…", "product_sku": "ACE-500", "lot_number": "L-2026-0921",
      "quantity": 20, "unit_of_measure": "cajas", "validated_at": "2026-10-02T15:33:02Z" }
  ]
}
```

En Odoo: un `stock.picking` de salida (`picking_type_id` = WH: Entregas, `location_id` = WH/Stock,
`location_dest_id` = Partners/Customers, `partner_id` = `res.partner` de la distribuidora vía
`erp_external_refs`, `origin` = `"TRZ-77ad…"`), con un `stock.move` por producto y un `stock.move.line` por pallet
indicando **`lot_id`** y **`package_id` = `result_package_id`** del pallet escaneado (sale el paquete completo);
luego `button_validate` con `skip_backorder`.

Esto es lo que TrazFlow aporta al ERP: **qué lote y qué pallet salieron físicamente**, no los que el ERP habría
sugerido por FIFO/FEFO. Si difieren, Odoo registra la salida real y la diferencia queda auditada.

### 4.3 ERP → TrazFlow (lecturas de `erp-snapshot-sync`)

#### a) Productos

`POST /json/2/product.product/search_read`

```json
{
  "domain": [["is_storable", "=", true], ["default_code", "!=", false]],
  "fields": ["default_code", "name", "uom_id", "tracking"]
}
```

Formato canónico en `erp_products`:

```json
{ "erp_product_id": 17, "sku": "ACE-500", "name": "Aceite 500ml", "uom": "Caja", "tracking": "lot" }
```

#### b) Lotes, vencimientos y alertas

`POST /json/2/stock.lot/search_read`

```json
{
  "domain": [["product_qty", ">", 0]],
  "fields": ["name", "product_id", "expiration_date", "use_date", "removal_date", "alert_date",
             "product_expiry_alert", "product_qty"]
}
```

Formato canónico en `erp_lot_snapshots`:

```json
{ "erp_lot_id": 52, "product_sku": "ACE-500", "lot_name": "L-2026-0915",
  "expiration_date": "2027-03-31T00:00:00Z", "use_date": "2027-03-01T00:00:00Z",
  "removal_date": "2027-03-17T00:00:00Z", "alert_date": "2027-03-10T00:00:00Z",
  "is_expired": false, "qty_on_hand": 120 }
```

Se traen todos los lotes con stock (no solo los que están en alerta) porque, además de las alertas, alimentan el
selector de lotes al armar pallets.

#### c) Stock actual

`POST /json/2/stock.quant/search_read`

```json
{
  "domain": [["location_id.usage", "=", "internal"], ["quantity", "!=", 0]],
  "fields": ["product_id", "lot_id", "package_id", "location_id", "quantity", "reserved_quantity", "product_uom_id"]
}
```

Respuesta (recortada): un quant suelto y uno ya empaquetado en un pallet.

```json
[
  { "id": 1203, "product_id": [17, "[ACE-500] Aceite 500ml"], "lot_id": [52, "L-2026-0915"],
    "package_id": false, "location_id": [8, "WH/Stock"],
    "quantity": 72.0, "reserved_quantity": 0.0, "product_uom_id": [31, "Caja"] },
  { "id": 1204, "product_id": [17, "[ACE-500] Aceite 500ml"], "lot_id": [52, "L-2026-0915"],
    "package_id": [90, "PAL-3f1d…"], "location_id": [8, "WH/Stock"],
    "quantity": 48.0, "reserved_quantity": 0.0, "product_uom_id": [31, "Caja"] }
]
```

Formato canónico en `erp_stock_snapshots` (el SKU sale de `erp_products` por `erp_product_id`; `display_name` no se
parsea):

```json
{ "erp_quant_id": 1204, "product_sku": "ACE-500", "lot_name": "L-2026-0915", "package_name": "PAL-3f1d…",
  "location_name": "WH/Stock", "quantity": 48, "reserved_quantity": 0, "uom": "Caja" }
```

### 4.4 Configuración mínima de Odoo para la demo

- Odoo 19 Community (imagen Docker oficial `odoo:19` + Postgres), app **Inventario**.
- Ajustes de Inventario: **Lotes y números de serie**, **Fechas de vencimiento**, **Paquetes** y
  **Ubicaciones de almacenamiento** (habilita el tipo de operación de transferencias internas).
- Productos: `is_storable = true`, `tracking = "lot"`, `use_expiration_date = true`, con `alert_time` configurado.
- Stock inicial cargado **en Odoo** (recepción o ajuste de inventario con lote), porque con la decisión 1 TrazFlow
  no da de alta stock.
- Una distribuidora = un `res.partner` (cargado en `erp_external_refs`).
- Usuario técnico con API key (Preferencias → Seguridad de la cuenta → Nueva clave de API).

---

## 5. Patrón genérico: lo que cambia con otro ERP es el adaptador

Todo lo anterior se organiza en capas; solo la última conoce a Odoo:

```
TrazFlow (RPCs, triggers)                     Supabase
   │  encola eventos canónicos
   ▼
erp_outbox ──► pg_cron ──► Edge Function erp-sync ──► ErpAdapter (interfaz) ──► OdooAdapter (JSON-2)
                                   │                                       └─► SoftplanAdapter / otro
erp_products / erp_*_snapshots ◄───┘  (fetch*)
```

Contrato que implementa cada adaptador:

```ts
interface ErpAdapter {
  packPallet(event: PalletPacked): Promise<ErpResult>;
  adjustPallet(event: PalletAdjusted): Promise<ErpResult>;
  unpackPallet(event: PalletUnpacked): Promise<ErpResult>;
  registerDispatch(event: DispatchConfirmed): Promise<ErpResult>;
  fetchProducts(): Promise<ProductSnapshot[]>;
  fetchLots(): Promise<LotSnapshot[]>;
  fetchStock(): Promise<StockSnapshot[]>;
}

type ErpResult =
  | { status: "sent"; refs: { entityType: string; localId: string; erpModel: string; erpId: string }[] }
  | { status: "retry"; error: string }            // ERP caído, timeout, 5xx
  | { status: "needs_attention"; error: string }; // dato inválido para el ERP
```

**Qué es estable (arquitectura)**

- Los eventos canónicos de §4.2 y los espejos de §4.3: describen hechos de TrazFlow con identificadores de negocio
  (SKU, número de lote, QR), no ids de ningún ERP.
- Los puntos de enganche de §3, el outbox, el orden por pallet, la idempotencia por `event_id` y la tabla de
  referencias externas.
- La división de responsabilidades del §0: el ERP da de alta el stock, calcula vencimientos y decide FIFO;
  TrazFlow arma pallets, valida y reporta lo que pasó físicamente.

**Qué cambia por ERP (adaptador)**

| Aspecto | Odoo 19 (demo) | Softplan u otro ERP (patrón) |
|---|---|---|
| Transporte y auth | JSON-2 + API key bearer | El que exponga (REST/SOAP, OAuth, archivos), según el acceso que dé el cliente |
| Productos y lotes | `product.product`, `stock.lot` | Su maestro de artículos y su entidad de lote/partida |
| Pallet | `stock.package` + transferencia interna | Unidad de manipulación / bulto / contenedor; si no existe, los eventos de armado son no-op y el QR viaja como referencia en el despacho |
| Salida | `stock.picking` de entrega + `button_validate` | Remito / documento de salida |
| Vencimientos | `stock.lot.alert_date`, `product_expiry_alert` | Su consulta de vencimientos o reporte equivalente |
| Idempotencia | `origin` = `TRZ-<event_id>` | Campo de referencia externa que acepte, o tabla de correspondencias propia |

Incluso entre versiones de Odoo cambia el adaptador y no el resto: Odoo ≤ 18 usa `stock.quant.package` en lugar de
`stock.package` y el transporte sería `execute_kw` por `/jsonrpc`.

Este documento **no** define una integración con Softplan: no hay acceso a su API ni está en el alcance. Lo que
se valida es que el contrato canónico alcanza para escribir ese adaptador sin rediseñar TrazFlow.

---

## 6. Decisiones tomadas

| # | Decisión | Impacto en el diseño |
|---|---|---|
| 1 | **El ERP da de alta el stock; TrazFlow lo lee y lo empaqueta en pallets.** | Desaparecen los eventos de alta de lote y de recepción. Aparecen la lectura de productos y lotes (§4.3) y el armado como transferencia interna (`pallet.packed`). Sube el alcance de US-C2. |
| 2 | **Editar o borrar un pallet ya sincronizado emite un evento al ERP.** | Eventos `pallet.adjusted` y `pallet.unpacked` (§4.2 b y c), triggers sobre `UPDATE`/`DELETE` de `pallets` y orden de envío por pallet. Se resuelven como reacomodo entre paquete y stock suelto. |
| 3 | **El selector de `product.product` aparece solo si la empresa tiene ERP conectado; si no, sigue el alta manual.** | Tabla `erp_connections`. Todos los enganches y la UI preguntan primero si hay conexión activa. Las empresas sin ERP no ven cambios. |
| 4 | **Supabase Edge Function disparada por `pg_cron`** (no Vercel Cron, que en el plan gratuito corre como máximo una vez por día). | Edge Function `erp-sync` con el adaptador, dos jobs (`erp-outbox-drain` cada minuto y `erp-snapshot-sync` cada 15 minutos), API key como secreto de la función. |

## 7. Qué desbloquea (propuesta de corte)

> Sugerencia para alinear con el backlog; ajustar a la definición real de cada historia.

- **US-C2 — Base, lectura y armado de pallets** (la más grande, por la decisión 1): `erp_connections`,
  `erp_outbox`, `erp_external_refs`, `enqueue_erp_event`, Edge Function con `pg_cron`, espejos de productos, lotes y
  stock, selector de producto y lote al crear pallets, y eventos `pallet.packed` / `pallet.adjusted` /
  `pallet.unpacked`. Si queda grande, se puede partir en "lectura + selector" y "eventos de pallet".
- **US-C3 — Despacho:** enganche en `confirm_dispatch_order` y `registerDispatch`.
- **US-C4 — Alertas de vencimiento:** vista `erp_expiration_alerts` y reemplazo de `getExpirationAlerts` cuando hay
  ERP conectado.

## Referencias

- Odoo 19 — External JSON-2 API: https://www.odoo.com/documentation/19.0/developer/reference/external_api.html
- Odoo 19 — Fechas de vencimiento: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/expiration_dates.html
- Odoo 19 — Estrategia FEFO: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html
- Código fuente Odoo 19 (`addons/stock/models/`, `addons/product_expiry/models/`): https://github.com/odoo/odoo/tree/19.0/addons/stock/models
- Supabase — Programar Edge Functions con `pg_cron`: https://supabase.com/docs/guides/functions/schedule-functions
