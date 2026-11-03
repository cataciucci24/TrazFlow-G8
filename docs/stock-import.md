# Importar productos, lotes y stock (USH1)

Ruta: `/dashboard/inventory/import`, desde «Importar desde Excel» en Stock. Solo logística: lo verifican la página, las acciones, la plantilla y la RPC.

## Flujo

1. Descargar la plantilla (`.xlsx`) o usar un `.csv` con las mismas columnas: Producto, SKU, Unidad, Lote, Vencimiento, Depósito y Cantidad. En `.csv` se admite `;` o `,` como separador.
2. «Revisar archivo» muestra cuántas filas entran, las primeras 10 y, de las que no, la fila y el motivo. No escribe nada.
3. «Confirmar» vuelve a leer y validar el archivo en el servidor: no se confía en filas enviadas por el navegador. Las filas con error se saltean, las demás entran.

Límites: 5.000 filas y 4 MB. Una falla general deja filas «sin procesar»; reintentar es seguro porque usa la misma clave de importación y las filas ya hechas no se repiten.

## Validaciones

- **En el archivo** (`src/lib/stock-import/rows.ts`): formato de SKU y lote, unidad (`unidades`, `cajas`, `kilogramos`, con alias como `kg`), fecha real y no vencida, cantidad mayor a 0 (entera salvo en kilogramos, con hasta dos decimales y sin separador de miles), fila duplicada por SKU + lote + depósito, y mismo SKU con otra unidad o nombre, o mismo lote con otro vencimiento.
- **Contra la empresa** (`import_stock_rows`, en tandas de 500): depósito existente y activo o, con ERP, vinculado; unidad y vencimiento iguales a los ya cargados; y que ese lote no tenga ya stock o una importación viva en ese depósito.

Esa última regla evita duplicar stock al subir dos veces un archivo. Por eso esta pantalla sirve para la carga inicial y no para reponer un lote existente.

## Con y sin ERP

Lo decide `isErpEnabled`, igual que el resto de la app.

- **Sin ERP:** crea producto y lote si faltan, y un pallet en depósito por fila. Cada pallet cuenta para el consumo del plan (TRZ-43).
- **Con ERP:** TrazFlow no crea nada. Cada fila es un evento `stock_import_requested` del outbox, con los reintentos y el seguimiento de siempre en Integración ERP. En ERPNext, `reportStockImport` crea la unidad, el Item y el Batch que falten y deja un Stock Entry en borrador (Material Receipt). El stock entra a TrazFlow con la sincronización, después de que alguien confirme el borrador en el ERP.

En ERPNext, un producto nuevo va al Item Group de `ERP_ITEM_GROUP` o, sin esa variable, al primero que no sea grupo, sin valuación (`allow_zero_valuation_rate`). Un producto existente con otra unidad o sin control por lote, o un lote de otro producto o con otro vencimiento, deja el evento en `failed` con el motivo: no se pisan datos del ERP.

**Ritmo.** El cron del outbox manda hasta 250 eventos cada 5 minutos, según lo que tarde el ERP: 5.000 filas llevan unas dos horas como mínimo. Las filas importadas salen después de los demás eventos pendientes, así que no demoran despachos ni entregas.

Si borran el borrador en el ERP, TrazFlow no se entera y esa fila no se puede reimportar, porque el envío figura como hecho.

## Verificación

- `npm test`: `src/lib/stock-import/rows.test.ts` y `src/lib/erp/erpnext-import.test.ts`.
- `supabase/tests/ush1_stock_import.sql` (rollback): roles, aislamiento, idempotencia y ambos modos.
- `npx playwright test --config playwright.stock-import.config.ts`: flujo completo sin ERP, incluidas 5.000 filas. Limpia sus datos al terminar.
- `npx playwright test --config playwright.stock-import-erp.config.ts`: flujo completo con el ERP simulado (`mock`), hasta el envío. Ninguna prueba usa un ERPNext real.
