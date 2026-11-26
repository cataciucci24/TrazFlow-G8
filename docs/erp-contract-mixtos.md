# Contrato ERP v2 – Pallets mixtos (TRZ-111, ola 2)

## Versionado
- `ERP_CONTRACT_VERSION = 2`. Los validadores y adaptadores aceptan **1 y 2**.
- Los eventos v1 ya guardados en el outbox se procesan **tal cual**: misma clave y mismo payload. Internamente, un v1 se normaliza a `items: [un ítem]`.
- v1 conserva su regla (palletCode único por despacho). v2 permite repetirlo.

## Tipos
```ts
/** Snapshot de un ítem físico del pallet. */
type PalletItem = {
  productExternalId: string;
  lotExternalId: string;
  quantity: number;   // > 0
  uom: string;
};

// ---- Despacho (reportDispatch): forma sin cambios ----
type DispatchReportLine = {
  orderLineExternalId: string | null;
  palletCode: string;
  productExternalId: string;
  lotExternalId: string;
  quantity: number;
  uom: string;
};
// v2: identidad de línea = palletCode + productExternalId + lotExternalId.
//     El palletCode se repite (una línea por ítem). El mismo trío repetido → error (hay que sumarlo en una línea).

// ---- Pick List (reportPalletScan) ----
type PalletScanReportV2 = {
  contractVersion: 2;
  idempotencyKey: string;       // pallet-scan:{orden}:{pallet}:{n} | pallet-unscan:{orden}:{pallet}:{n} (sin cambios)
  action: "scan" | "unscan";
  scanIdempotencyKey: string;   // scan: igual a idempotencyKey. unscan: la clave del scan ORIGINAL
  orderExternalId: string;
  palletCode: string;
  items: PalletItem[];          // ≥ 1, sin producto+lote repetido.
                                // scan: contenido escaneado. unscan: COPIA EXACTA de los items del scan original
  at: string;                   // ISO 8601
};
type PalletScanReport = PalletScanReportV1 /* forma actual, un ítem */ | PalletScanReportV2;

// ---- Entrega (reportDelivery) ----
// DELIVERY_DISCREPANCY_TYPES suma "content_mismatch".
type ObservedItem = {
  productExternalId: string | null; // null si el chofer cargó algo que no se pudo identificar en el ERP
  lotExternalId: string | null;
  observedSku: string | null;       // texto tal cual se cargó, cuando no hay ID (nunca se inventa un ID)
  observedLot: string | null;
  quantity: number | null;          // > 0 si se conoce; null = cantidad no informada
  uom: string | null;               // null = unidad desconocida; nunca se inventa
};
type ContentDifference = {
  expected: PalletItem | null;      // null = sobrante (llegó algo que no estaba)
  detected: ObservedItem | null;    // null = faltante (no llegó)
};                                  // nunca los dos null
type DeliveryDiscrepancy = {
  palletCode: string | null;
  type: "missing" | "surplus" | "damaged" | "wrong_order" | "content_mismatch";
  contentDifferences?: ContentDifference[]; // obligatorio y no vacío si type = content_mismatch; prohibido en los demás
};
// DeliveryReport: forma actual; `discrepancies` pasa a ser DeliveryDiscrepancy[]. `lines` sigue por pallet.
```

## Garantías de los adaptadores
1. **Scan atómico:** todas las filas del pallet se agregan en una sola escritura, con `trazflow_idempotency_key = scanIdempotencyKey` en cada fila. Si ya existe alguna fila con esa clave → `duplicate: true`, sin escribir nada.
2. **Unscan atómico y fiel al scan original:** se sacan **todas** las filas con `scanIdempotencyKey` en una sola escritura. No se usa el contenido actual del pallet. Si el scan todavía no llegó → `not_ready` (reintentable). Si ya se sacó → `duplicate: true`.
3. **Despacho:** una fila del remito por línea. La detección de duplicados compara las filas sin importar el orden; misma clave con otro contenido → `conflict`.
4. **Entrega:** `content_mismatch` se registra con lo esperado y lo detectado de cada diferencia. Lo desconocido aparece como texto observado; nunca se crea ni se asigna un producto o lote en el ERP a partir de eso.
5. **Reintentos:** misma clave y mismo payload, en v1 y en v2.

## Ejemplos
```json
// Despacho v2: pallet mixto P-0007 (2 ítems) + pallet simple P-0008
{ "contractVersion": 2, "idempotencyKey": "dispatch:SO-0042", "orderExternalId": "SO-0042",
  "dispatchedAt": "2026-11-24T13:05:00.000Z", "operator": { "id": "u-17", "name": "Depósito Demo" },
  "lines": [
    { "orderLineExternalId": "SOI-1", "palletCode": "P-0007", "productExternalId": "ITEM-AGUA", "lotExternalId": "L-AG-11", "quantity": 40, "uom": "Unit" },
    { "orderLineExternalId": "SOI-2", "palletCode": "P-0007", "productExternalId": "ITEM-JUGO", "lotExternalId": "L-JU-03", "quantity": 20, "uom": "Unit" },
    { "orderLineExternalId": "SOI-1", "palletCode": "P-0008", "productExternalId": "ITEM-AGUA", "lotExternalId": "L-AG-12", "quantity": 60, "uom": "Unit" } ] }

// Scan v2 del pallet mixto
{ "contractVersion": 2, "idempotencyKey": "pallet-scan:SO-0042:P-0007:1", "action": "scan",
  "scanIdempotencyKey": "pallet-scan:SO-0042:P-0007:1", "orderExternalId": "SO-0042", "palletCode": "P-0007",
  "items": [ { "productExternalId": "ITEM-AGUA", "lotExternalId": "L-AG-11", "quantity": 40, "uom": "Unit" },
             { "productExternalId": "ITEM-JUGO", "lotExternalId": "L-JU-03", "quantity": 20, "uom": "Unit" } ],
  "at": "2026-11-24T12:40:00.000Z" }

// Unscan v2: copia los items del scan original, aunque el pallet haya cambiado después
{ "contractVersion": 2, "idempotencyKey": "pallet-unscan:SO-0042:P-0007:1", "action": "unscan",
  "scanIdempotencyKey": "pallet-scan:SO-0042:P-0007:1", "orderExternalId": "SO-0042", "palletCode": "P-0007",
  "items": [ { "productExternalId": "ITEM-AGUA", "lotExternalId": "L-AG-11", "quantity": 40, "uom": "Unit" },
             { "productExternalId": "ITEM-JUGO", "lotExternalId": "L-JU-03", "quantity": 20, "uom": "Unit" } ],
  "at": "2026-11-24T12:52:00.000Z" }

// Scan v1 (un ítem): sigue siendo válido, tal cual está guardado en el outbox
{ "contractVersion": 1, "idempotencyKey": "pallet-scan:SO-0042:P-0008:1", "action": "scan",
  "scanIdempotencyKey": "pallet-scan:SO-0042:P-0008:1", "orderExternalId": "SO-0042", "palletCode": "P-0008",
  "productExternalId": "ITEM-AGUA", "lotExternalId": "L-AG-12", "quantity": 60, "uom": "Unit",
  "at": "2026-11-24T12:41:00.000Z" }

// Entrega v2 con content_mismatch: faltan 5 de jugo y llegó algo desconocido
{ "contractVersion": 2, "idempotencyKey": "delivery:SO-0042", "orderExternalId": "SO-0042",
  "dispatchIdempotencyKey": "dispatch:SO-0042", "deliveredAt": "2026-11-24T16:20:00.000Z",
  "driver": { "id": "u-31", "name": "Chofer Demo" }, "needsReview": true,
  "lines": [ { "palletCode": "P-0007", "outcome": "delivered" }, { "palletCode": "P-0008", "outcome": "delivered" } ],
  "discrepancies": [ { "palletCode": "P-0007", "type": "content_mismatch", "contentDifferences": [
      { "expected": { "productExternalId": "ITEM-JUGO", "lotExternalId": "L-JU-03", "quantity": 20, "uom": "Unit" },
        "detected": { "productExternalId": "ITEM-JUGO", "lotExternalId": "L-JU-03", "observedSku": null, "observedLot": null, "quantity": 15, "uom": "Unit" } },
      { "expected": null,
        "detected": { "productExternalId": null, "lotExternalId": null, "observedSku": "GASEOSA-X", "observedLot": "SIN-LOTE", "quantity": 3, "uom": "Unit" } } ] } ] }
```

## Qué necesita persona 3 (productores, sobre TRZ-112)
- Generar los eventos nuevos con `contractVersion: 2`. No reescribir los eventos v1 pendientes.
- Scan: `items` sale del contenido escaneado, que es el snapshot de la orden.
- Unscan: `items` se copia del **payload del evento de scan original** (no del pallet actual), y `scanIdempotencyKey` es la clave de ese scan.
- Despacho: una línea por ítem, sumando producto + lote repetidos dentro del mismo pallet.
- Entrega: `content_mismatch` con una `ContentDifference` por diferencia; lo no identificado va con IDs en `null` y el texto en `observed*`.
- Los formatos de clave de idempotencia no cambian.
- La TM111 se retira solo después de la prueba conjunta: productores + adaptadores + outbox por empresa.

## Integración del 26/11/2026

Las observaciones de recepción admiten explícitamente `quantity: null` y `uom: null`. Una cantidad desconocida conserva el objeto `detected` y sus textos observados; no se informa como faltante. Un cero conocido se representa como `detected: null`, manteniendo el valor original en la auditoría. No se admiten cero, negativos, valores no finitos ni campos omitidos en una observación. Las cantidades/unidades esperadas, de despacho y de scan siguen siendo obligatorias y estrictas.

El comentario de ERPNext muestra «cantidad desconocida» y «unidad desconocida» cuando corresponde. Un replay de un scan cuya ronda ya se revirtió se considera duplicado y no vuelve a agregar sus filas. Una nueva ronda conserva una clave diferente.

La migración `20261126150000_trz111_enable_mixed_erp.sql` retira las dos restricciones TM111 conservando la comparación de contenido actual/esperado/validado. Requiere desplegar conjuntamente esta versión de los validadores/adaptadores y los productores v2. Los eventos v1 no se reescriben.
