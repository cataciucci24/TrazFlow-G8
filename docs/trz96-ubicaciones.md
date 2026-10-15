# TRZ-96 / US-OPS-06 — Ubicación física de pallets

## Alcance y decisiones

Un depósito por empresa: `DEP-01`, sin administración de múltiples depósitos ni asignaciones de operadores. Cada ubicación guarda empresa, identificador de depósito, código y coordenadas. Para ampliar a múltiples depósitos se podrá reemplazar el identificador fijo por una relación, conservando los UUID de ubicaciones, QR e historial.

- Depósito y Logística pueden crear y consultar ubicaciones. Solo `warehouse_operator` activo registra movimientos; Logística consulta el historial. Choferes no acceden al catálogo.
- Se reutilizan `movements` y `traceability_events`: no se crea `pallet_location_events`.
- `current_location_id` es la referencia actual; FK compuesta impide referencias entre empresas. `current_location` conserva una descripción compatible con inventario y trazabilidad existentes.
- Códigos únicos por empresa, normalizados a mayúsculas desde la aplicación. Coordenadas también únicas. No hay edición ni eliminación de ubicaciones: etiquetas y referencias permanecen estables.
- QR: `TRZLOC:<uuid>`. El lector también acepta el código de ubicación. El catálogo muestra código legible, depósito y coordenadas; permite impresión desde el navegador.
- Pallets existentes no requieren migración de datos ni ERP: su texto histórico se conserva hasta la primera asignación explícita.
- Se admiten `in_warehouse` y `assigned`, estados del flujo existente anteriores al despacho. `in_transit` y estados de entrega se rechazan. El trigger de salida elimina la referencia física activa cuando se confirma el despacho; conserva el texto que escribe el flujo de despacho/entrega y todos los eventos anteriores. No implementa reingresos o devoluciones.
- RPC atómica: bloquea la fila con `FOR UPDATE`, compara la ubicación esperada por el cliente, valida empresa/rol/estado y escribe ubicación, movimiento y evento. Una confirmación obsoleta devuelve conflicto; requiere actualizar la pantalla. Reasignar al mismo lugar no genera eventos.
- Se retira la edición de ubicación libre del formulario general y su privilegio UPDATE directo. Las escrituras normales de lote, cantidad y asociación de órdenes conservan sus columnas autorizadas.

## Instalación

Aplicar, en orden y después de las migraciones existentes:

1. `supabase/migrations/20261015130000_location_event_types.sql`
2. `supabase/migrations/20261015130100_pallet_physical_locations.sql`

La primera migración debe terminar su transacción antes de ejecutar la segunda, porque PostgreSQL requiere confirmar los nuevos valores del enum antes de usarlos. No concatenarlas en una única transacción desde SQL Editor.

No se ejecutaron migraciones ni cambios sobre la base remota. No hay borrado ni backfill de datos. No se agregan dependencias npm. El despliegue necesita estas migraciones antes de servir la nueva pantalla/ficha.

## Archivos

Nuevos:

- `src/app/dashboard/locations/page.tsx`: página autenticada.
- `src/components/locations/locations-panel.tsx`: catálogo, creación, consulta, escaneo y confirmación.
- `src/components/locations/location-qr.tsx`: QR e impresión.
- `src/components/locations/location-history.tsx`: historial cronológico con responsable y horario argentino.
- `src/lib/locations/{types,queries,actions,rules}.ts`: contratos, acceso, acciones y validaciones.
- `src/lib/locations/rules.test.ts`: códigos, lectura y estados.
- Las dos migraciones indicadas y `supabase/tests/trz96_physical_locations.sql`.

Modificados:

- Sidebar: acceso a Ubicaciones para Depósito y Logística.
- Escáner QR: título y descripción opcionales, con valores previos como predeterminados.
- Ficha y página de trazabilidad: historial físico, enlace a ubicación y acceso del operador a la ficha de pallets. La vista de lotes mantiene el permiso de Logística.
- Acciones y formulario general de pallets: ya no cambian la ubicación sin registrar un movimiento.
- Prueba QR existente: incluye codificación y decodificación de una etiqueta de ubicación con ZXing.

## Demostración desde la interfaz

1. Aplicar las migraciones en un entorno de prueba. Usar una empresa con pallets existentes y un operador activo.
2. Como Logística u operador, abrir **Ubicaciones**. Crear `A01` con pasillo `A`, estantería `1`, nivel `1`, posición `1`. Crear `A02` con posición `2`.
3. Abrir **QR / Imprimir** para ver e imprimir la etiqueta. Permitir ventanas emergentes si el navegador las bloquea.
4. Como operador, seleccionar un pallet en depósito, o usar **Escanear pallet** con su etiqueta actual.
5. Seleccionar `A01`, o usar **Escanear ubicación**. Revisar origen/destino y pulsar **Confirmar ubicación**.
6. Comprobar ubicación actual `DEP-01 / A01`. Abrir **Ver ficha e historial**: aparece asignación, usuario y fecha; también aparece en el historial logístico existente.
7. Volver, seleccionar `A02` y confirmar. Deben conservarse ambos movimientos.
8. Como Logística, consultar el mismo pallet. Debe verse el historial y no aparecer confirmación de movimiento.

La cámara requiere localhost o HTTPS y permiso del navegador. La selección manual permite demostrar todo el flujo sin cámara ni ERP.

## Pruebas y casos manuales

Comandos:

```text
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd test
npm.cmd run build
psql -v ON_ERROR_STOP=1 -f supabase/tests/trz96_physical_locations.sql
```

La prueba SQL está diseñada para una base LOCAL con todas las migraciones. Crea fixtures dentro de una transacción y termina en ROLLBACK; ejecutar con detención ante errores. Comprueba empresa, roles, revocación, duplicados, referencias inexistentes, reasignación idéntica, cliente obsoleto, auditoría, prohibición de escritura directa, rollback ante fallo de auditoría y pallet en tránsito. No prueba concurrencia real entre conexiones.

Verificar manualmente:

- Dos empresas pueden tener el mismo código; no pueden leer ni usar las ubicaciones de la otra.
- Código duplicado o coordenadas duplicadas en la misma empresa se rechazan.
- Crear y editar producto/cantidad, asociar/desasociar pallets y validar/despachar siguen funcionando.
- QR antiguo de pallet, QR nuevo de pallet y QR de ubicación se leen correctamente con cámara física.
- Ventana de impresión contiene QR, código y coordenadas legibles y la etiqueta impresa puede escanearse.
- Abrir dos sesiones/pestañas con la misma ubicación actual; confirmar destinos distintos. La segunda confirmación debe fallar por conflicto, conservar el primer destino y no agregar eventos. Pulsar Actualizar datos y reintentar explícitamente.
- Despachar el pallet asignado: queda en tránsito, la posición deja de contarlo y una asignación posterior se rechaza.
- Trasladar un pallet `assigned` antes del despacho mantiene su asociación a la orden.
- Usuario revocado, chofer, rol histórico o anónimo no puede registrar movimientos mediante RPC.
- Historial anterior permanece intacto; un fallo en cualquier inserción revierte también el cambio de ubicación.

## Integración ERP y pendientes

`docs/integracion-erp.md` describe una integración todavía en diseño. TRZ-96 no cambia productos, lotes, stock ni funciones ERP, y funciona sin conexión. Al integrar el outbox, un UPDATE que solo cambia ubicación no debe interpretarse como `pallet.adjusted` (este corresponde a lote/cantidad). Revisar también los permisos de columnas si otra historia agrega campos editables a pallets. El trigger de salida evita reemplazar la RPC de despacho que podría estar siendo modificada por otra historia.

Se inspeccionó el esquema versionado, no el esquema remoto: antes de aplicar, comprobar que el entorno remoto tenga las migraciones previas y no posea cambios manuales equivalentes.

La implementación cubre los diez criterios en código. La aceptación funcional completa queda pendiente de ejecutar las pruebas SQL sobre PostgreSQL migrado y la demostración en navegador, incluida cámara, impresión y concurrencia real. No se afirma validación end-to-end sin esas comprobaciones.

## Verificación ejecutada

- TypeScript (`npx.cmd tsc --noEmit`): aprobado.
- ESLint (`npm.cmd run lint`): aprobado.
- Suite Node: 43 pruebas aprobadas, incluida lectura real del SVG QR de ubicación con ZXing. Las pruebas requirieron ejecutar fuera del sandbox porque Node recibía `spawn EPERM` al crear procesos.
- Compilación Next.js: aprobada con acceso a Google Fonts; el primer intento en sandbox falló por acceso de red a esas fuentes.
- Pruebas SQL: no ejecutadas; Docker y psql no están disponibles en este entorno.
- Navegador autenticado, cámara, impresión y concurrencia entre conexiones: pendientes.

La consulta de pallets incluye el identificador físico junto con el texto en una misma lectura de fila: el identificador esperado enviado al RPC corresponde a la ubicación mostrada. Los archivos `src/lib/pallets/queries.ts` y `src/lib/types.ts` también se modificaron para transportar esa referencia opcional sin alterar los contratos de las consultas históricas de lotes.

## Corrección de permisos de estado (revisión previa a aplicar)

Se corrigieron los delimitadores `$$` de `pg_temp.reject_location_audit`.

La migración de ubicaciones ahora agrega `guard_direct_pallet_status`, un trigger SECURITY INVOKER que conserva los privilegios actuales y rechaza cambios directos de estado cuando el origen o el destino está fuera de `in_warehouse` / `assigned`. El control usa el rol efectivo `current_user`, no el rol del JWT: las RPC SECURITY DEFINER siguen ejecutándose como su propietario y conservan sus validaciones propias. La función del trigger debe permanecer SECURITY INVOKER.

Dependencias inspeccionadas:

| Operación | Escritura actual | Efecto de la corrección |
|---|---|---|
| Alta de pallet | INSERT de Logística, estado inicial en depósito | Sin cambios |
| Editar lote/cantidad o eliminar | No modifica status | Sin cambios |
| Crear orden / asociar pallets | UPDATE directo in_warehouse → assigned | Permitido |
| Compensar asociación fallida al crear orden | UPDATE directo assigned → in_warehouse | Permitido |
| Desasociar | dissociate_pallet_from_order, SECURITY DEFINER | Sin modificar RPC |
| Validar QR | validate_order_pallet, SECURITY DEFINER; actualiza order_pallets, no pallet.status | Sin modificar RPC |
| Despachar | confirm_dispatch_order, SECURITY DEFINER; in_transit | Sin modificar RPC |
| Entregar | confirm_delivery_pallet, SECURITY DEFINER; delivered / delivery_discrepancy | Sin modificar RPC |
| Recepción histórica | receive_order_pallet, SECURITY DEFINER | Sin modificar RPC ni habilitar roles retirados |
| Normalizaciones históricas | Migraciones ejecutadas por el propietario | No son escrituras del cliente |
| Ubicación | assign_pallet_location; no modifica status | Misma autorización por empresa, rol activo y estado físico |

Los usuarios de la API no pueden devolver un pallet en tránsito, entregado o con diferencia a depósito, tampoco pasando primero por assigned. Tampoco pueden simular un despacho o una entrega con UPDATE directo. La corrección no agrega un flujo de devoluciones y no altera las reglas de negocio de otras historias. Las cuentas privilegiadas de administración y las RPC autorizadas mantienen sus capacidades.

La suite SQL incorpora intentos de evasión con operador y Logística sobre los estados actuales y heredados, verifica que no cambien estado, ubicación ni historial, preserva reserva y compensación y prueba ubicación de pallets assigned. También invoca las RPC reales de desasociación, validación, despacho y entrega para detectar regresiones con el trigger instalado. Estas pruebas nuevas siguen pendientes de ejecución en PostgreSQL local.

Solo se modificaron en esta corrección la segunda migración de TRZ-96, su prueba SQL y este documento. No se aplicaron migraciones, no se modificaron RPC compartidas ni código de otras historias. Si la segunda migración ya estuviese aplicada en algún entorno, no debe repetirse: ese entorno necesitaría una migración incremental con el nuevo trigger.

Validación de esta corrección: TypeScript y ESLint aprobados. La suite Node terminó con 43/43 pruebas aprobadas al repetirla; en el intento anterior falló el test QR con `NotFoundException` y UUID aleatorios. Se registra como fallo intermitente pendiente de investigar, no como regresión SQL demostrada. No se modificó ese test ni se eliminó su cobertura. El primer intento dentro del sandbox no pudo crear procesos (spawn EPERM); las ejecuciones efectivas fueron fuera del sandbox. No se ejecutó nuevamente build porque esta corrección solo modifica SQL y documentación. Las nuevas pruebas de seguridad y regresión SQL aún no se ejecutaron: no hay psql ni Docker disponibles.
