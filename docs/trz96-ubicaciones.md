# TRZ-96 / US-OPS-06 — Ubicación física de pallets

## Alcance y decisiones

> **TRZ-101:** ya no hay un único `DEP-01` fijo: los depósitos están en la tabla `warehouses` y cada ubicación pertenece a uno (FK compuesta). Los UUID, QR e historial no cambiaron. Ver la sección "Depósitos" de [`erp-sync.md`](erp-sync.md).

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

1. `supabase/migrations/20261016130000_location_event_types.sql`
2. `supabase/migrations/20261016130100_pallet_physical_locations.sql`

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
| Recepción histórica | RPC eliminada por TRZ-91 | TRZ-96 no la utiliza |
| Normalizaciones históricas | Migraciones ejecutadas por el propietario | No son escrituras del cliente |
| Ubicación | assign_pallet_location; no modifica status | Misma autorización por empresa, rol activo y estado físico |

Los usuarios de la API no pueden devolver un pallet en tránsito, entregado o con diferencia a depósito, tampoco pasando primero por assigned. Tampoco pueden simular un despacho o una entrega con UPDATE directo. La corrección no agrega un flujo de devoluciones y no altera las reglas de negocio de otras historias. Las cuentas privilegiadas de administración y las RPC autorizadas mantienen sus capacidades.

La suite SQL incorpora intentos de evasión con operador y Logística sobre los estados actuales y heredados, verifica que no cambien estado, ubicación ni historial, preserva reserva y compensación y prueba ubicación de pallets assigned. También invoca las RPC reales de desasociación, validación, despacho y entrega para detectar regresiones con el trigger instalado. Estas pruebas nuevas siguen pendientes de ejecución en PostgreSQL local.

Solo se modificaron en esta corrección la segunda migración de TRZ-96, su prueba SQL y este documento. No se aplicaron migraciones, no se modificaron RPC compartidas ni código de otras historias. Si la segunda migración ya estuviese aplicada en algún entorno, no debe repetirse: ese entorno necesitaría una migración incremental con el nuevo trigger.

Validación de esta corrección: TypeScript y ESLint aprobados. La suite Node terminó con 43/43 pruebas aprobadas al repetirla; en el intento anterior falló el test QR con `NotFoundException` y UUID aleatorios. Se registra como fallo intermitente pendiente de investigar, no como regresión SQL demostrada. No se modificó ese test ni se eliminó su cobertura. El primer intento dentro del sandbox no pudo crear procesos (spawn EPERM); las ejecuciones efectivas fueron fuera del sandbox. No se ejecutó nuevamente build porque esta corrección solo modifica SQL y documentación. Las nuevas pruebas de seguridad y regresión SQL aún no se ejecutaron: no hay psql ni Docker disponibles.


## Revisión después del merge de TRZ-91 (16/10/2026)

La rama incorpora la migración `20261016120000_drop_distributor_operator_role.sql` y los controles de perfiles desconocidos de TRZ-91. Las acciones y consultas de ubicaciones usan `requireUserProfile`, que rechaza perfiles revocados o con roles desconocidos. Los SQL y fixtures de TRZ-96 solo utilizan los tres roles vigentes; no dependen de las funciones antiguas eliminadas por TRZ-91. La protección de estados y las RPC compartidas se conservan.

Se renombraron exclusivamente las dos migraciones pendientes de TRZ-96, sin cambiar su contenido SQL. El orden local queda:

1. `20261016120000_drop_distributor_operator_role.sql` (TRZ-91).
2. `20261016130000_location_event_types.sql` (TRZ-96, enum).
3. `20261016130100_pallet_physical_locations.sql` (TRZ-96, catálogo y operaciones).

La última inspección remota mostró TRZ-91 aplicada y TRZ-96 pendiente. Esta revisión posterior al merge es únicamente local: antes de aplicar, el responsable debe confirmar que nadie haya aplicado entretanto las versiones antiguas de TRZ-96. Si alguna ya estuviera registrada o sus objetos existieran, detenerse y conciliar con el equipo; no ejecutar nuevamente el CREATE ni reparar automáticamente el historial. Los nombres anteriores de TRZ-96 quedan sustituidos por los indicados arriba y no deben aplicarse desde copias antiguas de la rama.

El cambio permite mantener un orden creciente sin forzar migraciones anteriores a la última aplicada. La migración del enum debe confirmar su transacción antes de comenzar la siguiente. No se ejecutaron comandos de Supabase ni se cambió su configuración.

Pendiente antes de dar aceptación: ejecutar las migraciones en un entorno separado con TRZ-91, correr `supabase/tests/trz96_physical_locations.sql`, verificar RLS con dos empresas y varios roles, rollback atómico, concurrencia real y regresiones de asociación/desasociación, validación, despacho y entrega. La suite SQL no debe ejecutarse en la base compartida porque crea fixtures y triggers temporales de prueba, aunque finalmente revierta la transacción. Luego coordinar la aplicación y el código actualizado: el formulario anterior que escribe ubicación libre dejará de tener permiso.

Verificación local posterior al merge: `npx.cmd tsc --noEmit` y `npm.cmd run lint` aprobados. `npm.cmd test`, ejecutado fuera del sandbox tras `spawn EPERM`, dio 46 aprobados y 1 fallido de 47: el test QR con UUID aleatorios falló con `ChecksumException`. Las pruebas de perfiles y roles de TRZ-91 aprobaron. Se conserva el fallo intermitente QR como pendiente; no se alteró la prueba ni la implementación QR para obtener un resultado verde. Los hashes de ambos SQL antes y después del renombrado son idénticos. No se ejecutaron pruebas SQL ni build en esta revisión.

## Investigación del fallo QR y corrección del test

Se reprodujo de forma determinista `ChecksumException` con `PAL-43fc61dc-3737-41df-ae95-0579597726e4`, a 260 y 280 px. El SVG y su rasterización son correctos: el detector geométrico de ZXing selecciona un patrón interno como finder point, en vez de la esquina superior derecha, y entrega una matriz equivocada al decodificador. No es un checksum incorrecto en el QR generado. También se reprodujeron NotFoundException y FormatException según el contenido.

En un diagnóstico reproducible de 1.000 payloads con semilla 96, el camino de detección geométrica falló 62 veces; el mismo bitmap leído como QR aislado con PURE_BARCODE recuperó el contenido exacto en los 1.000 casos. No se modificaron dependencias ni código de generación, impresión o cámara.

La corrección se limita a `src/components/pallets/pallet-qr.test.ts`: fixtures deterministas que incluyen los fallos encontrados, los dos tamaños usados por las etiquetas (260 y 280 px) y PURE_BARCODE para estas imágenes sintéticas aisladas y sin perspectiva. Se mantiene la rasterización del SVG real y la comprobación del contenido mediante el decodificador y su corrección de errores; no se capturan ni ignoran errores para hacer pasar la prueba. El nombre del test ahora describe generación/codificación, no una prueba de cámara.

El escáner conserva la detección normal y sus intentos sucesivos: PURE_BARCODE no corresponde a frames reales con fondo o perspectiva. La lectura con cámara física sigue pendiente de validación manual; esta corrección no garantiza detección en cada frame ni elimina las limitaciones del detector de la dependencia.

Resultado de la corrección QR: suite completa con 47/47 pruebas aprobadas, TypeScript sin errores y ESLint aprobado. La ejecución de la suite requirió salir del sandbox por spawn EPERM. No se ejecutaron comandos de Supabase ni se cambiaron migraciones en esta investigación.

## Corrección de fixtures SQL: unidad de medida del producto

La primera ejecución de la suite en el proyecto aislado falló con SQLSTATE 23502 al insertar Product A. La migración `20261006140000_product_unit_of_measure.sql` hace obligatoria `products.unit_of_measure`, sin asignar un DEFAULT para nuevas filas. Su backfill de productos existentes no sustituye el valor requerido en INSERT posteriores.

Se corrigió únicamente el INSERT de los dos productos sintéticos para proporcionar `unit_of_measure = 'unidades'`, uno de los valores permitidos. No se modificaron el esquema, las migraciones ni las aserciones de seguridad.

Revisión estática de los demás fixtures contra las migraciones del repositorio:

- Empresas: id y nombre presentes; umbrales de vencimiento con defaults 30/60/90.
- Perfiles: id, empresa, nombre, correo y rol presentes; usuarios auth sintéticos creados antes.
- Lotes: producto, número de lote y cantidad obligatorios presentes.
- Pallets: empresa y lote presentes; QR generado por default; quantity admite NULL según el esquema vigente y no requiere una unidad propia.
- Ubicaciones: empresa, código y coordenadas presentes; depósito e identificadores omitidos en algunas inserciones tienen default.
- Destinatario, orden y asociación: referencias presentes, fecha estimada explícita, chofer sintético asignado y flags de asociación con defaults válidos.
- Movimientos y eventos: sus INSERT siguen en las RPC existentes; no se alteraron sus campos ni reglas para adaptar el test.

No se encontraron otras omisiones de campos obligatorios en los fixtures revisados. Es una comprobación estática, no una ejecución SQL: queda pendiente volver a correr la suite completa en el proyecto aislado.

Para repetir desde SQL Editor: verificar el proyecto `trazflow-trz96-test` y el rol postgres, ejecutar ROLLBACK si la sesión indica transacción abortada, comprobar ausencia de los UUID/correos sintéticos, reemplazar todo el texto anterior del editor por esta versión actualizada de la suite y ejecutar el bloque completo desde BEGIN hasta ROLLBACK. No reanudar a partir del INSERT fallido. Se puede agregar después de ROLLBACK un SELECT de resultado como marcador de finalización. Solo dar por aprobada si no hay errores y se alcanza ese marcador; luego comprobar que no queden usuarios, empresas, pallets, ubicaciones ni el trigger trz96_test_reject de prueba. Si se usa la copia temporal del repositorio, también debe actualizarse este archivo de test en esa copia; no hace falta reaplicar migraciones.

## Revisión final de UX y técnica previa al PR

Estado informado por el equipo: las migraciones de TRZ-96 ya están aplicadas en la base compartida y se probaron manualmente catálogo, QR e impresión, cámara, asignaciones, reubicaciones, historial y bloqueo del chofer en un proyecto aislado. En esta revisión no se consultó ni se modificó ninguna base; tampoco se cambiaron las migraciones ya aplicadas, archivos .env o configuración Supabase.

### Mejoras de UX

- Éxitos inline con el componente InlineAlert existente y duración de cuatro segundos, independiente por formulario. Una respuesta nueva, incluso con texto idéntico, reinicia el plazo. El hook cancela timers al reemplazar mensajes o desmontarse y descarta respuestas tardías.
- Errores persistentes hasta editar, volver a escanear, actualizar o iniciar otra operación. Los errores de negocio de la RPC se conservan; los diagnósticos técnicos de permisos, restricciones y referencias se traducen a mensajes comprensibles.
- El formulario de movimiento usa el patrón onSubmit + useTransition de los formularios existentes. Se evita el reset automático de React sobre form action, manteniendo pallet y destino seleccionados. La revalidación existente trae en la misma respuesta la ubicación actual y su identificador; no se introduce una ubicación optimista que oculte conflictos.
- Después de confirmar, el destino coincide con la ubicación actual y se explica «El pallet ya se encuentra en esta ubicación». El botón sigue deshabilitado y el handler también rechaza un submit forzado de ese mismo destino. La RPC conserva su propia validación.
- El alta conserva sus entradas si hay error y las reinicia únicamente tras éxito. Un error de transporte al confirmar un movimiento invita a actualizar antes de reintentar, porque no demuestra que la transacción no se haya completado.
- No se cambió el plazo de ocho segundos de las notificaciones globales de otras pantallas; la duración solicitada se limita a Ubicaciones.

### Hallazgo crítico pendiente: retorno a depósito mediante desasociación

Encontrado por lectura de las políticas y funciones versionadas; no se reprodujo contra ninguna base. Es una ruta heredada, no una regresión introducida por la UX:

1. La policy order_pallets_insert_manager (20260831235900_add_pallet_validation.sql) permite a Logística insertar una relación para un pallet y una orden de su empresa sin comprobar el estado actual del pallet.
2. dissociate_pallet_from_order (20261006120000_log_pallet_dissociation.sql) exige orden draft y relación sin validación, pero no verifica que el pallet siga assigned antes de ponerlo in_warehouse.
3. Un manager puede enlazar por API un pallet entregado o en tránsito a una orden draft y desasociarlo mediante esa RPC. El trigger guard_direct_pallet_status no bloquea ese cambio porque la RPC es SECURITY DEFINER. Posteriormente, un operador de la misma empresa podría asignarle ubicación.

Recomendación antes de aprobar el PR: una migración NUEVA, posterior a las ya aplicadas, que bloquee y verifique el pallet dentro de dissociate_pallet_from_order antes de borrar la relación o actualizarlo. Si no está assigned, devolver not_removable sin modificar datos. Evaluar además restringir el INSERT de order_pallets a pallets assigned, conservando el orden de reserva → asociación de las Server Actions existentes. Agregar regresiones SQL para tránsito, entrega y desasociación legítima. No se escribió ni aplicó esta corrección porque implica una RPC compartida y una migración adicional; no editar la migración histórica de TRZ-96.

### Alcance de la revisión y límites

Se contrastó el diff completo respecto de origin/develop disponible localmente. Los controles de empresa/rol en página, acciones, consultas, RLS y RPC siguen presentes; los helpers rechazan perfiles revocados y roles desconocidos de TRZ-91. La FK compuesta conserva empresa entre pallet y ubicación. El RPC mantiene FOR UPDATE, ubicación esperada y las tres escrituras en una transacción. Los eventos conservan autor, fecha y snapshots, con protección de inmutabilidad y falsificación. No se alteraron validaciones ni tipos de evento en esta mejora.

Stock y alertas conservan cantidades y unidades; el agrupamiento por ubicación admite los códigos DEP-01 / código porque usa texto genérico. Reserva y compensación siguen usando in_warehouse ↔ assigned, y despacho/entrega conservan sus RPC y el trigger que limpia la ubicación física activa. El escáner mantiene sus valores predeterminados y su lectura de pallets; solo acepta textos de modal opcionales desde TRZ-96.

Límites menores ya existentes: no hay prueba de dos conexiones concurrentes reales; el historial usa fecha y UUID para desempatar y no prueba orden estricto de varios eventos en una misma transacción; los tests de componentes usan el harness de hooks/JSX del proyecto, no un navegador. Debe repetirse un smoke test manual de selección, mensajes y revalidación tras estos cambios. La suite SQL y las políticas no se ejecutaron en esta revisión.

Estado recomendado: UX preparada para revisión, pero no recomendar aprobación/merge como historia completamente cerrada hasta resolver el hallazgo crítico o acordar explícitamente su tratamiento con el equipo.

Validación local de las mejoras finales: TypeScript y ESLint aprobados; suite completa Node con 54/54 pruebas aprobadas (incluye siete pruebas nuevas de selección, duplicados, feedback, timers y errores). El primer intento en sandbox no pudo crear procesos de Node y se repitió fuera del sandbox. Los tests de componentes no reemplazan la prueba manual en navegador. No se ejecutó SQL, no se hizo build ni se agregaron dependencias. No se realizaron commits, push o PR.
