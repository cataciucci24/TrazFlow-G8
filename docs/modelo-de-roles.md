# Modelo de roles de TrazFlow

> Fuente única sobre quién es quién en la plataforma. Las historias de Jira que involucran gestión de usuarios
> (TRZ-19, TRZ-33 a TRZ-38, USE1/TRZ-68, USC5/TRZ-65, planes TRZ-39 a TRZ-50) enlazan acá en vez de repetir esto.
>
> Estado al 2/10/2026. Si cambia una decisión, se actualiza este documento y no cada historia.

## 1. Jerarquía

```
TrazFlow (back-office de plataforma)      → crea la empresa e invita a su dueño
   └─ company_admin (dueño de la cuenta)  → gestiona logistics_manager, plan y pagos
        └─ logistics_manager              → aprueba operadores y los vincula a distribuidores
             ├─ warehouse_operator
             └─ distributor_operator      → opera para UN distribuidor (distributor_users)
```

Regla general: **cada nivel gestiona solo al nivel de abajo, y solo dentro de su propia empresa.** Nadie puede
otorgarse ni aprobar un rol igual o superior al propio.

## 2. Qué hace cada rol

Resumen:

| Rol | Nivel | ¿Existe hoy? |
|---|---|---|
| Administrador TrazFlow | Plataforma | No (script, §4) |
| `company_admin` | Empresa | No (epic de planes:trz-39 a traz-46) |
| `logistics_manager` | Empresa | Sí |
| `warehouse_operator` | Operación | Sí |
| `distributor_operator` | Operación | Sí |
| `seller` (vendedor) | Operación | No (USE1 / TRZ-68) |

### Administrador TrazFlow (plataforma)

- **Hace:** da de alta empresas; crea o invita al primer usuario de cada empresa; soporte.
- **No hace:** no opera la logística de ninguna empresa.
- **Nota:** no es un valor de `user_role` ni pertenece a una empresa (ver §4).

### `company_admin` (dueño de la cuenta de la empresa)

- **Hace:** da de alta, aprueba y revoca a los `logistics_manager` de su empresa; elige el plan, ve pagos y
  facturas, cancela la suscripción (TRZ-39 a TRZ-50).
- **No hace:** no arma órdenes ni opera el depósito.

### `logistics_manager` (responsable logístico)

- **Hace (logística):** órdenes, stock, alertas, pallets, lotes, trazabilidad, notificaciones.
- **Hace (usuarios), mientras no exista `company_admin`:**
  - ve las solicitudes pendientes (TRZ-36);
  - aprueba asignando rol (TRZ-37);
  - rechaza o revoca (TRZ-38);
  - vincula operadores a distribuidores (TRZ-19).
- **No hace:** no puede aprobar ni crear otro `logistics_manager`.

### `warehouse_operator` (operador de depósito)

- **Hace:** valida pallets por QR y confirma despachos.
- **No hace:** no gestiona usuarios.

### `distributor_operator` (operador de distribuidor)

- **Hace:** recibe pallets, registra discrepancias de recepción y reporta el stock de **su** distribuidor.
- **No hace:** no gestiona usuarios.
- **Nota:** sin vínculo en `distributor_users` no ve órdenes ni puede recibir.

### `seller` (vendedor, futuro)

- **Hace:** carga pedidos (USE2).
- **A definir:** quién lo aprueba (ver §5).

## 3. Cómo está implementado hoy

- **Roles:** enum `user_role` con `logistics_manager`, `warehouse_operator` y `distributor_operator`
  (`supabase/migrations/0001_init_schema.sql`). Cada perfil (`public.users`) pertenece a exactamente una empresa
  (`company_id not null`) y todas las policies filtran por `auth_company_id()`.
- **Registro (TRZ-33/34):** cualquier persona crea una cuenta y pide sumarse a una empresa **existente**, eligiendo
  `warehouse_operator` o `distributor_operator` (`src/lib/registration/options.ts` y el `check` de
  `access_requests`). No se puede pedir `logistics_manager` ni crear una empresa.
- **Aprobación (TRZ-36/37):** solo un `logistics_manager` de la misma empresa
  (`get_pending_access_requests`, `approve_access_request`). Al aprobar se crea la fila en `public.users`.
- **Pantalla "Operadores" (`/dashboard/operators`, solo `logistics_manager`):** pestaña **Solicitudes** (aprobar,
  TRZ-37; rechazar, TRZ-38) y pestaña **Operadores** (vincular distribuidor, TRZ-19; revocar y restaurar acceso,
  TRZ-38). La ruta vieja `/dashboard/access-requests` redirige acá. RPCs en
  `supabase/migrations/20261003120000_operator_management.sql`.
- **Vínculo con distribuidor (TRZ-19):** `assign_operator_distributor` escribe `distributor_users`, que admite un
  solo distribuidor por usuario: vincular de nuevo reemplaza el anterior. `operates_for_distributor()` lee esa
  tabla, así que sin vínculo un `distributor_operator` no ve órdenes (el dashboard se lo explica).
- **Reasignar o revocar con órdenes en tránsito:** se permite, pero si el distribuidor actual tiene órdenes
  `confirmed` y queda sin otros operadores activos, la pantalla pide confirmación.
- **Revocar acceso (TRZ-38):** no borra al usuario. Marca `users.revoked_at` y elimina su vínculo con el
  distribuidor. `auth_company_id()`, `auth_role()` y `operates_for_distributor()` ignoran perfiles revocados, así
  que pierde acceso a todas las tablas sin tocar cada policy, y el historial (eventos, movimientos, validaciones)
  conserva su autor. El usuario solo puede leer su propia fila, y `/access-status` le muestra "Acceso revocado".
  Restaurar limpia `revoked_at`; el distribuidor se vuelve a asignar a mano.

## 4. Lo que falta y cómo se resuelve por ahora

**Alta de empresa y de su primer `logistics_manager`**

- Por ahora (Sprint 3): script SQL documentado, ejecutado por el equipo (USG2 / TRZ-73).
- Definitivo: back-office de plataforma, con una tabla `platform_admins` o un claim en el JWT y RPCs
  `security definer` propios. **No** se agrega como valor de `user_role`.

**Gestión de los `logistics_manager` de una empresa**

- Por ahora: por script.
- Definitivo: rol `company_admin`, junto con el epic de planes.

Por qué el administrador de plataforma no es un rol más: no pertenece a ninguna empresa cliente, y meterlo en
`user_role` obligaría a hacer excepciones en todas las policies multiempresa. Un error en una de ellas expondría
datos de todos los clientes.

## 5. Preguntas abiertas

- ¿La misma persona cumple más de un rol a la vez? (pendiente con el cliente, reunión del 29/9). Si la respuesta
  es que gestionar usuarios y operar la logística deben estar separados, `company_admin` sube de prioridad.
- ¿Una empresa puede tener varios `logistics_manager`? Hoy uno no puede revocar a otro ni a sí mismo (TRZ-38 solo
  revoca operadores).
- ¿Quién aprueba al vendedor (USE1)? No parece correcto que lo apruebe el área de logística; candidato:
  `company_admin`.

## 6. Convención para las historias

- Actor de las historias de gestión de usuarios: **"responsable logístico"** (`logistics_manager`), no
  "administrador" ni "administrador de empresa", mientras no exista `company_admin`.
- Cada historia afectada agrega una línea al final: `Ver modelo de roles: docs/modelo-de-roles.md`.
