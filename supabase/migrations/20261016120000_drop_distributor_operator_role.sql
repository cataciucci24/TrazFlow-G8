-- TRZ-91: eliminar el rol histórico `distributor_operator` del enum user_role.
--
-- Postgres no permite borrar un valor de un enum, así que se recrea el tipo:
--   1. Se guardan y borran las policies que dependen del tipo, de auth_role()
--      o de las columnas que cambian de tipo (Postgres no deja alterar una
--      columna usada en una policy).
--   2. Se borran las funciones atadas al tipo por su firma (auth_role,
--      get_company_operators) y las que solo servían al rol viejo.
--   3. Se cambia el tipo de users.role y order_notifications.visible_roles.
--   4. Se recrean funciones y policies, salvo las del rol viejo.
--
-- Prerrequisito: no puede quedar ningún usuario ni solicitud pendiente con el
-- rol viejo (ver docs/transicion-choferes.md). Si queda alguno, la migración
-- aborta.

do $$
begin
  if exists (select 1 from public.users where role = 'distributor_operator') then
    raise exception 'Quedan usuarios con role = distributor_operator: migrarlos antes (docs/transicion-choferes.md)';
  end if;
  if exists (select 1 from public.access_requests where requested_role = 'distributor_operator' and status = 'pending') then
    raise exception 'Quedan solicitudes pendientes con requested_role = distributor_operator';
  end if;
end;
$$;

-- 1. Policies afectadas: se guarda su definición tal como está hoy y se borran.
create temporary table trz91_policies on commit drop as
select pol.polname, n.nspname, c.relname, p.permissive, p.cmd, p.roles, p.qual, p.with_check
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname and p.policyname = pol.polname
where exists (
  select 1 from pg_depend d
  where d.classid = 'pg_policy'::regclass
    and d.objid = pol.oid
    and (
      d.refobjid in ('public.user_role'::regtype, 'public.auth_role()'::regprocedure)
      or (d.refobjid = 'public.users'::regclass
          and d.refobjsubid = (select attnum from pg_attribute where attrelid = 'public.users'::regclass and attname = 'role'))
      or (d.refobjid = 'public.order_notifications'::regclass
          and d.refobjsubid = (select attnum from pg_attribute where attrelid = 'public.order_notifications'::regclass and attname = 'visible_roles'))
    )
);

do $$
declare policy record;
begin
  for policy in select * from trz91_policies loop
    execute format('drop policy %I on %I.%I', policy.polname, policy.nspname, policy.relname);
  end loop;
end;
$$;

-- Funciones que hay que recompilar contra el tipo nuevo (mencionan user_role
-- en el cuerpo). auth_role y get_company_operators además tienen el tipo en la
-- firma, así que se borran y se recrean.
create temporary table trz91_functions on commit drop as
select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ~ 'user_role'
  and pg_get_functiondef(p.oid) !~ 'distributor_operator';

-- 2. Funciones que solo podía usar el rol viejo. En la app solo las llamaba
-- código que ya no se renderiza (recepción de distribuidor y vínculo
-- operador-distribuidor); el flujo vigente es el de choferes.
drop function if exists public.receive_order_pallet(uuid, text, text);
drop function if exists public.receive_order_pallet(uuid, text);
drop function if exists public.get_order_pallet_receptions(uuid);
drop function if exists public.save_distributor_stock(uuid, numeric, jsonb);
drop function if exists public.assign_operator_distributor(uuid, uuid);

drop function public.auth_role();
drop function public.get_company_operators();

-- 3. Tipo nuevo, sin el valor histórico.
alter type public.user_role rename to user_role_old;
create type public.user_role as enum ('logistics_manager', 'warehouse_operator', 'driver_operator');

alter table public.users
  alter column role type public.user_role using role::text::public.user_role;

alter table public.order_notifications alter column visible_roles drop default;
alter table public.order_notifications
  alter column visible_roles type public.user_role[]
  using array_remove(visible_roles::text[], 'distributor_operator')::public.user_role[];
alter table public.order_notifications
  alter column visible_roles set default array['logistics_manager', 'warehouse_operator']::public.user_role[];

drop type public.user_role_old;

-- 4. Funciones: misma definición, ahora contra el tipo nuevo.
do $$
declare fn record;
begin
  for fn in select * from trz91_functions loop
    execute fn.definition;
  end loop;
end;
$$;

revoke all on function public.auth_role() from public, anon;
grant execute on function public.auth_role() to authenticated, service_role;

revoke all on function public.get_company_operators() from public, anon, service_role;
grant execute on function public.get_company_operators() to authenticated;

-- Policies: se recrean todas menos las de lectura de stock del rol viejo.
do $$
declare
  policy record;
  role_list text;
begin
  for policy in
    select * from trz91_policies
    where polname not in ('distributor_batch_stocks_operator', 'distributor_product_stocks_operator')
  loop
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
      into role_list
      from unnest(policy.roles) as r;

    execute format(
      'create policy %I on %I.%I as %s for %s to %s%s%s',
      policy.polname, policy.nspname, policy.relname,
      policy.permissive, policy.cmd, role_list,
      case when policy.qual is null then '' else format(' using (%s)', policy.qual) end,
      case when policy.with_check is null then '' else format(' with check (%s)', policy.with_check) end
    );
  end loop;
end;
$$;

-- Solicitudes de acceso: el rol viejo ya no se puede pedir. requested_role es
-- text, así que las solicitudes ya resueltas conservan el valor como historial.
alter table public.access_requests drop constraint access_requests_requested_role_check;
alter table public.access_requests add constraint access_requests_requested_role_check
  check (
    requested_role in ('warehouse_operator', 'driver_operator')
    or (requested_role = 'distributor_operator' and status <> 'pending')
  );
