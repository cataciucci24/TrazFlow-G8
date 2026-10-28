# TRZ-106 — Ficha al escanear pallets

La validación de carga muestra la ficha después de procesar el QR. El chofer
la ve antes de elegir el resultado de la entrega y después de confirmarlo.
Ubicaciones la muestra al seleccionar o escanear un pallet y la vuelve a consultar
al cambiar la ubicación. La consulta no registra movimientos.

Incluye producto/SKU, lote, cantidad real y unidad, ubicación actual y última
acción de `traceability_events` (fecha descendente, desempate por id). La persona
sale de `users`: solo nombre y rol actuales de la misma empresa. Si el perfil
ya no está disponible, la acción se conserva con una indicación de persona no
disponible. Sin eventos se muestra «Sin movimientos registrados».

La ubicación física usa `current_location_id` → `warehouse_locations`. Cuando el
pallet dejó el depósito, usa `current_location`, por ejemplo «En tránsito».

## Base de datos

Aplicar `20261028140000_trz106_pallet_scan_details.sql` antes de usar la ficha.
La función `get_pallet_scan_details` tiene una proyección limitada y controles
explícitos de usuario activo y empresa. Logística y depósito consultan su empresa;
un chofer solo consulta pallets de sus órdenes asignadas. No modifica las policies
de las tablas ni permite consultar emails o el JSON del evento.

Prueba de integración sobre una base **local** ya migrada:

```sh
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/trz106_pallet_scan_details.sql
```

El script revierte sus fixtures. Los tests de Node cubren la respuesta pública,
autenticación, códigos inválidos, estados vacíos, errores y respuestas tardías.
Playwright verifica el QR de entrega, la ficha previa y su actualización posterior
con el servidor de fixtures (no reemplaza las pruebas SQL).
