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

Verificación remota con registros existentes, sin insertar ni modificar datos:

```sh
npx supabase db query --linked --file supabase/tests/trz106_cloud_state_checks.sql
```

## Prueba manual con la base del proyecto

1. Ejecutar `npm run dev` y entrar a `http://localhost:3000` con un usuario operativo.
2. Como logística o depósito, abrir **Ubicaciones** y seleccionar un pallet.
   Debe aparecer su ficha con producto, lote, cantidad, ubicación y última acción.
   Seleccionar o consultar la ficha no registra movimientos.
3. Como depósito, usar **Escanear pallet** en esa pantalla. Al leer su QR debe
   seleccionar el pallet y mostrar la misma ficha. Se puede usar otro dispositivo
   para mostrar la etiqueta; un celular conectado por HTTP a la IP de la PC puede
   bloquear la cámara (usar localhost o un entorno HTTPS).
4. Como depósito, abrir una orden pendiente en **Confirmar despacho** e ingresar
   su código en el campo manual. Luego de validar, la última acción debe indicar
   «Validación de carga», con el nombre del operador y la fecha. Esta prueba sí
   valida un pallet real de esa orden: elegir una orden destinada a pruebas.
5. Como chofer asignado a una orden en tránsito, abrir **Mis entregas** y escanear
   un pallet. La ficha debe verse antes de confirmar. Cerrar el diálogo permite
   consultar sin registrar la entrega; confirmar «Entregado» sí modifica la orden
   real y actualiza la última acción de la ficha.

La migración está en la base compartida. El front de esta rama se prueba localmente;
la web desplegada recibe estos cambios cuando se despliegue la rama correspondiente.
