# Panel de integración ERP (US-ERP-05)

> Ruta: `/dashboard/integrations` ("Integración ERP" en la navegación, solo `logistics_manager`).
> Código: `src/app/dashboard/integrations/`, `src/components/erp/integration/`, `src/lib/erp-integration/` y la
> migración `20261019150000_erp_integration_panel.sql`. Depende de US-ERP-03 ([`erp-sync.md`](erp-sync.md)) y
> US-ERP-04 (outbox `erp_outbox_events`).

Objetivo: que logística detecte fallas de sincronización o de reporte al ERP sin entrar a la base.

## Qué muestra

| Sección | Fuente |
|---|---|
| **Estado de la integración**: badge general, motivos, conexión, última sincronización exitosa, conteo de reportes. | `erp_integration_summary()` + `ErpClient.healthcheck()` |
| **Detalle de un evento** (`?event=tipo:id`): código y mensaje sanitizado, explicación del código, pallets informados, historial de reintentos y botón **Reintentar envío** si está fallido. | `erp_integration_event_detail()` |
| **Sincronización**: el mismo panel de Pallets y Órdenes, con **Sincronizar con ERP** (`syncErpNow`). | `erp_sync_runs` |
| **Despachadas sin reportar**: órdenes del ERP con despacho físico confirmado (`confirmed_at`) cuyo reporte no está `sent`, o que no tienen reporte ("Sin reporte generado"). | `erp_dispatched_unreported()` |
| **Actividad**: sincronizaciones y reportes, más recientes primero, con filtros y paginación (20 por página). | `erp_integration_activity()` |

Si `ERP_PROVIDER` no está definido, la página muestra un estado vacío ("no configurada").

### Filtros (todos en la URL, se pueden compartir)

| Parámetro | Valores |
|---|---|
| `status` | `running`, `success`, `partial` (sincronización); `pending`, `processing`, `sent` (reporte); `failed` (ambos) |
| `kind` | `sync` (sincronización) \| `dispatch_confirmed` (reporte de despacho) |
| `from`, `to` | `YYYY-MM-DD`, días de Argentina, ambos inclusive |
| `q` | Orden externa, QR o `external_id` del pallet, lote externo, o `external_id` de un error de sincronización. Sin distinguir mayúsculas; `%` y `_` son literales. Hasta 100 caracteres. |
| `page`, `upage` | Página de Actividad y de Despachadas sin reportar |
| `event` | `sync:<uuid>` o `dispatch_confirmed:<uuid>` |

Un valor inválido se ignora y se avisa arriba de la página.

## Badges

| Badge | Por fila | En el estado general |
|---|---|---|
| **Fallido** | reporte `failed`; sincronización `failed` o `partial` (tuvo registros con error) | falla el healthcheck, la última sincronización fue `failed`/`partial`, o hay reportes `failed` |
| **Sincronizando** | reporte `processing`; sincronización `running` | hay una sincronización `running` o reportes `processing` |
| **Pendiente** | reporte `pending` | hay reportes `pending` u órdenes despachadas sin reporte |
| **Desactualizado** | — | la última sincronización **exitosa** es más vieja que el umbral, o nunca hubo una |
| **Saludable** | reporte `sent`; sincronización `success` | nada de lo anterior |

El estado general toma el más grave en ese orden y lista todos los motivos.

**Umbral de desactualizado:** variable de servidor `ERP_SYNC_STALE_AFTER_HOURS`, en horas (24 por defecto, admite
decimales, máximo 8760). Un valor inválido usa el defecto. Como hoy la sincronización es manual, con 24 h el panel
avisa si nadie sincronizó en el último día.

## Acciones

Todas son Server Actions con `requireUserProfile()` + rol `logistics_manager`, y la base vuelve a verificarlo.
Después de cada una se revalidan Integración ERP, Órdenes, el detalle de orden y el inicio.

- **Sincronizar con ERP**: reutiliza `syncErpNow` (US-ERP-03).
- **Reintentar envío** (solo reportes `failed`):
  1. `erp_outbox_retry_failed` (SECURITY DEFINER, `search_path=''`) verifica sesión, rol, empresa y que el evento
     esté `failed`. Lo pasa a `pending` con `next_attempt_at = now()` y registra el pedido en
     `erp_outbox_retry_requests` (quién, cuándo, intentos y último error previos). **No modifica el payload ni
     la clave, y no crea otro evento.**
  2. Ya fuera de esa transacción, el servidor procesa **solo ese reporte** con el procesador de US-ERP-04
     (`aggregateId`, límite 1, timeout de 15 s por envío).
  - El intento se suma cuando el procesador toma el evento. Un reporte que ya agotó los 10 intentos automáticos
    recibe **exactamente un envío más**: si falla, aunque sea un error reintentable, vuelve a `failed`. Si el
    procesador se corta, al vencer el lease (2 min) `erp_outbox_claim` lo deja en `failed`. Nunca queda en
    `processing`.
  - Sin ERP configurado, el reporte solo queda `pending`.
- **Enviar pendientes ahora**: procesa hasta 5 reportes vencidos de la empresa (pendientes cuyo próximo intento ya
  llegó), con timeout de 15 s por envío. Los que esperan su backoff no se adelantan.

No hay cron: sin esta acción, los reportes pendientes se procesan cuando alguien confirma otro despacho de la
empresa (US-ERP-04).

## Seguridad

- **Lecturas:** cuatro funciones `SECURITY INVOKER` (la RLS de la sesión se aplica) que además exigen
  `logistics_manager`. Operador, chofer y logística de otra empresa reciben `42501`, o "no existe" en el
  detalle. `anon` no tiene EXECUTE.
- **Nunca se devuelve el payload completo**, ni el operador ni la clave de idempotencia. Del payload solo salen
  las líneas (pallet, producto, lote, cantidad, unidad).
- **Sanitización en el servidor** (`sanitizeErpErrorText`) de cada mensaje antes de renderizar: oculta URLs,
  credenciales y tokens, pares `clave=valor` sensibles y correos, y trunca a 300 caracteres. Se aplica aunque
  los mensajes ya se guarden sanitizados.
- **Healthcheck:** llama a `ErpClient.healthcheck()` con timeout de 5 s, dentro de `<Suspense>`, así que un ERP
  lento no bloquea la página. Solo muestra proveedor y latencia, o el código y el mensaje sanitizado.
- **`erp_outbox_retry_requests`:** RLS de lectura solo para logística de la empresa. Nadie la escribe directo,
  solo la RPC.
- **Frontera servidor/cliente:** los componentes cliente solo importan `types`, `filters`, `status`, `sanitize`
  y `actions` de `src/lib/erp-integration` (`server-boundary.test.ts`).

## Riesgos conocidos y pendientes (fuera de esta US)

- **Por la API, un operador de depósito todavía puede leer `erp_outbox_events`**, payload incluido (nombre e id
  del operador, pallets). La policy `erp_outbox_events_select` de US-ERP-04 lo permite y su test lo cubre a
  propósito (`us_erp04_dispatch_outbox.sql`, líneas 212 y 218). Las lecturas del panel sí lo rechazan. Está
  consultado con el autor de US-ERP-04.
- **`erp_outbox_requeue` (US-ERP-04) sigue habilitada para `authenticated`:** acepta eventos `pending` además de
  `failed` y no deja auditoría. El panel no la usa.
- **Bug de `idempotency_key` (US-ERP-04):** la clave `dispatch:{orderExternalId}` es única en toda la base y
  `confirm_dispatch_order` hace `on conflict do nothing`. Si dos empresas tienen una orden del ERP con el mismo
  id externo (US-ERP-03 lo permite), el despacho de la segunda empresa no genera evento y nunca se reporta, sin
  error. El panel lo muestra en "Despachadas sin reportar" como **Sin reporte generado**, pero no se puede
  reintentar porque no hay evento. Corrección propuesta: unicidad `(company_id, idempotency_key)`.

## Pruebas

- **`supabase/tests/us_erp05_integration_panel.sql`:**
  - Privilegios y SECURITY DEFINER/INVOKER.
  - Operador, chofer y logística de otra empresa no ven ni reintentan.
  - Filtros (tipo, estado, rango, búsqueda por orden, QR, pallet externo y error de sync; `%` literal), orden y
    paginación con total.
  - Despachadas sin reportar, incluido el caso sin evento.
  - Detalle sin operador ni clave.
  - Reintento solo de `failed`, sin tocar payload, clave ni intentos, sin crear eventos y con auditoría.
  - Envío extra con intentos agotados que falla y vuelve a `failed`; lease vencido que no queda en `processing`.
  - RLS de la auditoría.
- **`src/lib/erp-integration/*.test.ts`:**
  - Filtros y links.
  - Badges, prioridad y estado desactualizado.
  - Sanitización.
  - Umbral.
  - Healthcheck (ok, 401, timeout, configuración y errores sin filtrar).
  - Reintento y envío de pendientes con una base falsa que imita las RPC.
  - Chequeo estático de que cada Server Action exige sesión y rol, y de la frontera servidor/cliente.

## Checklist manual (navegador)

Preparación: `ERP_PROVIDER=mock`, usuario de logística, Pallets → vincular `Depósito Central - SRV` y sincronizar.

1. **Navegación**
   - Logística ve "Integración ERP" en el menú.
   - Operador y chofer no la ven, y si entran por URL vuelven a `/dashboard`.
2. **Sin ERP** (sin `ERP_PROVIDER`): estado vacío "no configurada", sin errores.
3. **Estado vacío**
   - Empresa sin actividad: "Todavía no hay actividad" y "Todo lo despachado está reportado".
   - Badge Desactualizado si nunca se sincronizó.
4. **Healthcheck**
   - Mientras carga, se ve "Verificando la conexión…" y el resto de la página ya es usable.
   - Con `ERP_MOCK_SCENARIO=timeout` o `unauthorized`: badge Fallido y el mensaje sin URLs ni credenciales.
5. **Sincronizar**
   - El botón muestra "Sincronizando…".
   - Al terminar, aparece una fila nueva en Actividad y se actualiza la última sincronización.
6. **Reporte fallido**
   1. Confirmar un despacho de una orden del ERP con `ERP_MOCK_SCENARIO=unauthorized`.
   2. Comprobar que aparece en Despachadas sin reportar y en Actividad como Fallido.
   3. En "Ver detalle": código, explicación y pallets, sin nombre del operador.
   4. Volver a `ok`, tocar **Reintentar envío**: mensaje de éxito, la orden sale de Despachadas sin reportar y
      el detalle muestra el reintento en el historial.
7. **Doble clic / dos pestañas:** reintentar en una pestaña y luego en otra da "ya no está fallido", sin duplicar.
8. **Filtros**
   - Cada filtro solo y combinados, el rango de fechas y la búsqueda por `SAL-ORD-…`, `PAL-…` y `stock:…`.
   - "Limpiar filtros".
   - Un filtro sin resultados muestra "Sin resultados para estos filtros".
   - Un valor inválido en la URL (`?status=x`) muestra el aviso, no un error.
9. **Paginación**
   - Con más de 20 eventos: Anterior/Siguiente conservan los filtros.
   - `?page=999` muestra "Esa página no existe" con link a la primera.
10. **Enviar pendientes ahora**
    - Sin pendientes vencidos: mensaje informativo.
    - Con `ERP_MOCK_SCENARIO=timeout`: el mensaje dice que se reintentan automáticamente.
11. **Mobile:** las tablas pasan a filas y los botones no se cortan.
12. **Bundle:** en DevTools → Sources no aparecen `ERP_PROVIDER`, `erp_outbox_retry_failed` ni URLs del ERP.
