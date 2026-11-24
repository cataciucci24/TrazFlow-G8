-- TRZ-112: ERP propio por empresa. Dos empresas (A con ERPNext, B con Odoo) no se cruzan configuración,
-- credenciales ni reportes del outbox. Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada.
-- Todo se revierte al final (incluidos los secretos de Vault).
begin;

create or replace function pg_temp.check(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-112: %', message; end if;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

create or replace function pg_temp.as_service()
returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claim.role', 'service_role', true);
$$;

-- Espera un error con el SQLSTATE indicado al ejecutar p_sql.
create or replace function pg_temp.raises(p_sql text, p_state text, message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TRZ-112: % (no falló)', message;
exception when others then
  if sqlstate <> p_state then
    raise exception 'TRZ-112: % (SQLSTATE %, se esperaba %: %)', message, sqlstate, p_state, sqlerrm;
  end if;
end;
$$;

insert into auth.users (id, email) values
  ('f1120000-0000-0000-0000-0000000000a1', 'trz112-manager-a@test.local'),
  ('f1120000-0000-0000-0000-0000000000a2', 'trz112-warehouse-a@test.local'),
  ('f1120000-0000-0000-0000-0000000000a3', 'trz112-driver-a@test.local'),
  ('f1120000-0000-0000-0000-0000000000b1', 'trz112-manager-b@test.local');
insert into companies (id, name) values
  ('f1121000-0000-0000-0000-00000000000a', 'TRZ-112 Empresa A'),
  ('f1121000-0000-0000-0000-00000000000b', 'TRZ-112 Empresa B');
insert into users (id, company_id, name, email, role) values
  ('f1120000-0000-0000-0000-0000000000a1', 'f1121000-0000-0000-0000-00000000000a', 'Logística A', 'trz112-manager-a@test.local', 'logistics_manager'),
  ('f1120000-0000-0000-0000-0000000000a2', 'f1121000-0000-0000-0000-00000000000a', 'Depósito A', 'trz112-warehouse-a@test.local', 'warehouse_operator'),
  ('f1120000-0000-0000-0000-0000000000a3', 'f1121000-0000-0000-0000-00000000000a', 'Chofer A', 'trz112-driver-a@test.local', 'driver_operator'),
  ('f1120000-0000-0000-0000-0000000000b1', 'f1121000-0000-0000-0000-00000000000b', 'Logística B', 'trz112-manager-b@test.local', 'logistics_manager');

/* ---------- Privilegios ---------- */

select pg_temp.check(not has_table_privilege('authenticated', 'public.erp_company_credentials', 'select'), 'nadie lee las credenciales por la API');
select pg_temp.check(not has_table_privilege('service_role', 'public.erp_company_credentials', 'select'), 'ni service_role lee la tabla directo');
select pg_temp.check(not has_function_privilege('authenticated', 'public.erp_company_connection(uuid)', 'execute'), 'un usuario no lee la conexión con credenciales');
select pg_temp.check(has_function_privilege('service_role', 'public.erp_company_connection(uuid)', 'execute'), 'el servidor sí');
select pg_temp.check(not has_function_privilege('anon', 'public.erp_save_company_config(text, text, text, text, text, integer, text, text, text, text)', 'execute'), 'anon no configura');
select pg_temp.check(not has_function_privilege('authenticated', 'public.erp_outbox_due_companies()', 'execute'), 'un usuario no lista empresas');
select pg_temp.check(has_function_privilege('service_role', 'public.erp_outbox_due_companies()', 'execute'), 'el cron sí');

/* ---------- Configuración por empresa ---------- */

set local role authenticated;

select pg_temp.as_user('f1120000-0000-0000-0000-0000000000a1');
select public.erp_save_company_config('erpnext', 'https://erp-a.example.com/', null, null, 'Productos A', 8000, null, null, 'clave-a-1234', 'secreto-a-WXYZ');
select pg_temp.check(
  (select (erp_provider, erp_base_url, erp_api_key_hint, erp_api_secret_hint, erp_item_group, erp_timeout_ms)
     = ('erpnext', 'https://erp-a.example.com', '1234', 'WXYZ', 'Productos A', 8000)
   from public.erp_company_settings where company_id = 'f1121000-0000-0000-0000-00000000000a'),
  'logística A guarda su ERP: URL sin barra final y solo las últimas 4 letras de cada credencial');
select pg_temp.check(public.erp_company_provider('f1121000-0000-0000-0000-00000000000a') = 'erpnext', 'A ve su proveedor');
select pg_temp.raises($$select public.erp_company_provider('f1121000-0000-0000-0000-00000000000b')$$, '42501', 'A no consulta el ERP de B');

select pg_temp.as_user('f1120000-0000-0000-0000-0000000000b1');
select public.erp_save_company_config('odoo', 'https://odoo-b.example.com', 'base-b', 'api@b', 'ignorado', null, null, null, 'clave-b-5678', 'ignorado');
select pg_temp.check(
  (select count(*) from public.erp_company_settings where company_id = 'f1121000-0000-0000-0000-00000000000a') = 0,
  'RLS: logística B no ve la configuración de A');
select pg_temp.check(
  (select (erp_provider, erp_odoo_database, erp_item_group, erp_api_secret_hint) is not distinct from ('odoo', 'base-b', null::text, null::text)
   from public.erp_company_settings where company_id = 'f1121000-0000-0000-0000-00000000000b'),
  'B guarda Odoo: sin API secret ni Item Group');

select pg_temp.as_user('f1120000-0000-0000-0000-0000000000a2');
select pg_temp.raises($$select public.erp_save_company_config('mock')$$, '42501', 'depósito no configura el ERP');
select pg_temp.check(public.erp_company_provider('f1121000-0000-0000-0000-00000000000a') = 'erpnext', 'depósito sí ve si su empresa tiene ERP');
select pg_temp.as_user('f1120000-0000-0000-0000-0000000000a3');
select pg_temp.raises($$select public.erp_save_company_config('mock')$$, '42501', 'el chofer no configura el ERP');
select pg_temp.check(public.erp_company_provider('f1121000-0000-0000-0000-00000000000a') = 'erpnext', 'el chofer sí ve si su empresa tiene ERP');
select pg_temp.raises($$select public.erp_company_connection('f1121000-0000-0000-0000-00000000000a')$$, '42501', 'ningún usuario lee credenciales');

-- Credenciales vacías: se conservan solo si no cambian proveedor ni URL.
select pg_temp.as_user('f1120000-0000-0000-0000-0000000000a1');
select public.erp_save_company_config('erpnext', 'https://erp-a.example.com', null, null, null, null, null, null, null, null);
select pg_temp.raises(
  $$select public.erp_save_company_config('erpnext', 'https://otro-servidor.example.com', null, null, null, null, null, null, null, null)$$,
  '22023', 'con otra URL hay que volver a ingresar las credenciales (no se mandan a un servidor nuevo)');
select pg_temp.raises(
  $$select public.erp_save_company_config('odoo', 'https://erp-a.example.com', 'db', 'u', null, null, null, null, null, null)$$,
  '22023', 'con otro proveedor también');
select pg_temp.raises($$select public.erp_save_company_config('sap')$$, '22023', 'proveedor desconocido');
select pg_temp.raises($$select public.erp_save_company_config('erpnext', 'ftp://erp', null, null, null, null, null, null, 'k', 's')$$, '23514', 'URL inválida');

reset role;

/* ---------- Lectura del servidor (service_role) ---------- */

set local role service_role;
select pg_temp.as_service();

select pg_temp.check(
  (select (c->>'provider', c->>'baseUrl', c->'credentials'->>'apiKey', c->'credentials'->>'apiSecret')
     = ('erpnext', 'https://erp-a.example.com', 'clave-a-1234', 'secreto-a-WXYZ')
   from public.erp_company_connection('f1121000-0000-0000-0000-00000000000a') c),
  'el servidor lee la conexión de A con sus credenciales (conservadas al guardar sin cambiarlas)');
select pg_temp.check(
  (select (c->>'provider', c->>'odooDatabase', c->'credentials'->>'apiKey', c->'credentials'->>'apiSecret')
     is not distinct from ('odoo', 'base-b', 'clave-b-5678', null::text)
   from public.erp_company_connection('f1121000-0000-0000-0000-00000000000b') c),
  'y la de B, con las suyas');
select pg_temp.check(public.erp_company_connection('5eed0000-0000-0000-0000-0000000000ff') is null, 'empresa sin ERP: null');
select pg_temp.check(public.erp_company_provider('f1121000-0000-0000-0000-00000000000b') = 'odoo', 'el cron ve el proveedor de cualquier empresa');

reset role;

select pg_temp.check(
  not exists (select 1 from vault.secrets s join public.erp_company_credentials c on c.vault_secret_id = s.id
              where s.secret like '%clave-a-1234%'),
  'en Vault la credencial está cifrada, no en texto plano');
select pg_temp.check((select count(*) from public.erp_company_credentials
  where company_id in ('f1121000-0000-0000-0000-00000000000a', 'f1121000-0000-0000-0000-00000000000b')) = 2, 'un secreto por empresa');

/* ---------- Outbox: la misma orden externa en dos empresas ---------- */

insert into erp_outbox_events (id, company_id, event_type, aggregate_id, idempotency_key, payload, status, attempts, next_attempt_at) values
  ('f1128000-0000-0000-0000-0000000000a1', 'f1121000-0000-0000-0000-00000000000a', 'dispatch_confirmed', gen_random_uuid(),
   'dispatch:SO-0001', '{"idempotencyKey":"dispatch:SO-0001"}', 'pending', 0, now() - interval '1 minute'),
  ('f1128000-0000-0000-0000-0000000000b1', 'f1121000-0000-0000-0000-00000000000b', 'dispatch_confirmed', gen_random_uuid(),
   'dispatch:SO-0001', '{"idempotencyKey":"dispatch:SO-0001"}', 'pending', 0, now() - interval '2 minutes'),
  ('f1128000-0000-0000-0000-0000000000b2', 'f1121000-0000-0000-0000-00000000000b', 'dispatch_confirmed', gen_random_uuid(),
   'dispatch:SO-0002', '{"idempotencyKey":"dispatch:SO-0002"}', 'failed', 10, now() - interval '1 hour');
select pg_temp.check(
  (select count(*) from erp_outbox_events where idempotency_key = 'dispatch:SO-0001'
     and company_id in ('f1121000-0000-0000-0000-00000000000a', 'f1121000-0000-0000-0000-00000000000b')) = 2,
  'la misma clave en dos empresas: dos eventos (antes se descartaba el segundo)');

insert into erp_outbox_events (company_id, event_type, aggregate_id, idempotency_key, payload)
values ('f1121000-0000-0000-0000-00000000000a', 'dispatch_confirmed', gen_random_uuid(), 'dispatch:SO-0001', '{"idempotencyKey":"dispatch:SO-0001"}')
on conflict do nothing;
select pg_temp.check(
  (select count(*) from erp_outbox_events where idempotency_key = 'dispatch:SO-0001'
     and company_id = 'f1121000-0000-0000-0000-00000000000a') = 1,
  'dentro de una empresa la clave sigue siendo única (idempotencia)');

create temp table trz112_claimed (who text, id uuid, company_id uuid);
grant all on trz112_claimed to service_role, authenticated;

/* ---------- Claim con sesión: siempre su empresa ---------- */

set local role authenticated;
select pg_temp.as_user('f1120000-0000-0000-0000-0000000000a1');
select pg_temp.raises(
  $$select * from public.erp_outbox_claim(10, null, 'f1121000-0000-0000-0000-00000000000b')$$,
  '42501', 'logística A no procesa reportes de B');
insert into trz112_claimed select 'A', c.id, c.company_id from public.erp_outbox_claim(10, null, null) c;
select pg_temp.check(
  (select array_agg(id order by id) from trz112_claimed where who = 'A') = array['f1128000-0000-0000-0000-0000000000a1'::uuid],
  'sin p_company_id, logística A toma solo los de A');
select pg_temp.check(
  (select bool_and(company_id = 'f1121000-0000-0000-0000-00000000000a') from trz112_claimed where who = 'A'),
  'el claim devuelve la empresa de cada evento');
select pg_temp.check(public.erp_outbox_mark_sent('f1128000-0000-0000-0000-0000000000a1', 1, 'DN-A', false), 'A cierra su envío');
select pg_temp.check(not public.erp_outbox_mark_sent('f1128000-0000-0000-0000-0000000000b1', 0, 'DN-X', false), 'A no cierra un evento de B');
select pg_temp.raises($$select public.erp_outbox_retry_failed('f1128000-0000-0000-0000-0000000000b2')$$, 'P0002', 'A no reintenta un evento de B');

-- Reintento en B: vuelve a pendiente y solo lo toma B.
select pg_temp.as_user('f1120000-0000-0000-0000-0000000000b1');
select pg_temp.check(public.erp_outbox_retry_failed('f1128000-0000-0000-0000-0000000000b2') is not null, 'B reintenta su evento fallido');
reset role;

/* ---------- Cron (service_role): empresa por empresa ---------- */

set local role service_role;
select pg_temp.as_service();
select pg_temp.check(
  (select array_agg(company_id order by company_id) from public.erp_outbox_due_companies()
   where company_id in ('f1121000-0000-0000-0000-00000000000a', 'f1121000-0000-0000-0000-00000000000b'))
  = array['f1121000-0000-0000-0000-00000000000b'::uuid],
  'solo B tiene reportes vencidos (el de A ya se envió)');
insert into trz112_claimed select 'cron-A', c.id, c.company_id from public.erp_outbox_claim(50, null, 'f1121000-0000-0000-0000-00000000000a') c;
select pg_temp.check(not exists (select 1 from trz112_claimed where who = 'cron-A'), 'con p_company_id = A no toma nada de B');
insert into trz112_claimed select 'cron-B', c.id, c.company_id from public.erp_outbox_claim(50, null, 'f1121000-0000-0000-0000-00000000000b') c;
select pg_temp.check(
  (select array_agg(id order by id) from trz112_claimed where who = 'cron-B')
  = array['f1128000-0000-0000-0000-0000000000b1'::uuid, 'f1128000-0000-0000-0000-0000000000b2'::uuid],
  'con p_company_id = B toma el pendiente y el reintentado de B');
select pg_temp.check(
  public.erp_outbox_mark_failed('f1128000-0000-0000-0000-0000000000b1', 1, 'timeout', 'El ERP de B no respondió.', true) = 'pending',
  'una falla de B queda con backoff');
select pg_temp.check(
  (select status from public.erp_outbox_events where id = 'f1128000-0000-0000-0000-0000000000a1') = 'sent',
  'la falla de B no toca el envío de A');
reset role;

/* ---------- Desactivar y ERP simulado ---------- */

set local role authenticated;
select pg_temp.as_user('f1120000-0000-0000-0000-0000000000a1');
select public.erp_save_company_config('mock', null, null, null, null, null, 'timeout', 'draft', 'no-se-guarda', null);
select pg_temp.check(
  (select (erp_provider, erp_mock_scenario, erp_mock_dispatch_status, erp_base_url, erp_api_key_hint)
     is not distinct from ('mock', 'timeout', 'draft', null::text, null::text)
   from public.erp_company_settings where company_id = 'f1121000-0000-0000-0000-00000000000a'),
  'el mock no guarda URL ni credenciales');
select public.erp_save_company_config(null);
select pg_temp.check(public.erp_company_provider('f1121000-0000-0000-0000-00000000000a') is null, 'A vuelve a modo manual');
reset role;
select pg_temp.check(
  not exists (select 1 from public.erp_company_credentials where company_id = 'f1121000-0000-0000-0000-00000000000a'),
  'sin ERP no queda ningún secreto de A');
select pg_temp.check(
  exists (select 1 from public.erp_company_credentials where company_id = 'f1121000-0000-0000-0000-00000000000b'),
  'los de B siguen');

rollback;
