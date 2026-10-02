# US-C1 — Contrato de integración TrazFlow ↔ ERP

> Estado: **propuesta de diseño** (no hay código implementado). Desbloquea US-C2, US-C3 y US-C4.
> ERP de referencia para la demo: **Odoo 19** (Community, instalable localmente).

## 0. Principio rector

TrazFlow **no duplica** lo que un ERP ya resuelve: alta y gestión de stock, valorización, lógica FIFO/FEFO y
cálculo de vencimientos/alertas. Esto lo confirmó la entrevista con el cliente que usa Softplan.

TrazFlow aporta lo que el ERP **no ve**: la realidad física.

| Dueño | Responsabilidad |
|---|---|
| **ERP** | Maestro de productos, stock contable por lote, fechas de vencimiento/alerta, reglas FIFO/FEFO, documentos de entrada/salida. |
| **TrazFlow** | Identidad física del pallet (QR), ubicación real, validación de carga por escaneo, discrepancias de despacho/recepción, trazabilidad de movimientos. |

Regla práctica: si un dato se **calcula** a partir de reglas de negocio de inventario, se lee del ERP. Si un dato se
**observa** en el depósito o en la ruta, nace en TrazFlow y se reporta al ERP.

---

## 1. Resumen: qué entra y qué sale

| # | Dirección | Evento / dato | Disparador en TrazFlow | Destino en Odoo | Frecuencia |
|---|---|---|---|---|---|
| 1 | TrazFlow → ERP | **Alta de lote** (`lot.registered`) | Insert en `batches` | `stock.lot` (busca/crea por producto + nombre) | Por evento |
| 2 | TrazFlow → ERP | **Alta de stock físico / pallet** (`pallet.registered`) | Insert en `pallets` | `stock.picking` de recepción + `stock.move.line` con `lot_id` y `result_package_id` (`stock.package` = QR) | Por evento |
| 3 | TrazFlow → ERP | **Consumo de lote / salida física** (`dispatch.confirmed`) | RPC `confirm_dispatch_order` | `stock.picking` de entrega (salida) con una línea por pallet validado | Por evento |
| 4 | ERP → TrazFlow | **Stock actual** por producto/lote/paquete/ubicación | Job de sincronización | `stock.quant` (lectura) | Programada (p. ej. cada 15 min) + manual |
| 5 | ERP → TrazFlow | **Vencimientos y alertas** por lote | Job de sincronización | `stock.lot` (`expiration_date`, `alert_date`, `removal_date`, `product_expiry_alert`) | Programada + manual |
| 6 | ERP → TrazFlow | **Maestro de productos** (SKU) | Job de sincronización / lookup | `product.product` (`default_code`) | Programada |
| — | Fuera de alcance | Recepción en distribuidor (`receive_order_pallet`) | — | La mercadería ya salió del stock de la empresa; queda solo en TrazFlow (ver §3.4) | — |

---

## 2. Mecanismo elegido para la demo

### 2.1 Decisión

**API externa de Odoo 19, protocolo JSON-2** (`POST /json/2/<modelo>/<método>`, autenticación con API key como
`Authorization: bearer <key>`), invocada **desde el servidor** de TrazFlow (nunca desde el navegador), a través de
un **adaptador** que implementa un contrato canónico propio de TrazFlow (ver §5).

Desacople con **patrón outbox**: las acciones de TrazFlow escriben un evento en una tabla `erp_outbox` dentro de la
misma transacción de Postgres; un worker lo envía al ERP después.

### 2.2 Por qué JSON-2 y no XML-RPC / JSON-RPC

El backlog mencionaba XML-RPC/JSON-RPC. Al revisar la documentación oficial de Odoo 19 aparece que:

- Odoo 19 introduce la **API JSON-2**: HTTP + JSON + bearer token, una URL por modelo y método. Es lo más
  parecido a REST que ofrece Odoo y se consume con `fetch` sin librerías extra.
- Los endpoints `/xmlrpc`, `/xmlrpc/2` y `/jsonrpc` están **deprecados** y su remoción está anunciada para
  **Odoo 22 (otoño 2028)**. Construir una integración nueva sobre ellos es deuda técnica desde el día uno.
- El modelo de datos y los métodos son **los mismos** (`search_read`, `create`, `write`, `button_validate`…): lo
  único que cambia es el transporte. Por eso, si el equipo tuviera que usar Odoo 17/18, el adaptador puede
  caer a `execute_kw` vía `/jsonrpc` sin tocar el resto del diseño.

### 2.3 Por qué API (pull/push síncrono por evento) y no otras opciones

| Alternativa | Descartada porque |
|---|---|
| Acceso directo a la base de Postgres de Odoo | Saltea reglas de negocio y permisos del ERP; acopla al schema interno. Contradice el principio rector. |
| Importación/exportación de archivos (CSV) | Sirve como último recurso con ERPs cerrados, pero no da feedback por evento ni idempotencia. |
| Webhooks de Odoo (acción "Send Webhook Notification" de las reglas de automatización) | Útiles para que el ERP *avise* cambios; quedan como mejora futura para la lectura (§3.3). Para la demo alcanza con polling. |
| Llamar a Odoo desde dentro de las funciones PL/pgSQL | Una llamada HTTP dentro de la transacción del RPC la alarga, la hace fallar si el ERP está caído y no se puede deshacer en el ERP si luego la transacción hace rollback. |

### 2.4 Consecuencias que el diseño tiene que absorber

- **Cada llamada JSON-2 es su propia transacción en Odoo.** Un flujo de varios pasos (crear picking → validar) no
  es atómico. El adaptador tiene que ser **idempotente y reanudable**: antes de crear, busca por la referencia
  externa (`origin = "TRZ-<event_id>"`).
- **El ERP puede estar caído.** La operación física en TrazFlow **nunca se bloquea** por el ERP: el despacho se
  confirma igual y el evento queda pendiente en el outbox con reintentos.
- **Credenciales**: la API key de Odoo vive en variables de entorno del servidor (no `NEXT_PUBLIC_*`), asociada a un
  usuario técnico de Odoo con permisos de Inventario/Usuario.

---

## 3. Puntos de enganche en el código actual

> Las migraciones existentes no se editan: cada enganche en SQL se hace con una **migración nueva** que redefine la
> función (`create or replace`) o agrega un trigger.

### 3.1 Alta de lote y de pallet (hoy: inserts directos desde Server Actions)

| Qué | Dónde | Observación |
|---|---|---|
| Upsert de producto por SKU | [src/lib/pallets/actions.ts:47-51](../src/lib/pallets/actions.ts#L47-L51) y [:99-103](../src/lib/pallets/actions.ts#L99-L103) | Hoy TrazFlow **crea** productos. Con ERP, el SKU debe existir en `product.product`; TrazFlow no da de alta productos en el ERP (dato maestro del ERP). |
| Insert de lote (`createLot`) | [src/lib/pallets/actions.ts:56-61](../src/lib/pallets/actions.ts#L56-L61) | Enganche del evento `lot.registered`. Guarda `expiration_date`, que pasa a ser dato del ERP (ver §3.3). |
| Insert de pallet (`createPallet`) | [src/lib/pallets/actions.ts:114-120](../src/lib/pallets/actions.ts#L114-L120) | Enganche del evento `pallet.registered` (QR + cantidad + unidad + lote). |
| Edición de pallet (`updatePallet`) | [src/lib/pallets/actions.ts:180-184](../src/lib/pallets/actions.ts#L180-L184) | Cambio de cantidad/lote de un pallet en depósito → evento de ajuste (pendiente, §6). |
| Baja de pallet (`deletePallet`) | [src/lib/pallets/actions.ts:213-218](../src/lib/pallets/actions.ts#L213-L218) | Solo pallets `in_warehouse` → evento de anulación (pendiente, §6). |
| Tablas | [supabase/migrations/0001_init_schema.sql:115-139](../supabase/migrations/0001_init_schema.sql#L115-L139) | `batches` y `pallets`. Cantidad del pallet en [20260918000100_add_pallet_quantity.sql](../supabase/migrations/20260918000100_add_pallet_quantity.sql). |

**Propuesta de enganche:** triggers `AFTER INSERT` en `batches` y `pallets` que escriben en `erp_outbox`. Se
prefiere trigger antes que código en la Server Action porque los inserts son directos con el cliente de Supabase
(cualquier camino futuro de alta queda cubierto) y el evento se guarda en la misma transacción que el insert.

### 3.2 Despacho

| Qué | Dónde | Observación |
|---|---|---|
| `validate_order_pallet` (versión vigente) | [supabase/migrations/20260901035906_persist_dispatch_discrepancies.sql:102-125](../supabase/migrations/20260901035906_persist_dispatch_discrepancies.sql#L102-L125) | Marca el pallet como validado por escaneo. **No reporta al ERP**: validar no es mover stock. El dato que deja (`order_pallets.validated_at`) es el que se usa al confirmar. |
| Discrepancia de despacho (`wrong_order`) | mismo archivo, [:62-86](../supabase/migrations/20260901035906_persist_dispatch_discrepancies.sql#L62-L86) | Informativo; opcional enviarlo como nota (`message_post`) en el picking. No mueve stock. |
| `confirm_dispatch_order` | [supabase/migrations/20260901120000_confirm_dispatch_order.sql:119-148](../supabase/migrations/20260901120000_confirm_dispatch_order.sql#L119-L148) | **Enganche del evento `dispatch.confirmed`.** Después del insert del evento `dispatch_confirmed` (línea 148) y antes del `return` (línea 150), insertar en `erp_outbox` un evento con el detalle de cada pallet esperado y validado (QR, lote, SKU, cantidad, unidad). |
| Llamadas desde la app | [src/lib/orders/actions.ts:302](../src/lib/orders/actions.ts#L302), [src/lib/pallet-validation/actions.ts:54](../src/lib/pallet-validation/actions.ts#L54) | No cambian: la integración queda del lado de la base + worker. |

Nota: `confirm_dispatch_order` es `security invoker` y corre como `warehouse_operator`. Para que ese rol no
tenga escritura directa sobre `erp_outbox`, el insert se hace con una función `enqueue_erp_event(...)`
`security definer` (mismo patrón que `order_belongs_to_auth_company`).

### 3.3 Lectura de stock y alertas de vencimiento

| Qué | Dónde | Problema actual |
|---|---|---|
| `getExpirationAlerts` | [src/lib/pallets/queries.ts:256-296](../src/lib/pallets/queries.ts#L256-L296) | **Duplica lógica del ERP**: calcula umbrales propios (≤30 crítico, ≤60 advertencia, ≤90 próximo) sobre `batches.expiration_date`. |
| Consumidores | [src/app/dashboard/alerts/page.tsx:21-22](../src/app/dashboard/alerts/page.tsx#L21-L22), [src/app/dashboard/page.tsx:72](../src/app/dashboard/page.tsx#L72) | Pasarían a leer la vista nueva. |
| `getDistributorStockAlerts` | [src/lib/stock-alerts/queries.ts:34](../src/lib/stock-alerts/queries.ts#L34) | **No se toca**: es stock informado por las distribuidoras (que no están en el ERP de la empresa). Es dato propio de TrazFlow. |

**Tablas/vista nuevas propuestas** (espejo de solo lectura, se pisan en cada sincronización, nadie las edita a mano):

```sql
-- Snapshot de stock.lot (fechas calculadas por el ERP)
create table erp_lot_snapshots (
  company_id        uuid not null references companies(id) on delete cascade,
  erp_lot_id        bigint not null,
  product_sku       text not null,        -- product.product.default_code
  lot_name          text not null,        -- stock.lot.name  == batches.batch_number
  expiration_date   timestamptz,
  use_date          timestamptz,
  removal_date      timestamptz,
  alert_date        timestamptz,
  is_expired        boolean not null,     -- stock.lot.product_expiry_alert
  qty_on_hand       numeric,              -- stock.lot.product_qty
  synced_at         timestamptz not null,
  primary key (company_id, erp_lot_id)
);

-- Snapshot de stock.quant (stock contable por lote/paquete/ubicación interna)
create table erp_stock_snapshots (
  company_id        uuid not null references companies(id) on delete cascade,
  erp_quant_id      bigint not null,
  product_sku       text not null,
  lot_name          text,
  package_name      text,                 -- stock.package.name == pallets.qr_code
  location_name     text not null,
  quantity          numeric not null,
  reserved_quantity numeric not null,
  uom               text not null,
  synced_at         timestamptz not null,
  primary key (company_id, erp_quant_id)
);

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
configuración por producto (`alert_time`, `expiration_time`). `batches.expiration_date` queda como dato
informativo de carga (o se completa desde el snapshot); la fuente de verdad pasa a ser el ERP.

`erp_stock_snapshots` habilita además una vista de **conciliación** (pallet en TrazFlow vs. paquete en el ERP con
distinta cantidad o inexistente), que es exactamente la visibilidad física que el ERP no tiene.

### 3.4 Recepción en distribuidor

[supabase/migrations/20261001190000_fix_reception_pallet_id_ambiguity.sql:95-113](../supabase/migrations/20261001190000_fix_reception_pallet_id_ambiguity.sql#L95-L113)
(`receive_order_pallet`). **Sin enganche en esta etapa**: el stock ya salió del ERP al confirmar el despacho. Si en
el futuro se quiere reflejar devoluciones por pallets `damaged`/`wrong_order`, el punto es después de la línea 104
(evento `reception_discrepancy`) y en Odoo correspondería un picking de devolución.

---

## 4. Esquema de eventos y datos

### 4.1 Infraestructura común

```sql
create table erp_outbox (
  id            uuid primary key default gen_random_uuid(),  -- = idempotency key
  company_id    uuid not null references companies(id) on delete cascade,
  event_type    text not null check (event_type in ('lot.registered','pallet.registered','dispatch.confirmed')),
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
  local_id      uuid not null,
  erp_model     text not null,       -- p. ej. 'stock.lot'
  erp_id        bigint not null,
  primary key (company_id, entity_type, local_id)
);
```

Sin acceso desde el cliente (RLS sin policies para `authenticated`); solo el worker con service role y la función
`enqueue_erp_event`. `needs_attention` = error de datos que un reintento no arregla (p. ej. SKU inexistente en el
ERP); se muestra a logística en lugar de reintentar para siempre.

### 4.2 TrazFlow → ERP (eventos canónicos y su traducción a Odoo)

Todas las llamadas a Odoo usan:

```
POST https://<odoo>/json/2/<modelo>/<método>
Authorization: bearer <ODOO_API_KEY>
Content-Type: application/json
X-Odoo-Database: <db>
```

Los many2one de Odoo se envían como id y vuelven en lecturas como `[id, "nombre"]`. Los ids de configuración
(ubicaciones, tipos de operación, unidades) los resuelve el adaptador una vez y los cachea.

#### a) `lot.registered`

Evento canónico (independiente del ERP):

```json
{
  "event_id": "8a0f…",
  "event_type": "lot.registered",
  "occurred_at": "2026-10-02T13:05:00Z",
  "company_id": "c1…",
  "lot": { "local_id": "b7…", "number": "L-2026-0915", "expiration_date": "2027-03-31" },
  "product": { "sku": "ACE-500" }
}
```

En Odoo:

1. Resolver producto: `POST /json/2/product.product/search_read`
   ```json
   { "domain": [["default_code", "=", "ACE-500"]], "fields": ["id", "tracking", "is_storable"], "limit": 1 }
   ```
   Si no existe o `tracking != "lot"` → `needs_attention`.
2. Idempotencia: `POST /json/2/stock.lot/search_read`
   ```json
   { "domain": [["product_id", "=", 17], ["name", "=", "L-2026-0915"]], "fields": ["id"], "limit": 1 }
   ```
3. Si no existe: `POST /json/2/stock.lot/create`
   ```json
   { "vals_list": [{ "name": "L-2026-0915", "product_id": 17, "expiration_date": "2027-03-31 00:00:00",
                     "ref": "TRZ-b7…" }] }
   ```
   Odoo recalcula `alert_date`, `removal_date` y `use_date` a partir de la configuración del producto.
4. Guardar `erp_external_refs(batch, b7…, stock.lot, <id>)`.

#### b) `pallet.registered` (alta de stock físico)

```json
{
  "event_id": "41c2…",
  "event_type": "pallet.registered",
  "occurred_at": "2026-10-02T13:10:00Z",
  "company_id": "c1…",
  "pallet": { "local_id": "e9…", "qr_code": "PAL-3f1d…", "quantity": 48, "unit_of_measure": "cajas",
              "location": "Depósito" },
  "lot": { "number": "L-2026-0915" },
  "product": { "sku": "ACE-500" }
}
```

En Odoo (recepción con el pallet como paquete, deja historial de movimientos en el ERP):

1. Paquete: `POST /json/2/stock.package/create` → `{ "vals_list": [{ "name": "PAL-3f1d…" }] }`
   (previo `search_read` por `name` para idempotencia).
2. Picking de entrada: `POST /json/2/stock.picking/create`
   ```json
   { "vals_list": [{
       "picking_type_id": 1,
       "location_id": 4,
       "location_dest_id": 8,
       "origin": "TRZ-41c2…",
       "move_ids": [[0, 0, {
         "product_id": 17, "product_uom_qty": 48, "product_uom": 31,
         "location_id": 4, "location_dest_id": 8,
         "move_line_ids": [[0, 0, {
           "product_id": 17, "quantity": 48, "product_uom_id": 31,
           "lot_id": 52, "result_package_id": 90,
           "location_id": 4, "location_dest_id": 8
         }]]
       }]]
   }] }
   ```
   (`picking_type_id` = WH: Recepciones, `location_id` = Partners/Vendors, `location_dest_id` = WH/Stock,
   `product_uom` = unidad mapeada de `cajas`.)
3. Validar: `POST /json/2/stock.picking/button_validate` → `{ "ids": [301], "context": { "skip_backorder": true } }`.
   Respuesta `true` = hecho. Si devuelve un diccionario (acción de wizard) se marca `needs_attention`.

Alternativa más simple si el picking resultara frágil en la demo: ajuste de inventario sobre `stock.quant`
(`create` con `context: {"inventory_mode": true}` y campos `product_id`, `location_id`, `lot_id`, `package_id`,
`inventory_quantity`, luego `action_apply_inventory`). Pierde el documento de origen, por eso no es la opción
principal.

Mapeo de unidades (`pallets.unit_of_measure` → `uom.uom`): `unidades` → *Units*, `kilogramos` → *kg*,
`cajas` → unidad creada en Odoo (p. ej. "Caja"); los ids se configuran en el adaptador.

#### c) `dispatch.confirmed` (consumo de lote / salida física)

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
      "quantity": 48, "unit_of_measure": "cajas", "validated_at": "2026-10-02T15:31:12Z" },
    { "qr_code": "PAL-90be…", "product_sku": "ACE-500", "lot_number": "L-2026-0921",
      "quantity": 20, "unit_of_measure": "cajas", "validated_at": "2026-10-02T15:33:02Z" }
  ]
}
```

En Odoo: un `stock.picking` de salida (`picking_type_id` = WH: Entregas, `location_id` = WH/Stock,
`location_dest_id` = Partners/Customers, `partner_id` = `res.partner` de la distribuidora vía
`erp_external_refs`, `origin` = `"TRZ-77ad…"`), con un `stock.move` por producto y un `stock.move.line` por pallet
indicando **`lot_id` y `package_id`** del pallet escaneado; luego `button_validate` con `skip_backorder`.

Esto es lo que TrazFlow aporta al ERP: **qué lote salió físicamente**, no el que el ERP habría sugerido por
FIFO/FEFO. Si difieren, Odoo registra la salida real y la diferencia queda auditada.

### 4.3 ERP → TrazFlow (lecturas)

#### a) Stock actual

`POST /json/2/stock.quant/search_read`

```json
{
  "domain": [["location_id.usage", "=", "internal"], ["quantity", "!=", 0]],
  "fields": ["product_id", "lot_id", "package_id", "location_id", "quantity", "reserved_quantity", "product_uom_id"]
}
```

Respuesta (recortada):

```json
[{ "id": 1204, "product_id": [17, "[ACE-500] Aceite 500ml"], "lot_id": [52, "L-2026-0915"],
   "package_id": [90, "PAL-3f1d…"], "location_id": [8, "WH/Stock"],
   "quantity": 48.0, "reserved_quantity": 0.0, "product_uom_id": [31, "Caja"] }]
```

Formato canónico que guarda TrazFlow en `erp_stock_snapshots`:

```json
{ "erp_quant_id": 1204, "product_sku": "ACE-500", "lot_name": "L-2026-0915", "package_name": "PAL-3f1d…",
  "location_name": "WH/Stock", "quantity": 48, "reserved_quantity": 0, "uom": "Caja" }
```

(El SKU sale de un `search_read` previo de `product.product` con `default_code`; `display_name` no se parsea.)

#### b) Vencimientos y alertas

`POST /json/2/stock.lot/search_read`

```json
{
  "domain": [["product_qty", ">", 0], ["alert_date", "!=", false]],
  "fields": ["name", "product_id", "expiration_date", "use_date", "removal_date", "alert_date",
             "product_expiry_alert", "product_qty"]
}
```

Formato canónico en `erp_lot_snapshots`:

```json
{ "erp_lot_id": 52, "product_sku": "ACE-500", "lot_name": "L-2026-0915",
  "expiration_date": "2027-03-31T00:00:00Z", "use_date": "2027-03-01T00:00:00Z",
  "removal_date": "2027-03-17T00:00:00Z", "alert_date": "2027-03-10T00:00:00Z",
  "is_expired": false, "qty_on_hand": 48 }
```

### 4.4 Configuración mínima de Odoo para la demo

- Odoo 19 Community (imagen Docker oficial `odoo:19` + Postgres), app **Inventario**.
- Ajustes de Inventario: **Lotes y números de serie**, **Fechas de vencimiento**, **Paquetes**.
- Productos: `is_storable = true`, `tracking = "lot"`, `use_expiration_date = true`, con `alert_time` configurado.
- Una distribuidora = un `res.partner` (cargado en `erp_external_refs`).
- Usuario técnico con API key (Preferencias → Seguridad de la cuenta → Nueva clave de API).

---

## 5. Patrón genérico: lo que cambia con otro ERP es el adaptador

Todo lo anterior se organiza en tres capas; solo la última conoce a Odoo:

```
TrazFlow (RPCs, Server Actions)
   │  escribe eventos canónicos
   ▼
erp_outbox  ──►  worker  ──►  ErpAdapter (interfaz)  ──►  OdooAdapter (JSON-2)
                                                    └─►  SoftplanAdapter / otro
erp_*_snapshots ◄── worker de sync ◄── ErpAdapter.fetch*
```

Contrato que implementa cada adaptador:

```ts
interface ErpAdapter {
  registerLot(event: LotRegistered): Promise<ErpResult>;
  registerPalletStock(event: PalletRegistered): Promise<ErpResult>;
  registerDispatch(event: DispatchConfirmed): Promise<ErpResult>;
  fetchStock(companyId: string): Promise<StockSnapshot[]>;
  fetchLotExpirations(companyId: string): Promise<LotSnapshot[]>;
}

type ErpResult =
  | { status: "sent"; refs: { entityType: string; localId: string; erpModel: string; erpId: string }[] }
  | { status: "retry"; error: string }            // ERP caído, timeout, 5xx
  | { status: "needs_attention"; error: string }; // dato inválido para el ERP
```

**Qué es estable (arquitectura)**

- Los eventos canónicos de §4.2 y los snapshots de §4.3: describen hechos de TrazFlow con identificadores de
  negocio (SKU, número de lote, QR), no ids de ningún ERP.
- Los puntos de enganche de §3, el outbox, la idempotencia por `event_id` y la tabla de referencias externas.
- La división de responsabilidades del §0: TrazFlow nunca calcula vencimientos ni decide FIFO.

**Qué cambia por ERP (adaptador)**

| Aspecto | Odoo 19 (demo) | Softplan u otro ERP (patrón) |
|---|---|---|
| Transporte y auth | JSON-2 + API key bearer | El que exponga (REST/SOAP, OAuth, archivos), según acceso que dé el cliente |
| Lote | `stock.lot` | Su entidad de lote/partida |
| Pallet | `stock.package` | Unidad de manipulación / bulto / contenedor; si no existe, se informa solo a nivel lote y el QR viaja como referencia |
| Entrada / salida | `stock.picking` + `button_validate` | Documento de entrada / remito de salida |
| Vencimientos | `stock.lot.alert_date`, `product_expiry_alert` | Su consulta de vencimientos o reporte equivalente |
| Idempotencia | `origin` / `ref` = `TRZ-<event_id>` | Campo de referencia externa que acepte, o tabla de correspondencias propia |

Incluso entre versiones de Odoo cambia el adaptador y no el resto: Odoo ≤ 18 usa `stock.quant.package` en lugar de
`stock.package` y el transporte sería `execute_kw` por `/jsonrpc`.

Este documento **no** define una integración con Softplan: no hay acceso a su API ni está en el alcance. Lo que
se valida es que el contrato canónico alcanza para escribir ese adaptador sin rediseñar TrazFlow.

---

## 6. Decisiones abiertas

1. **Origen del stock.** En la demo, el alta del pallet en TrazFlow genera la entrada en el ERP. En un cliente
   real, la entrada suele registrarla el ERP (compra/producción); ahí `pallet.registered` debería solo
   **empaquetar** stock ya existente (transferencia interna a un `stock.package`) en lugar de crear una
   recepción. Se propone un flag por empresa (`erp_stock_origin = 'trazflow' | 'erp'`).
2. **Edición y baja de pallets en depósito** (`updatePallet`, `deletePallet`): ¿se emiten eventos de ajuste o
   se bloquean una vez sincronizado el pallet?
3. **Productos**: con ERP conectado, ¿se elimina el upsert de productos en las Server Actions y se usa un
   selector alimentado desde `product.product`?
4. **Ejecución del worker**: Route Handler de Next.js invocado por cron (Vercel Cron / `pg_cron` + `pg_net`) o
   Supabase Edge Function. Se decide en la US de implementación.

## 7. Qué desbloquea (propuesta de corte)

> Sugerencia para alinear con el backlog; ajustar a la definición real de cada historia.

- **Base común**: migración con `erp_outbox`, `erp_external_refs`, `enqueue_erp_event` y el `OdooAdapter`
  con `registerLot` / `registerPalletStock`.
- **Despacho**: enganche en `confirm_dispatch_order` + `registerDispatch`.
- **Lectura**: snapshots, vista `erp_expiration_alerts` y reemplazo de `getExpirationAlerts`.

## Referencias

- Odoo 19 — External JSON-2 API: https://www.odoo.com/documentation/19.0/developer/reference/external_api.html
- Odoo 19 — Fechas de vencimiento: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/expiration_dates.html
- Odoo 19 — Estrategia FEFO: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html
- Código fuente Odoo 19 (`addons/stock/models/`, `addons/product_expiry/models/`): https://github.com/odoo/odoo/tree/19.0/addons/stock/models
