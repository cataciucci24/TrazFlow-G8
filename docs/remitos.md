# Remito digital y pallets mixtos

TRZ-51 y TRZ-57 vienen del PR #86 de Juani, originalmente integrado en main.
La integración con #87 conserva los ítems de Nai y la línea de tiempo unificada.

## Uso

Logística y Depósito abren el detalle de una orden despachada y eligen su remito.
Se puede imprimir o guardar con la impresión PDF del navegador. El QR apunta al
detalle autenticado de la orden; no concede acceso público a destinatarios.
Es una constancia operativa, sin CAI/CAE ni validez fiscal.

Al confirmar el despacho, el trigger emite un único número correlativo por empresa
y guarda emisor, destinatario, orden, responsable, chofer e ítems. El contenido
sale del snapshot `order_pallets.expected_items`, no de las columnas escalares
del pallet. Así un mixto incluye todas sus líneas y un reingreso no cambia el
contenido de un despacho anterior. Los totales se separan por unidad y el número
de pallets cuenta cada QR una vez. El remito emitido no se edita.

## Migración y estado remoto comprobado

El 23/11/2026 se consultó Supabase, sin modificaciones: la versión
`20261122100000` está aplicada con nombre `pallet_contents`; también están aplicadas
las otras cuatro migraciones de pallets. `public.dispatch_notes` no existe allí.
Esto coincide con la comprobación de Cata.

El archivo de remitos de main tenía la misma versión que pallet_contents y nunca
se había aplicado. Solo ese archivo se renumeró a
`20261123100000_trz51_dispatch_notes.sql`. No se alteró ninguna migración aplicada
ni el historial remoto. La nueva versión se probó en Supabase local y hace backfill
de órdenes despachadas; la aplicación en la base compartida queda para el despliegue
coordinado por Cata. No ejecutar los fixtures de demo ni migration repair para esto.

`npm run check:migrations` evita nuevas colisiones de versiones y corre en CI.
`npm run test:sql` verifica, dentro de `trz111_mixed_pallets_and_return.sql`, que el
remito incluye ambos ítems, no se duplica, no se modifica y respeta empresa y rol.
