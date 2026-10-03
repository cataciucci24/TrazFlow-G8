-- TRZ-19 (US17) y TRZ-38 (US31): gestión de operadores por el responsable logístico.
-- Ver docs/modelo-de-roles.md.
--
-- * Vincular un distributor_operator a un distribuidor de su empresa (distributor_users).
-- * Rechazar solicitudes de acceso pendientes.
-- * Revocar y restaurar el acceso de operadores sin borrar su perfil: la fila en
--   users sigue siendo el autor de eventos, movimientos y validaciones (FKs sin
--   cascade), así que la auditoría queda intacta.

-- ------------------------------------------------------------
-- 1. Revocación: columna + helpers de RLS que ignoran perfiles revocados
-- ------------------------------------------------------------
alter table public.users add column revoked_at timestamptz;

-- Todas las policies multiempresa pasan por estos helpers: con devolver null o
-- false para un perfil revocado, el usuario pierde acceso a todas las tablas sin
-- tocar cada policy.
create or replace function public.auth_company_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select company_id from users where id = auth.uid() and revoked_at is null;
$$;

create or replace function public.auth_role()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from users where id = auth.uid() and revoked_at is null;
$$;

create or replace function public.operates_for_distributor(dist_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from distributor_users du
    join users u on u.id = du.user_id
    where du.distributor_id = dist_id and du.user_id = auth.uid() and u.revoked_at is null
  );
$$;

-- Cada usuario puede leer su propia fila aunque esté revocado, para que la app
-- distinga "acceso revocado" de "perfil inexistente".
create policy users_select_self on public.users
  for select to authenticated
  using (id = (select auth.uid()));

-- Responsable logístico activo que invoca; null si no lo es.
create function public.active_manager_company_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select u.company_id from public.users u
  where u.id = auth.uid() and u.role = 'logistics_manager' and u.revoked_at is null;
$$;
-- Supabase concede execute a authenticated por defecto: se revoca explícitamente
-- porque solo lo usan las funciones de este archivo.
revoke all on function public.active_manager_company_id() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Listado de operadores de la empresa (pestaña "Operadores")
-- ------------------------------------------------------------
-- in_transit_orders y other_active_operators alimentan el aviso antes de
-- reasignar o revocar: el distribuidor actual puede quedar sin nadie que reciba
-- sus órdenes confirmadas.
create function public.get_company_operators()
returns table (
  user_id uuid, name text, email text, role public.user_role, revoked_at timestamptz,
  distributor_id uuid, distributor_name text,
  in_transit_orders integer, other_active_operators integer
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  caller_company uuid := public.active_manager_company_id();
begin
  if caller_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;

  return query
  select u.id, u.name, u.email, u.role, u.revoked_at, d.id, d.name,
    (select count(*)::integer from public.dispatch_orders o
      where o.distributor_id = d.id and o.status = 'confirmed'),
    (select count(*)::integer from public.distributor_users other
      join public.users ou on ou.id = other.user_id
      where other.distributor_id = d.id and other.user_id <> u.id and ou.revoked_at is null)
  from public.users u
  left join public.distributor_users du on du.user_id = u.id
  left join public.distributors d on d.id = du.distributor_id
  where u.company_id = caller_company
    and u.role in ('warehouse_operator', 'distributor_operator')
  order by u.revoked_at is not null, u.name, u.id;
end;
$$;
revoke all on function public.get_company_operators() from public, anon, service_role;
grant execute on function public.get_company_operators() to authenticated;

-- ------------------------------------------------------------
-- 3. TRZ-19: vincular operador a distribuidor
-- ------------------------------------------------------------
create function public.assign_operator_distributor(p_user_id uuid, p_distributor_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid := public.active_manager_company_id();
  operator public.users%rowtype;
begin
  if manager_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  select u.* into operator from public.users u
    where u.id = p_user_id and u.company_id = manager_company for update;
  if not found then
    raise exception 'Operador no disponible' using errcode = 'P3801';
  end if;
  if operator.role <> 'distributor_operator' then
    raise exception 'Solo se vinculan operadores de distribuidor' using errcode = 'P3802';
  end if;
  if operator.revoked_at is not null then
    raise exception 'El operador tiene el acceso revocado' using errcode = 'P3804';
  end if;
  if not exists (select 1 from public.distributors d
      where d.id = p_distributor_id and d.company_id = manager_company) then
    raise exception 'Distribuidor no disponible' using errcode = 'P3803';
  end if;

  -- Un operador representa a un solo distribuidor (índice único sobre user_id):
  -- vincular de nuevo reemplaza el vínculo anterior.
  insert into public.distributor_users (distributor_id, user_id)
    values (p_distributor_id, p_user_id)
    on conflict (user_id) do update set distributor_id = excluded.distributor_id;
end;
$$;
revoke all on function public.assign_operator_distributor(uuid, uuid) from public, anon, service_role;
grant execute on function public.assign_operator_distributor(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. TRZ-38: rechazar solicitud
-- ------------------------------------------------------------
create function public.reject_access_request(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid := public.active_manager_company_id();
  request public.access_requests%rowtype;
begin
  if manager_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  select ar.* into request from public.access_requests ar
    where ar.id = p_request_id and ar.company_id = manager_company for update;
  if not found then
    raise exception 'Solicitud no disponible' using errcode = 'P3811';
  end if;
  if request.status <> 'pending' then
    raise exception 'La solicitud ya no está pendiente' using errcode = 'P3812';
  end if;
  update public.access_requests set status = 'rejected' where id = request.id;
end;
$$;
revoke all on function public.reject_access_request(uuid) from public, anon, service_role;
grant execute on function public.reject_access_request(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. TRZ-38: revocar y restaurar acceso de operadores
-- ------------------------------------------------------------
-- Solo operadores: un responsable logístico no puede revocar a otro ni a sí mismo.
create function public.revoke_operator_access(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid := public.active_manager_company_id();
  operator public.users%rowtype;
begin
  if manager_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  select u.* into operator from public.users u
    where u.id = p_user_id and u.company_id = manager_company for update;
  if not found then
    raise exception 'Operador no disponible' using errcode = 'P3821';
  end if;
  if operator.role not in ('warehouse_operator', 'distributor_operator') then
    raise exception 'Solo se revoca el acceso de operadores' using errcode = 'P3822';
  end if;
  if operator.revoked_at is not null then
    raise exception 'El acceso ya está revocado' using errcode = 'P3823';
  end if;
  update public.users set revoked_at = now() where id = operator.id;
  -- Al restaurar, el distribuidor se vuelve a asignar explícitamente.
  delete from public.distributor_users where user_id = operator.id;
end;
$$;
revoke all on function public.revoke_operator_access(uuid) from public, anon, service_role;
grant execute on function public.revoke_operator_access(uuid) to authenticated;

create function public.restore_operator_access(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid := public.active_manager_company_id();
  operator public.users%rowtype;
begin
  if manager_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  select u.* into operator from public.users u
    where u.id = p_user_id and u.company_id = manager_company for update;
  if not found then
    raise exception 'Operador no disponible' using errcode = 'P3821';
  end if;
  if operator.role not in ('warehouse_operator', 'distributor_operator') then
    raise exception 'Solo se restaura el acceso de operadores' using errcode = 'P3822';
  end if;
  if operator.revoked_at is null then
    raise exception 'El acceso no está revocado' using errcode = 'P3824';
  end if;
  update public.users set revoked_at = null where id = operator.id;
end;
$$;
revoke all on function public.restore_operator_access(uuid) from public, anon, service_role;
grant execute on function public.restore_operator_access(uuid) to authenticated;
