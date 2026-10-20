# Contrato ERP — TrazFlow ↔ ERP (US-ERP-02 / TRZ-92)

> Versión del contrato: **1** (`ERP_CONTRACT_VERSION` en `src/lib/erp/types.ts`).
> Implementación: `src/lib/erp/`. Proveedores: `mock` (por defecto) y `erpnext` (ERPNext/Frappe v15).
>
> Reemplaza a la propuesta anterior de US-C1 (Odoo + Edge Function), que se eliminó; queda en el historial de git.

## 1. Principios

- **El ERP es la fuente de verdad** de productos, lotes/partidas, stock, ventas, vencimientos y FIFO. TrazFlow no
  da de alta productos, lotes ni stock, no calcula FIFO y no modifica stock: registra la operación física (pallets,
  ubicación, validación de carga, despacho y entrega) y la informa.
- **Identificadores externos estables.** Todo se cruza por `externalId` (id del ERP), nunca por nombre visible.
- **Una sola puerta.** El resto de la app usa la interfaz `ErpClient` que devuelve `getErpClient(companyId)`. No
  conoce URLs, doctypes ni detalles del mock.
- **Solo servidor.** Las credenciales viven en variables de entorno del servidor; los módulos con entorno o red
  importan `server-only`, así que importarlos desde un componente cliente rompe el build.
- **Adapter intercambiable.** Cuando Softplan confirme API, archivos o webhooks, se agrega `softplan-client.ts` que
  implemente `ErpClient` y una opción más en `ERP_PROVIDER`. Pantallas y lógica de negocio no cambian.

## 2. Configuración

| Variable | Obligatoria | Valores | Descripción |
|---|---|---|---|
| `ERP_PROVIDER` | No | `mock` (defecto) \| `erpnext` | Proveedor. El deploy en Vercel usa `mock`: un ERPNext local no es alcanzable desde ahí. |
| `ERP_MOCK_SCENARIO` | No | `ok` (defecto) \| `timeout` \| `unauthorized` \| `validation` \| `server_error` | Falla permanente que simula el mock (§6). |
| `ERP_BASE_URL` | Con `erpnext` | URL http(s) | Raíz de la instancia, p. ej. `http://localhost:8080`. |
| `ERP_API_KEY` | Con `erpnext` | texto | API key del usuario técnico. |
| `ERP_API_SECRET` | Con `erpnext` | texto | API secret del usuario técnico. ERPNext autentica con `Authorization: token <key>:<secret>`. |
| `ERP_TIMEOUT_MS` | No | entero > 0 (defecto `10000`) | Timeout por request. |

Ninguna lleva prefijo `NEXT_PUBLIC_` (hay un test que lo verifica). Una configuración inválida falla con
`ErpError` de código `config` al pedir el cliente.

## 3. Interfaz `ErpClient`

```ts
interface ErpClient {
  readonly provider: "mock" | "erpnext";
  healthcheck(): Promise<ErpHealth>;
  pullMasterData(options?: { updatedSince?: string }): Promise<ErpMasterData>;
  pullDispatchOrders(options?: { updatedSince?: string }): Promise<ErpDispatchOrder[]>;
  reportDispatch(report: DispatchReport): Promise<DispatchReportResult>;
}
```

Uso desde una Server Action o un Route Handler:

```ts
import { getErpClient, isErpError } from "@/lib/erp";

const erp = getErpClient(companyId); // companyId hoy se ignora; queda para configuración por empresa
const data = await erp.pullMasterData();
```

Todas las fechas-hora son ISO 8601 en UTC; las fechas sin hora (`manufacturingDate`, `expirationDate`,
`scheduledDate`) son `YYYY-MM-DD`.

## 4. ERP → TrazFlow

### 4.1 `pullMasterData` — productos, lotes y stock

`updatedSince` filtra productos y lotes modificados desde ese instante. El stock se devuelve siempre completo (es
una foto, no un cambio). Un registro que deja de venir **no** se borra en TrazFlow (regla de US-ERP-03).

```json
{
  "contractVersion": 1,
  "fetchedAt": "2026-10-15T15:00:00.000Z",
  "products": [
    { "externalId": "ACE-500", "sku": "ACE-500", "name": "Aceite de girasol 500 ml", "uom": "Caja",
      "batchTracked": true, "active": true, "updatedAt": "2026-10-01T12:00:00.000Z" }
  ],
  "lots": [
    { "externalId": "L-2026-0915", "productExternalId": "ACE-500", "lotNumber": "L-2026-0915",
      "manufacturingDate": "2026-09-15", "expirationDate": "2027-03-31", "active": true,
      "updatedAt": "2026-10-01T12:00:00.000Z" }
  ],
  "stock": [
    { "productExternalId": "ACE-500", "lotExternalId": "L-2026-0915",
      "warehouseExternalId": "Depósito Central - SRV", "quantity": 120, "uom": "Caja" }
  ]
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `products[].externalId` | Sí | Clave de upsert junto con `company_id`. |
| `products[].uom` | Sí | Unidad de stock **como la nombra el ERP**. Traducirla a `products.unit_of_measure` es tarea de la sincronización (US-ERP-03). |
| `products[].active` | Sí | `false` = deshabilitado en el ERP. No se borra. |
| `lots[].productExternalId` | Sí | Debe existir en `products` (de esta u otra sincronización). |
| `lots[].expirationDate` | No | `null` si el ERP no la informa. TrazFlow no calcula alertas. |
| `stock[]` | — | Stock **por lote y depósito**. El ERP no conoce pallets: el pallet físico (QR) lo crea TrazFlow contra un lote. Solo cantidades > 0. |

### 4.2 `pullDispatchOrders` — órdenes de despacho

Devuelve solo órdenes abiertas (`pending` o `partially_delivered`).

```json
[{
  "contractVersion": 1,
  "externalId": "SAL-ORD-2026-00012",
  "status": "pending",
  "customer": { "externalId": "CUST-NORTE", "name": "Distribuidora Norte" },
  "scheduledDate": "2026-10-20",
  "lines": [
    { "externalId": "SAL-ORD-2026-00012-1", "productExternalId": "ACE-500", "quantity": 65, "uom": "Caja",
      "warehouseExternalId": "Depósito Central - SRV" }
  ],
  "updatedAt": "2026-10-01T12:00:00.000Z"
}]
```

`status`: `pending` | `partially_delivered` | `delivered` | `cancelled`. `customer` es el destinatario: dato de
negocio, sin usuario en TrazFlow (US-ERP-01). Las líneas no traen lote: qué lote sale lo decide el depósito y se
informa en el reporte.

## 5. TrazFlow → ERP: `reportDispatch`

Un reporte **por orden despachada**, con una línea por pallet que salió físicamente.

```json
{
  "contractVersion": 1,
  "idempotencyKey": "dispatch:SAL-ORD-2026-00012",
  "orderExternalId": "SAL-ORD-2026-00012",
  "dispatchedAt": "2026-10-15T14:30:00.000Z",
  "operator": { "id": "5d0c…", "name": "Operador Depósito" },
  "lines": [
    { "orderLineExternalId": "SAL-ORD-2026-00012-1", "palletCode": "PAL-0001", "productExternalId": "ACE-500",
      "lotExternalId": "L-2026-0915", "quantity": 45, "uom": "Caja" },
    { "orderLineExternalId": "SAL-ORD-2026-00012-1", "palletCode": "PAL-0002", "productExternalId": "ACE-500",
      "lotExternalId": "L-2026-0921", "quantity": 20, "uom": "Caja" }
  ]
}
```

Respuesta:

```json
{ "erpReference": "MAT-DN-2026-00001", "duplicate": false, "acceptedAt": "2026-10-15T14:30:02.000Z" }
```

Validaciones previas al envío (`dispatchReportProblems`, fallan con `validation` sin llamar al ERP):
`contractVersion` soportada; `idempotencyKey`, `orderExternalId` y `operator.id` no vacíos; `dispatchedAt` ISO 8601;
al menos una línea; `palletCode` no vacío y sin repetir; `productExternalId`, `lotExternalId` y `uom` no vacíos;
`quantity` > 0. `orderLineExternalId` es opcional (`null` si no se conoce).

### 5.1 Idempotencia

- La clave es `dispatch:{orderExternalId}` (`buildDispatchIdempotencyKey`). Depende solo de la orden: confirmar dos
  veces o reintentar desde `erp_outbox_events` (US-ERP-04) produce **la misma clave**.
- **Misma clave → mismo resultado.** Si el ERP ya registró esa clave, responde el `erpReference` original con
  `duplicate: true` y no registra otra salida. Para el outbox, `duplicate: true` es éxito.
- Misma clave con **otro contenido** → `conflict` (409). No se reintenta: requiere revisión.
- **Un solo reporte por orden.** En la versión 1 del contrato no hay despachos parciales de una misma orden: un
  segundo reporte con otros pallets o cantidades usa la misma clave y termina en `conflict`.
- El mock compara el payload completo con claves ordenadas, porque el payload guardado en `jsonb` vuelve con otro
  orden. ERPNext compara lo que conserva el remito: fecha y hora, operador y, por pallet, producto, lote, cantidad y
  unidad.

## 6. Errores

Todas las operaciones fallan con `ErpError { code, retryable, status, message }`. El `message` está sanitizado (sin
credenciales, headers ni trazas del ERP, máximo ~300 caracteres): se puede guardar en `last_error` y mostrar en el
panel de integración.

| `code` | HTTP | Reintentable | Significado | Qué hace el outbox (US-ERP-04) |
|---|---|---|---|---|
| `timeout` | — | Sí | Sin respuesta en `ERP_TIMEOUT_MS`. | Reintento con backoff. |
| `network` | — | Sí | No se pudo conectar. | Reintento con backoff. |
| `unavailable` | 5xx | Sí | Error interno del ERP. | Reintento con backoff. |
| `rate_limited` | 429 | Sí | Demasiadas llamadas. | Reintento con backoff. |
| `unauthorized` | 401/403 | No | Credenciales inválidas o sin permisos. | Requiere atención (configuración). |
| `validation` | 400/417/422 | No | El ERP rechazó el dato (orden inexistente o cerrada, lote de otro producto…). | Requiere atención. |
| `not_found` | 404 | No | Entidad inexistente en lecturas puntuales. | Requiere atención. |
| `conflict` | 409 | No | Clave de idempotencia usada con otro contenido. | Requiere atención. |
| `invalid_response` | — | No | La respuesta no respeta el contrato. | Requiere atención. |
| `config` | — | No | Falta o es inválida la configuración. | Requiere atención. |

## 7. Mock (`ERP_PROVIDER=mock`)

- Fixtures deterministas en `src/lib/erp/fixtures.ts`: 4 productos (uno inactivo), 5 lotes, stock por lote y
  5 órdenes (4 abiertas, 1 entregada). Los ids imitan los de ERPNext.
- Estado en memoria por proceso: reportar un despacho marca la orden como entregada y guarda la clave. Reiniciar
  el servidor vuelve a los fixtures.
- Fallas permanentes con `ERP_MOCK_SCENARIO` (`validation` solo afecta a `reportDispatch`).
- En tests: `new MockErpClient({ failures: ["timeout", "server_error"] })` falla una vez por cada elemento y después
  responde bien, para probar reintentos; `fixtures` y `now` se pueden inyectar.
- Valida como un ERP real: orden inexistente o cerrada, producto inexistente, lote de otro producto o línea de otra
  orden → `validation` (422).

## 8. ERPNext (`ERP_PROVIDER=erpnext`)

API REST de Frappe (`/api/resource/<Doctype>` y `/api/method/<ruta>`), autenticación `token key:secret`.

| Operación | Llamadas | Mapeo |
|---|---|---|
| `healthcheck` | `GET /api/method/frappe.auth.get_logged_user` | `Guest` o error → `unauthorized`. |
| Productos | `GET /api/resource/Item` (`is_stock_item = 1`) | `name` → `externalId`, `item_code` → `sku`, `item_name`, `stock_uom` → `uom`, `has_batch_no`, `disabled`. |
| Lotes | `GET /api/resource/Batch` | `name` (= `batch_id`) → `externalId` y `lotNumber`, `item`, `manufacturing_date`, `expiry_date`, `disabled`. |
| Stock | `GET /api/method/erpnext.stock.doctype.batch.batch.get_batch_qty?item_code=…` por ítem con lote y activo | `{ batch_no, warehouse, qty }`, solo `qty > 0`. |
| Órdenes | `GET /api/resource/Sales Order` (`docstatus = 1`, `status in ["To Deliver and Bill", "To Deliver"]`) + `GET /api/resource/Sales Order/<name>` | Líneas en unidad de stock (`stock_qty`, `stock_uom`). Estado por `status`/`per_delivered`. |
| Reporte | `GET /api/resource/Delivery Note` filtrando por la clave; si existe, `GET` del remito para comparar el contenido (duplicado o `conflict`); si no, `GET` de la Sales Order y `POST /api/resource/Delivery Note` | Remito **en borrador** (docstatus 0) contra la orden (`against_sales_order`, `so_detail`), con `batch_no` y `use_serial_batch_fields` por línea. La orden tiene que estar confirmada y en `To Deliver and Bill` / `To Deliver`, y cada `orderLineExternalId` informado tiene que ser de la orden; si no, `validation`. |

Decisiones y requisitos de la instancia:

- **Remito en borrador.** TrazFlow no submitea el Delivery Note: el submit es lo que mueve stock en ERPNext y queda
  del lado del ERP. TrazFlow solo informa qué lote y pallet salieron.
- **Campos personalizados** (Customize Form), necesarios para idempotencia y trazabilidad:
  - `Delivery Note.trazflow_idempotency_key` — Data, **Unique**. ERPNext no tiene idempotency key nativa: el
    adaptador busca por este campo antes de crear, y si dos envíos simultáneos chocan, el índice único rechaza el
    segundo (409 o 417, según dónde choque en Frappe). El adaptador vuelve a buscar el remito y lo resuelve como
    duplicado o `conflict`; si no lo encuentra, el error se propaga tal cual.
  - `Delivery Note.trazflow_operator` — Data.
  - `Delivery Note Item.trazflow_pallet_code` — Data.
- **Zona horaria.** Frappe guarda `modified`/`creation` en hora del servidor sin offset; el adaptador asume
  `-03:00` (`ERPNEXT_UTC_OFFSET`), la de la instancia de la demo.
- **Paginación.** Listados de a 500 registros (`limit_start` / `limit_page_length`) ordenados por `creation`.
- Verificado contra el código de ERPNext v15 (`Batch`, `get_batch_qty`) y la documentación REST de Frappe. Si la
  instancia es otra versión, revisar `get_batch_qty` y los campos de lote en `Delivery Note Item`.

## 9. Pruebas

`npm test` corre, entre otros, `src/lib/erp/*.test.ts`:

- `mock-client.test.ts`: contrato de los fixtures, filtros, duplicados (incluido payload reordenado por `jsonb`),
  conflicto, 422, timeout/401/500 y fallas de una sola vez.
- `erpnext-client.test.ts`: contract tests con respuestas de ERPNext falsas (forma real de Item, Batch,
  get_batch_qty, Sales Order), cuerpo exacto del Delivery Note, idempotencia y carrera 409, traducción de errores
  HTTP, timeout/red y sanitización de mensajes.
- `index.test.ts`: factory y validación de entorno.
- `types.test.ts`: clave de idempotencia y clasificación de errores.
- `server-boundary.test.ts`: los módulos con entorno o red importan `server-only`, ninguna variable ERP usa
  `NEXT_PUBLIC_` y ningún componente `"use client"` importa algo más que tipos del ERP.

En tests no hay bundler de Next: `scripts/test-server-only.mjs` resuelve `server-only` a un módulo vacío.
