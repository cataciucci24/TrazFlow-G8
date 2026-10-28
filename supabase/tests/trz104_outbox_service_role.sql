-- TRZ-104: el cron procesa el outbox con service_role, sin usuario, para todas las empresas.
-- Ejecutar con psql -v ON_ERROR_STOP=1 sobre una base local migrada. Todo se revierte al final.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'TRZ-104: %', message; end if;
end;
$$;

insert into companies (id, name) values
  ('c1040000-0000-0000-0000-00000000000a', 'TRZ-104 Empresa A'),
  ('c1040000-0000-0000-0000-00000000000b', 'TRZ-104 Empresa B');

-- A1 y B1 vencidos; A2 con el próximo intento en el futuro (backoff); B2 ya enviado.
insert into erp_outbox_events (id, company_id, event_type, aggregate_id, idempotency_key, payload, status, attempts, next_attempt_at, sent_at) values
  ('c1048000-0000-0000-0000-0000000000a1', 'c1040000-0000-0000-0000-00000000000a', 'dispatch_confirmed', gen_random_uuid(),
   'dispatch:TRZ104-A1', '{"idempotencyKey":"dispatch:TRZ104-A1"}', 'pending', 1, now() - interval '1 minute', null),
  ('c1048000-0000-0000-0000-0000000000a2', 'c1040000-0000-0000-0000-00000000000a', 'dispatch_confirmed', gen_random_uuid(),
   'dispatch:TRZ104-A2', '{"idempotencyKey":"dispatch:TRZ104-A2"}', 'pending', 2, now() + interval '10 minutes', null),
  ('c1048000-0000-0000-0000-0000000000b1', 'c1040000-0000-0000-0000-00000000000b', 'dispatch_confirmed', gen_random_uuid(),
   'dispatch:TRZ104-B1', '{"idempotencyKey":"dispatch:TRZ104-B1"}', 'pending', 0, now() - interval '5 seconds', null),
  ('c1048000-0000-0000-0000-0000000000b2', 'c1040000-0000-0000-0000-00000000000b', 'dispatch_confirmed', gen_random_uuid(),
   'dispatch:TRZ104-B2', '{"idempotencyKey":"dispatch:TRZ104-B2"}', 'sent', 1, now() - interval '1 hour', now() - interval '1 hour');

create temp table trz104_claimed (round integer, id uuid, attempts integer);
grant all on trz104_claimed to service_role, authenticated;

/* ---------- Privilegios ---------- */

select pg_temp.assert_true(has_function_privilege('service_role', 'public.erp_outbox_claim(integer, uuid)', 'execute'), 'service_role toma eventos');
select pg_temp.assert_true(has_function_privilege('service_role', 'public.erp_outbox_mark_sent(uuid, integer, text, boolean)', 'execute'), 'service_role cierra envíos');
select pg_temp.assert_true(has_function_privilege('service_role', 'public.erp_outbox_mark_failed(uuid, integer, text, text, boolean)', 'execute'), 'service_role registra fallas');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.erp_outbox_claim(integer, uuid)', 'execute'), 'anon no procesa');
select pg_temp.assert_true(not has_table_privilege('service_role', 'public.erp_outbox_events', 'update'), 'service_role escribe solo vía RPC');

/* ---------- Claim con service_role ---------- */

set local role service_role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true);

insert into trz104_claimed select 1, claimed.id, claimed.attempts from public.erp_outbox_claim(50, null) claimed;

select pg_temp.assert_true(
  exists (select 1 from trz104_claimed where round = 1 and id = 'c1048000-0000-0000-0000-0000000000a1'),
  'toma el vencido de la empresa A');
select pg_temp.assert_true(
  exists (select 1 from trz104_claimed where round = 1 and id = 'c1048000-0000-0000-0000-0000000000b1'),
  'toma el vencido de la empresa B en la misma corrida');
select pg_temp.assert_true(
  not exists (select 1 from trz104_claimed where id = 'c1048000-0000-0000-0000-0000000000a2'),
  'respeta next_attempt_at futuro (backoff)');
select pg_temp.assert_true(
  not exists (select 1 from trz104_claimed where id = 'c1048000-0000-0000-0000-0000000000b2'),
  'no toma los ya enviados');
select pg_temp.assert_true(
  (select attempts from trz104_claimed where id = 'c1048000-0000-0000-0000-0000000000a1') = 2,
  'suma el intento al tomarlo');

-- Una segunda corrida (otro cron que se solapa) dentro del lease no los vuelve a tomar.
insert into trz104_claimed select 2, claimed.id, claimed.attempts from public.erp_outbox_claim(50, null) claimed;
select pg_temp.assert_true(
  not exists (select 1 from trz104_claimed where round = 2
              and id in ('c1048000-0000-0000-0000-0000000000a1', 'c1048000-0000-0000-0000-0000000000b1')),
  'dentro del lease una segunda corrida no toma los mismos eventos');

-- Cierra uno como enviado y el otro como reintentable: el backoff lo decide la base.
select pg_temp.assert_true(
  public.erp_outbox_mark_sent('c1048000-0000-0000-0000-0000000000a1', 2, 'DN-TRZ104-A1', false),
  'service_role marca enviado un evento de A');
select pg_temp.assert_true(
  public.erp_outbox_mark_failed('c1048000-0000-0000-0000-0000000000b1', 1, 'timeout', 'El ERP no respondió.', true) = 'pending',
  'service_role deja pendiente con backoff un evento de B');
-- Un resultado viejo (intento que ya no es el vigente) se descarta.
select pg_temp.assert_true(
  not public.erp_outbox_mark_sent('c1048000-0000-0000-0000-0000000000b1', 0, 'DN-VIEJO', false),
  'un resultado de un intento viejo no se registra');

reset role;

select pg_temp.assert_true(
  (select status = 'sent' and erp_reference = 'DN-TRZ104-A1' and locked_until is null
   from erp_outbox_events where id = 'c1048000-0000-0000-0000-0000000000a1'),
  'A1 queda enviado');
select pg_temp.assert_true(
  (select status = 'pending' and next_attempt_at > now() and locked_until is null
   from erp_outbox_events where id = 'c1048000-0000-0000-0000-0000000000b1'),
  'B1 queda pendiente con el próximo intento en el futuro');

-- Con el lease vencido (el procesador anterior se cortó), el evento se vuelve a tomar.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into trz104_claimed select 3, claimed.id, claimed.attempts from public.erp_outbox_claim(50, null) claimed;
reset role;
select pg_temp.assert_true(
  not exists (select 1 from trz104_claimed where round = 3 and id = 'c1048000-0000-0000-0000-0000000000b1'),
  'B1 no se toma antes de su backoff');

/* ---------- Un usuario sigue limitado a su empresa ---------- */

insert into auth.users (id, email) values ('c1041000-0000-0000-0000-00000000000a', 'trz104-logistica-a@test.local');
insert into users (id, company_id, name, email, role) values
  ('c1041000-0000-0000-0000-00000000000a', 'c1040000-0000-0000-0000-00000000000a', 'Logística A', 'trz104-logistica-a@test.local', 'logistics_manager');
update erp_outbox_events set next_attempt_at = now() - interval '1 second'
where id = 'c1048000-0000-0000-0000-0000000000b1';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1041000-0000-0000-0000-00000000000a', true),
       set_config('request.jwt.claim.role', 'authenticated', true);
insert into trz104_claimed select 4, claimed.id, claimed.attempts from public.erp_outbox_claim(50, null) claimed;
reset role;
select pg_temp.assert_true(
  not exists (select 1 from trz104_claimed where round = 4 and id = 'c1048000-0000-0000-0000-0000000000b1'),
  'logística de A no toma eventos de B');

rollback;
