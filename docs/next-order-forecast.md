# TRZ-109 — Próximos pedidos

Pantalla `/dashboard/next-orders`, disponible en el menú de logística. Lee la base
Supabase configurada en `.env.local`; no requiere migraciones ni genera pedidos.
Depósito y chofer no acceden a la página ni a su consulta del servidor.

## Cálculo

- Cliente = destinatario (`distributors`) de la empresa del usuario.
- Se usan órdenes con `confirmed_at` real, no futura, y estado `confirmed`,
  `delivered` o `delivered_with_discrepancy`. Los borradores no cuentan.
- Con menos de 3 despachos: «Historial insuficiente». Incluye clientes sin órdenes.
- Se convierten las confirmaciones al día argentino. Se calculan los intervalos
  entre despachos consecutivos; su promedio se suma al último despacho, redondeado
  al día más cercano y con un mínimo de un día. Varias órdenes el mismo día
  cuentan como despachos distintos con intervalo cero.
- Rango orientativo: último despacho + (promedio ± desvío estándar poblacional de
  los intervalos); el extremo inferior se redondea hacia abajo y el superior hacia
  arriba, ambos con un mínimo de un día después del último despacho. No representa
  un intervalo de confianza ni una fecha comprometida.
- Si la fecha central quedó antes de hoy, se marca como superada. No se desplaza
  la predicción al futuro ni se confunde con un atraso de una orden real.
- Orden: fecha estimada ascendente; sin historial al final, por nombre e id.

## Productos

Se suman los pallets esperados de cada producto en cada orden confirmada antes de
promediar. Se muestran los 3 productos presentes en más despachos; desempate por
SKU e id. Se informa en cuántos despachos apareció cada producto y su unidad.
El promedio es por pedido **que contiene el producto**, no por pallet. Un pedido
con alguna cantidad desconocida de ese producto no entra al promedio y se indica
cuántos pedidos tienen cantidad completa. El producto sí cuenta para frecuencia.

## Acceso y volumen

La página y la consulta verifican la sesión activa y el rol de logística.
Todas las fuentes se filtran por empresa, además de las policies RLS existentes.
Las tres consultas se ejecutan en paralelo y paginan con orden estable, en bloques
de 500 filas, para no perder historia por el límite de PostgREST. No se solicita
información personal ni se usan claves administrativas en la app.

## Verificación

```sh
npm test
npx tsc --noEmit
npx playwright test --config playwright.forecast.config.ts
npx supabase db query --linked --file supabase/tests/trz109_cloud_state_checks.sql
```

Playwright usa fixtures aislados y comprueba pantalla móvil, acceso de depósito y
recuperación de errores. La última verificación es de solo lectura y comprueba
contra la base compartida que logística puede leer órdenes y productos con RLS.

Para probar con datos reales, ejecutar `npm run dev`, iniciar sesión como logística
y abrir **Próximos pedidos**. Con 3 despachos confirmados aparece una estimación;
los clientes con 0, 1 o 2 muestran historial insuficiente. No hace falta confirmar
ningún despacho para consultar la pantalla.
