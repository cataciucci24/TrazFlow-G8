# Cuenta y plan de la empresa

Ruta: `/dashboard/account`. Se abre desde el bloque «Tu cuenta» del pie de la
barra lateral o del menú móvil. Cerrar sesión mantiene su acción independiente.
Ambos accesos permanecen al pie del menú; la lista de navegación se desplaza
independientemente cuando no entra completa en la pantalla.

La historia permite consultar y comparar el catálogo, con el diseño compartido
de la aplicación. Logística actúa como el rol administrativo existente; depósito
y chofer conservan su navegación y no acceden al catálogo comercial.

## Fuente de datos

- `subscription_plans`: catálogo ordenado, precios enteros en centavos de USD,
  límites de operadores y pallets por mes, impresoras y equipamiento.
- `company_plans`: una asignación por empresa, enlazada por su `company_id`.
  La ausencia de fila significa «Sin plan asignado». No se asigna un plan al
  crear empresas o usuarios.
- `NULL` en límites significa ilimitado; en precios, cotización a medida.
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
