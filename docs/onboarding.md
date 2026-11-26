# Onboarding de una empresa y sus operadores (TRZ-73)

Guía del comportamiento implementado. Incluye el alta de empresa desde la app
(TRZ-112, parte 2). Revisar al integrar el reenvío de TRZ-74 y la recuperación de TRZ-31.

Aplicación pública: [TrazFlow](https://traz-flow-g8.vercel.app). Las cuentas del
seed y sus contraseñas públicas son exclusivamente locales. El despliegue requiere
una cuenta real aprobada por el responsable de su empresa.

## 1. Dar de alta la empresa (TRZ-112)

La primera persona de una empresa nueva la da de alta desde la app y queda como
su responsable logístico (`logistics_manager`):

1. Abrir `/register`, ingresar nombre completo, email y contraseña (mínimo ocho
   caracteres) y, en el paso 2, elegir **Dar de alta mi empresa**.
2. Ingresar el nombre de la empresa (de 2 a 140 caracteres) y su CUIT (11 dígitos,
   con o sin guiones). Se valida el prefijo y el dígito verificador.
3. Confirmar el email (en Supabase local, en Mailpit, puerto 54324) e iniciar sesión.
4. En `/complete-registration`, revisar los datos, elegir el plan (**Starter** o
   **Growth**) y pulsar **Dar de alta la empresa**. El alta no genera cobros.
   **Enterprise** no se elige acá: es gestión comercial.
5. Se entra directo al dashboard como responsable logístico, sin aprobación.

La RPC `create_company_with_manager` crea todo en una sola transacción: la
empresa, el perfil `logistics_manager`, el plan elegido y el depósito **DEP-01
"Depósito principal"**. Si algo falla, no queda nada a medias. Reglas:

- **Una empresa por usuario:** solo puede darla de alta alguien con email
  confirmado, sin perfil y sin una solicitud de acceso pendiente. Con una
  solicitud rechazada, sí: `/access-status` ofrece **Dar de alta mi empresa**.
- **CUIT único:** no puede haber dos empresas con el mismo CUIT, aunque estén
  escritos distinto (con o sin guiones). El mensaje no dice qué empresa lo tiene:
  invita a pedirle acceso a su responsable logístico.
- **Sin ERP:** la empresa arranca en modo manual. Logística conecta su ERP en
  **Integración ERP → Configuración** cuando quiera ([ERP por empresa](erp-por-empresa.md)).
- **Depósito:** `DEP-01` es transitorio hasta que exista el alta y edición de
  depósitos (TRZ-116). Sin él, una empresa sin ERP no podría ubicar pallets. Si
  conecta un ERP, la sincronización trae sus depósitos y `DEP-01` sigue estando.

Después, logística suma a su equipo (sección 2) y aprueba las solicitudes (sección 3).

**Gestión de empresas por el equipo de TrazFlow.** No hay un rol ni una pantalla
de administrador de plataforma: todos los roles de la app pertenecen a una
empresa. Asignar Enterprise, reactivar una suscripción, corregir un CUIT o dar
de baja una empresa se hace desde la base (Supabase Studio o SQL).

**Riesgo conocido.** La lista de empresas del registro (`get_registration_companies`)
se muestra sin sesión, así que cualquiera ve los nombres de los clientes. Se
mantuvo para US27. Una mejora posible es sumarse a una empresa ingresando su CUIT.

Para desarrollo, seguir el [README](../README.md): el seed local crea
**TrazFlow Demo** y un usuario por rol. No ejecutar ese seed en la base compartida.

## 2. Registrar al operador

1. Abrir `/register` e ingresar nombre completo, email y contraseña de al menos
   ocho caracteres.
2. En el paso 2, elegir **Sumarme a una empresa**, la empresa y el rol
   **Operador de depósito** o **Chofer**.
3. Completar el registro y, si el entorno lo exige, confirmar el email recibido.
   En Supabase local los correos se consultan en Mailpit, puerto 54324.
4. Iniciar sesión. En `/complete-registration`, verificar nombre, empresa y rol
   y pulsar **Enviar solicitud**. Registrarse no concede acceso operativo.
5. Hasta la aprobación, consultar el estado en `/access-status`.

Si el usuario ya tiene una solicitud y le falta el nombre, completar ese dato en
`/complete-registration`. Esto no cambia la empresa ni el rol de su solicitud.

## 3. Aprobar o rechazar

Logística abre **Operadores → Solicitudes**
(`/dashboard/operators?tab=solicitudes`), revisa identidad, empresa y rol y elige
**Aprobar** o **Rechazar**, con su confirmación correspondiente. La aprobación
crea el perfil operativo; la base valida permisos y empresa. Una solicitud ya
resuelta no se vuelve a aprobar mediante este flujo.

El solicitante vuelve a entrar o actualiza la página: con perfil activo accede
al dashboard; si fue rechazado, ve ese estado en `/access-status`. El reenvío
de solicitudes rechazadas depende de TRZ-74; no está implementado aquí.

## 4. Asignar trabajo y administrar acceso

- **Depósito:** arma pallets por ítems, valida su contenido y confirma despachos.
- **Chofer:** logística lo asigna a una orden. Una vez despachada, la ve en
  **Mis entregas** y registra el resultado de los pallets.
- **Revocar/restaurar:** logística usa la pestaña **Operadores**. Revocar corta
  el acceso y conserva el historial. Revisar las entregas en tránsito antes de
  revocar a un chofer y reasignarlas cuando corresponda.

Para pallets mixtos y reingresos, consultar la [guía operativa](persona3-pallets.md).
Logística registra el reingreso con QR y motivo; no se modifica la entrega anterior.

El destinatario o distribuidora es un dato comercial de la orden y no tiene
cuenta. **No existe la vinculación operador-distribuidor** del modelo anterior:
el rol `distributor_operator` y sus RPC se retiraron. No reproducir ese paso del
ticket histórico. Consultar [modelo de roles](modelo-de-roles.md) y
[transición de usuarios históricos](transicion-choferes.md).

## Comprobación final

Comprobar con cada cuenta que ve la empresa y las pantallas de su rol, y que el
responsable de una empresa nueva no ve datos de otra (ver
`supabase/tests/trz112_company_onboarding.sql`). Una cuenta
pendiente, rechazada o revocada no debe abrir el dashboard operativo. Verificar
una orden asignada al chofer y que otro chofer no pueda verla. No usar usuarios
demo ni contraseñas públicas en producción.
