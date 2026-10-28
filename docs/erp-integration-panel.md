# Panel de integración ERP (US-ERP-05)

> Ruta: `/dashboard/integrations` ("Integración ERP" en la navegación, solo `logistics_manager`).
> Código: `src/app/dashboard/integrations/`, `src/components/erp/integration/`, `src/lib/erp-integration/` y la
> migración `20261019150000_erp_integration_panel.sql`. Depende de US-ERP-03 ([`erp-sync.md`](erp-sync.md)) y
> US-ERP-04 (outbox `erp_outbox_events`). El procesamiento automático (TRZ-104) está en `src/app/api/cron/` y
> `src/lib/cron/`.

Objetivo: que logística detecte fallas de sincronización o de reporte al ERP sin entrar a la base.

## Qué muestra

| Sección | Fuente |
|---|---|
| **Estado de la integración**: badge general, motivos, conexión, última sincronización exitosa, conteo de reportes. | `erp_integration_summary()` + `ErpClient.healthcheck()` |
| **Detalle de un evento** (`?event=tipo:id`): código y mensaje sanitizado, explicación del código, pallets informados, historial de reintentos y botón **Reintentar envío** si está fallido. | `erp_integration_event_detail()` |
| **Sincronización**: el mismo panel de Pallets y Órdenes, con **Sincronizar con ERP** (`syncErpNow`), los avisos de la última corrida y los depósitos de la empresa (TRZ-101). | `erp_sync_runs`, `warehouses` |
| **Despachadas sin reportar**: órdenes del ERP con despacho físico confirmado (`confirmed_at`) cuyo reporte no está `sent`, o que no tienen reporte ("Sin reporte generado"). | `erp_dispatched_unreported()` |
| **Actividad**: sincronizaciones y reportes, más recientes primero, con filtros y paginación (20 por página). | `erp_integration_activity()` |

Si `ERP_PROVIDER` no está definido, la página muestra un estado vacío ("no configurada").

### Estado del remito (TRZ-100)

En cada reporte **enviado**, la lista de Actividad muestra "Remito en el ERP: …" y el detalle agrega el campo
*Remito en el ERP* (con la hora de la última consulta) y la línea de la orden de cada pallet
(`orderLineExternalId`, o "sin línea"):

| `erp_document_status` | Se muestra |
|---|---|
| `null` | Sin consultar |
| `draft` | Borrador |
| `confirmed` | Confirmado |
| `cancelled` | Anulado |
| `not_found` | No encontrado |
| `not_tracked` | Sin seguimiento (reportes anteriores a TRZ-100, que no se consultan) |

El estado lo actualiza cada sincronización (ver [`erp-sync.md`](erp-sync.md), "Estado del remito"); desde el panel
no se consulta. `erp_integration_activity()` devuelve la columna `erp_document_status` y
`erp_integration_event_detail()` los campos `erpDocumentStatus`, `erpDocumentCheckedAt` y
`erpDocumentConfirmedSeenAt` (20261028100300).

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
decimales, máximo 8760). Un valor inválido usa el defecto. Desde TRZ-104 la sincronización automática corre cada
15 minutos: si el panel marca "Desactualizado", el cron no está corriendo o el ERP viene fallando.

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

Los botones siguen funcionando igual; desde TRZ-104 además hay procesamiento automático (sección siguiente).

## Procesamiento automático (TRZ-104)

Sin que nadie use la app, dos tareas programadas llaman a la app desplegada en Vercel:

| Route Handler | Frecuencia | Qué hace |
|---|---|---|
| `GET /api/cron/erp-outbox` | cada 5 min | Envía al ERP los reportes `pending` cuyo próximo intento venció, de **todas** las empresas (`processErpOutbox` con `service_role`). |
| `GET /api/cron/erp-sync` | cada 15 min (minutos 2, 17, 32, 47) | Sincronización completa de cada empresa con ERP (`syncCompanyFromErp` sin usuario). Ver [`erp-sync.md`](erp-sync.md), "Sincronización automática". |

**Quién las llama: `pg_cron` + `pg_net` en Supabase.** Se descartó Vercel Cron porque el plan Hobby solo permite
un cron por día, con hasta 59 minutos de desvío. Otras opciones evaluadas: crontab en la VM de ERPNext, GitHub
Actions (mínimo 5 min, con atrasos y corridas descartadas) y Edge Function. El Route Handler es el mismo para
cualquier opción: si el proyecto pasa a Vercel Pro, alcanza con un `vercel.json` con los mismos paths.

**Autenticación:** header `Authorization: Bearer <CRON_SECRET>`, comparado en tiempo constante
(`src/lib/cron/auth.ts`). Sin `CRON_SECRET` en el servidor, o con menos de 16 caracteres, responde siempre 401.
`src/proxy.ts` excluye `/api/cron/*`: esas rutas no tienen sesión y no redirigen a login.

**Respuestas:** 401 sin el secreto · 200 `{ ok: true, erp: false }` sin ERP configurado (no envía ni sincroniza) ·
200 con el resumen (contadores del outbox o el resultado por empresa) · 500 si falta `SUPABASE_SERVICE_ROLE_KEY`
o la base no responde. Nunca devuelven payloads, claves ni datos del operador.

**Límites por ejecución** (`maxDuration = 300 s`, el máximo de Hobby):

- Outbox: tandas de 5 reportes con 20 s de timeout por envío (una tanda dura menos que el lease de 2 min), hasta
  25 por ejecución, y no arranca otra tanda pasados los 150 s. Si una tanda tuvo envíos sin respuesta, corta. El
  backoff, los 10 intentos, el lease y la idempotencia los sigue decidiendo la base: dos ejecuciones solapadas no
  toman el mismo reporte (`for update skip locked` + lease).
- Sincronización: una empresa a la vez y no arranca otra pasados los 120 s. Ver `erp-sync.md`.

**Clave `service_role`:** solo en `src/lib/supabase/service.ts` (`server-only`), leída de
`SUPABASE_SERVICE_ROLE_KEY`, nunca con `NEXT_PUBLIC_`. Los `server-boundary.test.ts` verifican que ningún componente
cliente la importe y que solo la usen los Route Handlers de `/api/cron`. El panel sigue leyendo con la sesión del
usuario.

En la actividad y en el detalle de una sincronización, esta página muestra **Automática** cuando la hizo el cron
(sin usuario). Es el único lugar de la app que las distingue.

### Configurarlo en la nube

1. **Vercel → Settings → Environment Variables**, entorno *Production* (sin `NEXT_PUBLIC_`):
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → la clave *secret* (`sb_secret_…`) o la
     *service_role* (legacy).
   - `CRON_SECRET`: generarlo con `openssl rand -hex 32`. Guardalo en el gestor de contraseñas: hace falta en el
     paso 3.
2. **Redeploy** de producción (las variables nuevas no llegan a un deploy ya hecho).
3. **Probarlo con `curl`** desde tu máquina, con el dominio de producción (los preview tienen Deployment
   Protection):
   ```bash
   curl -i https://<tu-app>.vercel.app/api/cron/erp-outbox                                 # 401
   curl -i -H "Authorization: Bearer $CRON_SECRET" https://<tu-app>.vercel.app/api/cron/erp-outbox   # 200 + resumen
   curl -i -H "Authorization: Bearer $CRON_SECRET" https://<tu-app>.vercel.app/api/cron/erp-sync     # 200 + empresas
   ```
4. **Supabase → SQL Editor:** aplicar la migración `20261030100000_trz104_erp_sync_service_role.sql` (si no se
   aplicó con el resto) y después correr estas secciones, una por vez. **No se guardan en el repo** porque llevan
   la URL y el secreto reales: reemplazá los dos valores al pegarlas.
   ```sql
   -- a) Extensiones (una sola vez).
   create extension if not exists pg_cron with schema pg_catalog;
   create extension if not exists pg_net with schema extensions;

   -- b) Secretos en Vault (una sola vez). La URL es la del deploy que tiene TRZ-104, sin barra final; el
   --    secreto es exactamente el CRON_SECRET de Vercel.
   select vault.create_secret('https://<tu-app>.vercel.app', 'trazflow_app_url', 'URL de TrazFlow (TRZ-104)');
   select vault.create_secret('<CRON_SECRET>', 'trazflow_cron_secret', 'CRON_SECRET de TrazFlow (TRZ-104)');

   -- c) Jobs. pg_net corta a los 2 s por defecto: se le da casi todo el maxDuration (300 s). La sincronización
   --    corre en los minutos 2, 17, 32 y 47 para no coincidir con el outbox.
   select cron.schedule('trazflow-erp-outbox', '*/5 * * * *', $job$
     select net.http_get(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'trazflow_app_url') || '/api/cron/erp-outbox',
       headers := jsonb_build_object('Authorization', 'Bearer ' ||
         (select decrypted_secret from vault.decrypted_secrets where name = 'trazflow_cron_secret')),
       timeout_milliseconds := 290000);
   $job$);
   select cron.schedule('trazflow-erp-sync', '2,17,32,47 * * * *', $job$
     select net.http_get(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'trazflow_app_url') || '/api/cron/erp-sync',
       headers := jsonb_build_object('Authorization', 'Bearer ' ||
         (select decrypted_secret from vault.decrypted_secrets where name = 'trazflow_cron_secret')),
       timeout_milliseconds := 290000);
   $job$);
   ```
5. **Verificar** (solo `select`):
   ```sql
   -- Respuestas de la app a los cron (se guardan 6 h): status_code 200 y el resumen en body.
   -- Los jobs existen y están activos.
   select jobid, jobname, schedule, active from cron.job where jobname like 'trazflow-%';

   -- Respuestas de la app a los cron (se guardan 6 h). 200 = ok; 401 = el secreto no coincide; 404 = ese deploy
   -- todavía no tiene TRZ-104; 500 = falta SUPABASE_SERVICE_ROLE_KEY; timed_out / error_msg = no respondió.
   select status_code, timed_out, error_msg, left(content, 300) as body, created
   from net._http_response order by created desc limit 10;

   -- Reportes pendientes vencidos hace más de 10 minutos: con el cron andando debería dar 0
   -- (salvo que el ERP esté caído; ahí quedan pending con su backoff).
   select id, company_id, attempts, next_attempt_at, last_error_code
   from public.erp_outbox_events
   where status = 'pending' and next_attempt_at < now() - interval '10 minutes';

   -- Últimas sincronizaciones automáticas.
   select company_id, status, started_at, finished_at, error_message, jsonb_array_length(errors) as errores
   from public.erp_sync_runs where trigger_source = 'automatic' order by started_at desc limit 10;
   ```

Si cambia la URL (por ejemplo, de `develop` a producción) o el secreto, no hace falta tocar los jobs:

```sql
select vault.update_secret((select id from vault.secrets where name = 'trazflow_app_url'), 'https://<nueva-url>.vercel.app');
select vault.update_secret((select id from vault.secrets where name = 'trazflow_cron_secret'), '<nuevo-secreto>');
```

Para apagarlo: `select cron.unschedule('trazflow-erp-outbox'); select cron.unschedule('trazflow-erp-sync');`.
Mientras una llamada está en curso, cualquier rol que pueda loguearse en la base ve el secreto en
`net.http_request_queue`: el riesgo es bajo (solo sirve para disparar los cron) y se rota con `update_secret`.

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

Preparación: `ERP_PROVIDER=mock`, usuario de logística, sincronizar (desde TRZ-101 los depósitos se importan solos;
ya no se vinculan a mano).

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
