# Onboarding de una empresa y sus operadores (TRZ-73)

Guía del comportamiento implementado en esta rama. Revisar al integrar el alta de
empresa de TRZ-112, el reenvío de TRZ-74 y la recuperación de TRZ-31.

Aplicación pública: [TrazFlow](https://traz-flow-g8.vercel.app). Las cuentas del
seed y sus contraseñas públicas son exclusivamente locales. El despliegue requiere
una cuenta real aprobada por el responsable de su empresa.

## 1. Preparar la empresa

Un responsable debe tener la empresa y un usuario activo con rol
`logistics_manager` ya provisionados. El registro público actual permite solicitar
acceso a una empresa existente; no crea empresas ni responsables logísticos.
Para desarrollo, seguir el [README](../README.md): el seed local crea
**TrazFlow Demo** y un usuario por rol. No ejecutar ese seed en la base compartida.

Si hay ERP, el responsable de la instalación configura las variables del servidor
y logística comprueba la conexión y sincroniza desde **Integración ERP**. Las
credenciales nunca se piden al operador ni se incluyen en esta guía. Ver
[contrato](erp-contract.md) y [sincronización](erp-sync.md).

## 2. Registrar al operador

1. Abrir `/register` e ingresar nombre completo, email y contraseña de al menos
   ocho caracteres.
2. Elegir la empresa y el rol **Operador de depósito** o **Chofer**.
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

Comprobar con cada cuenta que ve la empresa y las pantallas de su rol. Una cuenta
pendiente, rechazada o revocada no debe abrir el dashboard operativo. Verificar
una orden asignada al chofer y que otro chofer no pueda verla. No usar usuarios
demo ni contraseñas públicas en producción.
