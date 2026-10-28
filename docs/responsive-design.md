# Diseño compartido y uso en celular

Base: `develop`. Antes de implementar se revisaron las referencias remotas de
`feature/sidebar-responsive` (`44c48ea`) y `fix/usabilidad` (`d4bdbd9`), ambas ya
integradas. Se conserva su navegación modal, restauración de foco, filtros,
menús de acciones, estados pendientes y avisos.

## Componentes y tamaños

- `design-system.tsx`: encabezados, superficies, botones, badges, alertas y tablas;
  `OperationCard` y `OperationProgress` comparten la presentación de depósito y chofer.
- `ScanButton`: un solo botón y un solo handler. En escritorio se presenta como
  panel de cámara; hasta 767 px queda al pie de la pantalla. Confirmar despacho
  ocupa el siguiente lugar, sin superponerse. Se reserva espacio al final del
  contenido y se respeta el área segura del dispositivo.
- Hasta 767 px, `TableShell` con `mobileLayout="rows"` presenta cada fila como
  tarjeta, con sus etiquetas, datos y acciones. Desde 768 px mantiene la tabla.
  Se conservan sus roles accesibles y no se duplican formularios o controles.
- Hasta 1023 px la navegación usa el menú modal existente; en escritorio aparece
  la barra lateral. Se cierra al navegar, con Escape y al pasar a escritorio.
- En celular, botones y controles tienen al menos 44 px de alto, los campos
  usan texto de 16 px y los diálogos ubican las acciones junto al borde inferior.

## Verificación

`npm test`, `npm run test:unit`, `npm run lint`, `npx tsc --noEmit` y
`npm run test:e2e`.

Las pruebas de navegador usan exclusivamente el servicio local de fixtures y
`ERP_PROVIDER=mock`, con fuentes locales solo durante las pruebas. Cubren logística a 320, 390, 768 y 1280 px (inicio,
Órdenes, Pallets e Integración ERP), menú, filtros, campos visibles, ausencia de
desbordamiento y validación manual de depósito. El flujo del chofer decodifica
un QR real con cámara sintética, confirma la entrega y comprueba su cierre tanto
en escritorio como en celular. Las capturas se guardan en `test-results/`.

El cambio afecta la presentación: no modifica Server Actions, consultas, RPCs,
políticas de acceso ni transiciones de estado.

## Segunda pasada de usabilidad

- El menú móvil y su botón de cerrar están del lado de apertura del panel; logística
  cuenta con un enlace explícito a Inicio.
- Los menús de filas muestran «Acciones» en celular y se alinean con el borde del
  botón que tenga espacio, sin salirse de la pantalla; Escape restaura el foco.
- Se incorpora un salto al contenido con teclado y espacio de desplazamiento para
  que la cabecera y los botones fijos no tapen el control enfocado.
- Los códigos QR y emails no usan autocorrección ni mayúsculas automáticas.
- En ERP no se repite el mismo estado dentro de una etiqueta. En la entrega, una
  diferencia se muestra en rojo y no como éxito; el diálogo no se descarta mientras
  se procesa la confirmación.
- Las pruebas usan `.next/e2e` para no interferir con la aplicación local abierta.
