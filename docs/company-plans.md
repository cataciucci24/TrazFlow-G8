# Cuenta y plan de la empresa

Ruta: `/dashboard/account`. Se abre desde el bloque «Tu cuenta» del pie de la
barra lateral o del menú móvil. Cerrar sesión mantiene su acción independiente.
Ambos accesos permanecen al pie del menú; la lista de navegación se desplaza
independientemente cuando no entra completa en la pantalla.

Las historias permiten consultar y comparar el catálogo y seleccionar un plan
provisionalmente, con el diseño compartido de la aplicación. Logística actúa como el rol administrativo existente; depósito
y chofer conservan su navegación y no acceden al catálogo comercial.

## Fuente de datos

- `subscription_plans`: catálogo ordenado, precios enteros en centavos de USD,
  límites de operadores y pallets por mes, impresoras y equipamiento.
- `company_plans`: una asignación por empresa, enlazada por su `company_id`.
  La ausencia de fila significa «Sin plan asignado». No se asigna un plan al
  crear empresas o usuarios.
- `NULL` en límites significa ilimitado; en precios, cotización a medida.
  La cantidad de impresoras nula se muestra como «No especificado»; cero en
  precios se conserva como cero. La moneda se toma del catálogo (actualmente USD).
- El esquema no tiene un indicador de activo: todos los registros del catálogo
  están publicados. No existe un costo adicional de equipamiento separado del
  precio de equipamiento; no se infiere ni se agrega una condición comercial.
- Se cargó la propuesta proporcionada: Starter US$69/mes, 3 operadores y 500
  pallets/mes; Growth US$269/mes, 10 operadores y 3.000 pallets/mes; Enterprise
  a medida, sin límites. Los tres están marcados como preliminares.
- El equipamiento figura separado: 1 Zebra ZQ320 por US$450 para Starter,
  3 por US$1.350 para Growth y cotización a medida para Enterprise.
  Los consumibles se informan como facturación separada según uso.

No se infiere una contratación desde una visita o un botón. La historia no
implementa cobros, cambios de suscripción ni bloqueo de operaciones por cuotas.
Una asignación real se registra mediante un proceso administrativo confiable,
con privilegios de servidor, cuando corresponda comercialmente.

## Acceso y fallos

Las tablas tienen RLS y solo conceden lectura a usuarios de logística activos.
Las asignaciones se restringen a la propia empresa. Las sesiones autenticadas
no pueden editar el catálogo ni cambiar la asignación. Anónimos no tienen acceso.
El rol se verifica también en la página, antes de cargar datos comerciales.

Una falla de lectura muestra «Plan no disponible» y un aviso para reintentar;
nunca se presenta como «Sin plan asignado» ni se inventa un catálogo local.
La consulta del plan se comparte entre layout y página mediante `React.cache`.

## Verificación

- `npm test`: formato monetario, límites, estados de asignación y errores de lectura.
- `supabase/tests/company_plan_catalog.sql`: aislamiento entre empresas,
  restricciones de escritura, acceso revocado y datos de la propuesta. Usa rollback.
- `npm run test:e2e -- tests/e2e/company-plans.spec.ts`: acceso desde el menú,
  comparación en celular y escritorio, plan asignado, catálogo no disponible y
  rechazo del rol chofer. Las asignaciones de esta prueba son solo fixtures locales.

La cobertura E2E incluye 390, 768 y 1280 px, un catálogo variable, precios cero,
impresoras no especificadas, catálogo vacío y ausencia de confirmación y pagos.
La carga utiliza el `loading.tsx` compartido del dashboard.


## US34 — Selección provisional

Solo logística con sesión y perfil operativo puede acceder a `/dashboard/account`
e iniciar la selección. Se reutilizan `PlanComparison`, las consultas de US33 y
sus políticas RLS; la empresa siempre se obtiene del perfil autenticado.

Cada tarjeta tiene un botón con `aria-pressed`. Una única tarjeta muestra
«Selección provisional», con fondo celeste y un aviso accesible. El plan asignado
conserva «Tu plan actual» y su botón está deshabilitado para evitar volver a
contratarlo. Si no se puede leer la asignación actual, la comparación sigue
visible pero se deshabilita la selección hasta poder verificarla.

La URL conserva exclusivamente `selectedPlan=<code>`. `pushState`, integrado con
`useSearchParams` en Next.js, actualiza la selección sin recargar ni repetir las
consultas. Atrás/adelante recuperan las selecciones anteriores. Recargar conserva
el código, pero vuelve a contrastarlo con el catálogo consultado. Quitar la
selección elimina ese parámetro. Una navegación que no conserve el parámetro
pierde la selección; no hay almacenamiento local, cookies de selección ni
persistencia en Supabase. La URL no vincula una selección a una empresa ni
representa una autorización comercial.

`getProvisionalPlan` en `src/lib/plans/types.ts` resuelve el código contra el
catálogo, devuelve el registro comercial y rechaza códigos inexistentes,
parámetros repetidos o el plan actual. No se confía en precios enviados por el
navegador. Si el catálogo deja de contener un código, se muestra un aviso sin
selección activa; si falla la consulta, no se ofrece una selección utilizable.

## US35 — Revisión antes de contratar

Cuando hay una selección válida, «Ver resumen del plan» abre
`/dashboard/account/review?selectedPlan=<code>`. Solo se transporta el código;
no se envían precios ni identificadores de empresa. El enlace no precarga la
revisión: esta consulta el catálogo al ingresar.

La página es un Server Component. Exige `requireUserProfile` y el rol
`logistics_manager` antes de consultar el catálogo y la asignación de la empresa
obtenida del perfil. Reutiliza `getPlanCatalog`, `getCompanyPlan` y
`getProvisionalPlan`; `React.cache` comparte la lectura de la asignación con el
layout dentro de cada request. Los parámetros repetidos, ausentes, vacíos,
inexistentes y el plan ya asignado no habilitan un resumen. Si falla la lectura
del catálogo o del plan actual se muestra un aviso y se bloquea la revisión.

El resumen muestra el precio y moneda vigentes, límites, equipamiento y aviso de
propuesta preliminar cuando corresponde. Reutiliza los formatos y
`PlanEquipment` de US33. Los valores nulos y cero mantienen su significado. No
se agregan impuestos, descuentos ni costos adicionales que el modelo no define.

«Volver a comparar planes» conserva `selectedPlan` cuando es válido y lleva a
`#planes`. Se puede elegir otro plan y volver a revisar. Los estados inválidos o
de error ofrecen volver sin una selección confirmada. Recargar la revisión
consulta otra vez los datos actuales: una selección que deja de existir o pasa
a ser el plan actual queda bloqueada.

### Confirmación pendiente de definición comercial

No existe una regla documentada de confirmación o contratación. El resumen
informa que el plan todavía no fue contratado y que activarlo requiere un paso
posterior aún no disponible. No hay botón de confirmación, activación ficticia,
Server Actions, escrituras en `company_plans`, suscripciones, facturas ni pagos.
Una historia posterior deberá definir las reglas comerciales y permisos de
confirmación antes de incorporar cualquier operación persistente.

Las pruebas de US34 amplían las de US33: teclado, selección única, reemplazo,
recarga, historial, plan actual no seleccionable, parámetros inválidos, acceso de
chofer/depósito/sin sesión, fallos de asignación y ausencia de mutaciones de planes
en el servidor local de fixtures. El test SQL de RLS conserva su rollback.

Las pruebas de US35 verifican navegación al resumen y regreso con selección,
cambio de plan, datos vigentes tras modificar el catálogo de fixtures, códigos
inválidos/repetidos/ausentes, plan eliminado, errores de ambas consultas, acceso
por roles y sin sesión, ausencia de escrituras y revisión a 390/768/1280 px.


## TRZ-43 y TRZ-46 — Avisos de consumo (reglas MVP pendientes de validación del equipo)

Se cuentan operadores activos de depósito y chofer; logística, revocados y solicitudes quedan fuera. Cada alta de pallet consume una unidad durante el mes calendario de Argentina, sin importar estado o cantidad de mercadería. El registro `plan_pallet_registrations` sobrevive a la eliminación del pallet. La migración carga solamente pallets existentes: los eliminados previamente no se inventan. El mes de transición se muestra como mínimo conocido hasta comenzar un mes completo de seguimiento.

`get_company_plan_usage()` obtiene empresa y permisos desde la sesión, sin parámetros del navegador. Las tablas internas no admiten acceso directo autenticado. Cuenta y resumen reutilizan la medición y comparación; un único aviso identifica la selección inferior usando el orden comercial del catálogo. NULL es ilimitado; igualar un límite no es superarlo. No hay bloqueos, cobros ni cambios de plan. Los errores de consumo no se interpretan como cero ni deshabilitan la selección. Se utiliza el loading compartido del dashboard; actualizar la página vuelve a medir.

Aplicar la migración `20261031110000_trz43_46_plan_usage.sql` antes de usar la medición. Verificaciones: tests de planes y componentes, `supabase/tests/trz43_46_plan_usage.sql` (rollback), y `tests/e2e/plan-usage.spec.ts`.
