# Contrato ERP — TrazFlow ↔ ERP (US-ERP-02 / TRZ-92)

> Versión del contrato: **1** (`ERP_CONTRACT_VERSION` en `src/lib/erp/types.ts`). TRZ-100 le sumó la operación
> `getDispatchStatus` (§5.2) como **extensión aditiva**: no cambia ningún payload existente, así que la versión
> sigue en 1. `contractVersion` versiona la forma de los payloads, y esta operación no agrega campos a ninguno.
> TRZ-101 le sumó `warehouses` a `pullMasterData` (§4.1). Es un campo nuevo, obligatorio en la respuesta; quedó
> en la versión 1 porque los dos proveedores (mock y ERPNext) son de TrazFlow y se actualizaron juntos: no hay un
> ERP externo que mande payloads v1 sin el campo.
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
| `ERP_MOCK_DISPATCH_STATUS` | No | `confirmed` (defecto) \| `draft` | Solo mock: qué responde `getDispatchStatus` (§7). |
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
  getDispatchStatus(idempotencyKey: string): Promise<DispatchDocumentStatus>; // TRZ-100, §5.2
  reportDelivery(report: DeliveryReport): Promise<DeliveryReportResult>; // TRZ-103, §5.3
  attachDeliveryReceipt(receipt: DeliveryReceipt, content: Uint8Array): Promise<DeliveryReportResult>; // TRZ-103, §5.3
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

### 4.1 `pullMasterData` — depósitos, productos, lotes y stock

`updatedSince` filtra productos y lotes modificados desde ese instante. Depósitos y stock se devuelven siempre
completos (un depósito que no viene se marca inactivo; un saldo que no viene pasa a 0). Un registro que deja de
venir **no** se borra en TrazFlow (regla de US-ERP-03).

```json
{
  "contractVersion": 1,
  "fetchedAt": "2026-10-15T15:00:00.000Z",
  "warehouses": [
    { "externalId": "Depósito Central - SRV", "name": "Depósito Central", "active": true,
      "updatedAt": "2026-10-01T12:00:00.000Z" }
  ],
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
| `warehouses[]` | Sí (TRZ-101) | Lista completa, sin grupos de depósitos. Forma validada por `assertValidErpWarehouses` (`invalid_response` si no es una lista de `{ externalId, name, active, updatedAt }`). |
| `warehouses[].externalId` | Sí | Id estable: el mismo valor que `stock[].warehouseExternalId` y `lines[].warehouseExternalId`. Clave de upsert junto con `company_id`. |
| `warehouses[].name` | Sí | Nombre visible. Se usa para generar el código del depósito en TrazFlow al importarlo. |
| `warehouses[].active` | Sí | `false` = deshabilitado en el ERP. Queda inactivo en TrazFlow. |
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

**Cómo lo arma TrazFlow (`erp_outbox_dispatch_payload`, TRZ-100):** una línea por pallet asociado a la orden con
`expected = true`, con la cantidad real del pallet (los pallets se arman en TrazFlow contra el saldo del lote, así
que se informa lo que salió, no el saldo). `orderLineExternalId` es la línea de la orden (`dispatch_order_lines`)
que pide ese producto **si hay exactamente una**. Con dos o más líneas del mismo producto va `null` (TrazFlow no
reparte un pallet entre líneas) y el adaptador de ERPNext usa la primera línea de ese producto. Las órdenes
importadas antes de TRZ-100 no tienen líneas y siguen informando `null`.

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

### 5.2 `getDispatchStatus` — estado del remito (TRZ-100)

Pregunta en qué estado está en el ERP el documento que generó el reporte con esa clave. TrazFlow lo usa para
saber cuándo el ERP ya descontó el stock despachado (en ERPNext el remito queda en borrador y el stock recién baja
al confirmarlo).

```ts
getDispatchStatus(idempotencyKey: string): Promise<DispatchDocumentStatus>
type DispatchDocumentStatus = {
  status: "draft" | "confirmed" | "cancelled" | "not_found";
  erpReference: string | null; // p. ej. "MAT-DN-2026-00001"; null si no se conoce
};
```

| `status` | Significado |
|---|---|
| `draft` | El remito existe y nadie lo confirmó: el stock del ERP todavía no bajó. |
| `confirmed` | Confirmado: el ERP ya descontó el stock. |
| `cancelled` | Anulado: el stock nunca salió del ERP. |
| `not_found` | No hay remito con esa clave (p. ej. se borró el borrador). |

- Si hay varios documentos con la misma clave (uno anulado y su corrección), gana `confirmed`, después `draft` y por
  último `cancelled`.
- Clave vacía → `validation` sin llamar al ERP. Una respuesta que no respeta esta forma → `invalid_response`
  (`assertValidDispatchDocumentStatus`). Los errores son los de §6.
- Quién la llama y dónde se guarda: [`erp-sync.md`](erp-sync.md), "Estado del remito".

### 5.3 Entrega y remito firmado (TRZ-103)

Dos operaciones aditivas que van al **mismo documento que generó el despacho** (`dispatchIdempotencyKey`):

- `reportDelivery(report)`: cómo cerró la entrega. Clave `delivery:{orderExternalId}`. Lleva el chofer, la fecha, el
  resultado de cada pallet esperado (`delivered` / `missing` / `damaged`), todas las diferencias (también
  `surplus` y `wrong_order`) y `needsReview`, que es `true` si hubo alguna diferencia.
- `attachDeliveryReceipt(receipt, content)`: el remito firmado (foto o PDF, hasta 10 MB). Clave
  `delivery-receipt:{orderExternalId}:{id}`, una por archivo. El contenido no se guarda en el outbox: el procesador
  lo baja del bucket privado `delivery-receipts` al enviarlo.

Las dos son idempotentes por clave y **nunca confirman** el documento. Si el documento del despacho todavía no existe
(el despacho sigue en el outbox), fallan con `not_ready`, que se reintenta.

Los eventos los encola la base: `delivery_confirmed` con un trigger cuando la orden pasa a `delivered` /
`delivered_with_discrepancy`, y `delivery_receipt_attached` en `register_delivery_receipt`, después de que el chofer
sube el archivo (`20261028130000_trz103_delivery_receipts.sql`). Solo para órdenes que vinieron del ERP. Se envían
enseguida, en un `after()` de la acción del chofer, con RPC propias del chofer que solo le dejan tomar los eventos de
entrega de sus órdenes (`erp_outbox_driver_claim` / `_mark_sent` / `_mark_failed`, `20261028130100`). Si el ERP falla,
quedan con el backoff de siempre para el próximo procesamiento ("Enviar pendientes ahora", despachos o el cron).

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
| `not_ready` | — | Sí | Falta algo previo en el ERP (la entrega llegó antes que el remito del despacho). | Reintento con backoff. |

## 7. Mock (`ERP_PROVIDER=mock`)

- Fixtures deterministas en `src/lib/erp/fixtures.ts`: 2 depósitos ("Depósito Central - SRV" y "Depósito Norte -
  SRV", con 30 cajas del lote L-2026-0921 y sin órdenes), 4 productos (uno inactivo), 5 lotes, stock por lote y
  depósito y 5 órdenes (4 abiertas, 1 entregada). Los ids imitan los de ERPNext.
- Estado en memoria por proceso: reportar un despacho marca la orden como entregada y guarda la clave. Reiniciar
  el servidor vuelve a los fixtures.
- **No descuenta stock:** reportar un despacho no cambia el saldo de los fixtures (120/80/200/150/356,5 en Central
  y 30 en Norte).
- `getDispatchStatus`: si la clave está en memoria responde `confirmed` con la referencia del reporte, simulando que
  administración confirma enseguida. Si no está (el proceso se reinició, o es otra instancia en Vercel) responde
  `confirmed` igual, con `erpReference: null`: el mock no guarda estado confiable entre procesos y no queremos
  pallets trabados en local. Con `ERP_MOCK_DISPATCH_STATUS=draft` responde `draft`, para probar en local que los
  pallets despachados siguen contando contra el saldo (no vuelven al disponible de "Armar pallet") hasta que el
  remito se confirma.
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
| Depósitos | `GET /api/resource/Warehouse` (`is_group = 0`, sin `updatedSince`; incluye deshabilitados) | `name` → `externalId`, `warehouse_name` (o `name` si viene vacío) → `name`, `disabled` → `active`, `modified`. |
| Productos | `GET /api/resource/Item` (`is_stock_item = 1`) | `name` → `externalId`, `item_code` → `sku`, `item_name`, `stock_uom` → `uom`, `has_batch_no`, `disabled`. |
| Lotes | `GET /api/resource/Batch` | `name` (= `batch_id`) → `externalId` y `lotNumber`, `item`, `manufacturing_date`, `expiry_date`, `disabled`. |
| Stock | `GET /api/method/erpnext.stock.doctype.batch.batch.get_batch_qty?item_code=…` por ítem con lote y activo | `{ batch_no, warehouse, qty }`, solo `qty > 0`. |
| Órdenes | `GET /api/resource/Sales Order` (`docstatus = 1`, `status in ["To Deliver and Bill", "To Deliver"]`) + `GET /api/resource/Sales Order/<name>` | Líneas en unidad de stock (`stock_qty`, `stock_uom`). Estado por `status`/`per_delivered`. |
| Estado del remito | `GET /api/resource/Delivery Note` con `fields = ["name", "docstatus"]` y filtro `trazflow_idempotency_key = <clave>`, **incluyendo los anulados** (a diferencia del lookup del reporte, que filtra `docstatus != 2`) | `docstatus` 0 → `draft`, 1 → `confirmed`, 2 → `cancelled`; ninguno → `not_found`. Con varios, prioridad 1 > 0 > 2. `name` → `erpReference`. |
| Reporte | `GET /api/resource/Delivery Note` filtrando por la clave; si existe, `GET` del remito para comparar el contenido (duplicado o `conflict`); si no, `GET` de la Sales Order y `POST /api/resource/Delivery Note` | Remito **en borrador** (docstatus 0) contra la orden (`against_sales_order`, `so_detail`), con `batch_no` y `use_serial_batch_fields` por línea. La orden tiene que estar confirmada y en `To Deliver and Bill` / `To Deliver`, y cada `orderLineExternalId` informado tiene que ser de la orden; si no, `validation`. |

| Entrega (TRZ-103) | Busca el Delivery Note del despacho (`trazflow_idempotency_key = dispatch:…`, sin anulados); `GET /api/resource/Comment` filtrando por el remito y la marca `[trazflow:delivery:…]`; si no está, `POST /api/method/frappe.desk.doctype.tag.tag.add_tag` (solo con diferencias) y `POST /api/resource/Comment` | Comentario HTML con chofer, fecha y resultado por pallet. Con diferencias, además la etiqueta **"TrazFlow: revisar entrega"** en el remito. |
| Remito firmado (TRZ-103) | Mismo Delivery Note; `GET /api/resource/File` por `attached_to_name` y `file_name`; si no está, `POST /api/method/upload_file` (multipart, `is_private = 1`) | Archivo privado adjunto al remito, con nombre fijo por clave (`trazflow-delivery-receipt-….jpg`). |

Decisiones y requisitos de la instancia:

- **Remito en borrador.** TrazFlow no submitea el Delivery Note: el submit es lo que mueve stock en ERPNext y queda
  del lado del ERP. TrazFlow solo informa qué lote y pallet salieron, y después pregunta si ya se confirmó (§5.2).
- **No verificado contra una instancia real** (no hay una publicada): el filtro de `Delivery Note` por un campo
  personalizado sin filtrar `docstatus` y la lectura de `docstatus` en el listado se probaron solo con respuestas
  simuladas en `erpnext-client.test.ts`. Con el usuario de API hay que poder leer remitos anulados.
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

- `mock-client.test.ts`: contrato de los fixtures (incluidos los depósitos: cada saldo y línea nombra uno), filtros, duplicados (incluido payload reordenado por `jsonb`),
  conflicto, 422, timeout/401/500, fallas de una sola vez, `getDispatchStatus` (en memoria, sin memoria, `draft`,
  fallas) y que el reporte no descuenta stock.
- `erpnext-client.test.ts`: contract tests con respuestas de ERPNext falsas (forma real de Warehouse, Item, Batch,
  get_batch_qty, Sales Order), cuerpo exacto del Delivery Note, idempotencia y carrera 409, traducción de errores
  HTTP, timeout/red, sanitización de mensajes y `getDispatchStatus` (borrador, confirmado, anulado, no encontrado,
  varios remitos, errores HTTP y respuesta inválida).
- `erpnext-delivery.test.ts` (TRZ-103): comentario y etiqueta de la entrega, adjunto del remito, duplicados,
  `not_ready` sin remito del despacho y que nunca se modifica ni confirma el Delivery Note.
- `index.test.ts`: factory y validación de entorno (incluido `ERP_MOCK_DISPATCH_STATUS`).
- `types.test.ts`: clave de idempotencia y clasificación de errores.
- `server-boundary.test.ts`: los módulos con entorno o red importan `server-only`, ninguna variable ERP usa
  `NEXT_PUBLIC_` y ningún componente `"use client"` importa algo más que tipos del ERP.

En tests no hay bundler de Next: `scripts/test-server-only.mjs` resuelve `server-only` a un módulo vacío.
