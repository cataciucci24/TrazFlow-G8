# Pallets mixtos y reingreso: cobertura local de persona 1

Esta ampliación prueba la interfaz vigente de persona 3 con órdenes manuales. No cambia sus componentes, acciones, RPC ni migraciones y no habilita el contrato ERP de pallets mixtos.

## Ejecutar

```sh
npm ci
npx playwright install chromium
npm run test:e2e:pallets
```

Playwright inicia Next en `127.0.0.1:3100` y el servidor HTTP de fixtures en `127.0.0.1:54329`. Los dos puertos deben estar libres. El proyecto `pallets-manual` desactiva el ERP y apunta explícitamente al servidor local. No requiere Docker, acceso a Supabase remoto ni seeds. Cada recorrido reinicia su estado y se ejecuta con un solo worker.

El comando habitual `npm run test:e2e` conserva sus escenarios anteriores y excluye esta suite: las pruebas de órdenes manuales necesitan otro modo de configuración del servidor. `npx playwright show-report` abre el informe de la última ejecución; ante una falla se guardan captura, video y trace en `test-results/`.

## Qué comprueban los dos recorridos

- Logística arma un pallet con arroz (10 cajas) y queso (2,5 kilogramos), dos productos/lotes y un solo QR. Un lote ya elegido no se puede repetir en el otro selector.
- La orden se crea desde el formulario manual y se le asigna un chofer desde la interfaz.
- Depósito detecta cantidades distintas, SKU desconocido, lote incorrecto, faltante y sobrante. Cada diferencia deja el pallet sin validar y bloquea el despacho. La corrección de los dos ítems permite confirmar y pasar a tránsito.
- El lector ZXing real decodifica una cámara sintética. Recepción presenta los dos ítems esperados y permite confirmar su contenido exacto o registrar una diferencia de cantidad. La diferencia se conserva como `content_mismatch`, junto con esperado y detectado.
- El chofer no accede a la pantalla de reingreso. Logística necesita un motivo no vacío; no se envía la RPC con motivo vacío o compuesto solo de espacios.
- El reingreso devuelve el pallet completo a depósito, conserva ambos contenidos, la recepción y los eventos anteriores, y registra el motivo y la orden de origen. Reintentar no agrega eventos.
- El mismo QR se selecciona para una segunda orden. La primera conserva su snapshot y recepción; la nueva relación comienza sin validación ni recepción. La trazabilidad sigue mostrando despacho, recepción, entrega y reingreso.

## Correspondencia con la implementación real

El router `scripts/e2e-pallets-scenario.mjs` se activa exclusivamente con `TRAZFLOW_PALLETS_MANUAL=1` dentro de `scripts/e2e-supabase.mjs`. No forma parte del código de producción. Usa filas de `pallet_contents` que consume `src/lib/pallets/contents.ts`, y snapshots por relación `order_pallets`, sin deducir el contenido mixto desde los campos heredados del pallet.

| RPC | Parámetros del recorrido | Respuesta |
| --- | --- | --- |
| `create_pallet_with_items` | `p_items: [{batch_id, quantity}]`, `p_warehouse_code` | Filas `{pallet_id, qr_code}`; los errores de entrada son errores HTTP/PostgREST, no un `outcome` inventado. |
| `validate_order_pallet_items` | `p_order_id`, `p_qr_code`, `p_items: [{productSku, batchNumber, quantity}]` | Resultado con `validated_at`; una diferencia devuelve `content_mismatch` e invalida el escaneo. |
| `confirm_delivery_pallet_items` | Los anteriores y `p_discrepancy_type` | Resultado con `registered_at`. La RPC devuelve `delivered` cuando registra una recepción con diferencias; la relación guarda `delivery_outcome: content_mismatch`. |
| `return_pallet_to_warehouse` | `p_qr_code`, `p_reason` | Filas `{outcome, pallet_id, qr_code}`; `returned` o `already_in_warehouse` en los casos exitosos. |

También se modelan la reserva/asociación manual, `assign_order_driver`, `confirm_dispatch_order`, la consulta de recepción por ítem, los movimientos y los eventos de trazabilidad. Los endpoints `/test/pallets/reset` y `/test/pallets/state` son controles de la prueba: las operaciones del recorrido se realizan mediante la interfaz, no invocando directamente las Server Actions.

Los tests Vitest de `tests/unit/pallets-fixture.test.ts` verifican rechazos sin altas parciales, filtros, reinicio, roles, motivo y estados inválidos del fixture.

## Límites y pruebas SQL

El escenario HTTP es deliberadamente pequeño: un pallet, dos lotes locales, dos órdenes y usuarios de prueba. No implementa PostgreSQL, transacciones, concurrencia, RLS, aislamiento entre empresas, disponibilidad ERP ni límites de stock. No constituye una prueba de seguridad de la base. Los catálogos y snapshots están acotados al recorrido; no es un reemplazo general de Supabase.

Las pruebas SQL reales siguen siendo necesarias. Con Docker y el stack Supabase **local** iniciado:

```sh
npm run test:sql
```

Ese comando ejecuta las suites SQL con rollback en el contenedor local, incluida `supabase/tests/trz111_mixed_pallets_and_return.sql`. No usar `db push --linked` ni cargar seeds en la base compartida para ejecutar esta cobertura.

La línea de tiempo actual muestra el evento de retorno con el texto técnico `pallet_returned`. La prueba comprueba su presencia y conservación; mejorar ese rótulo corresponde a una corrección funcional coordinada con quienes mantienen trazabilidad/reingreso.
