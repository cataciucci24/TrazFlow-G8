-- ============================================================
-- FIX: recursión infinita en RLS
-- Las funciones helper que usan las políticas (auth_company_id,
-- auth_role, operates_for_distributor) consultan la tabla "users",
-- que también tiene RLS activado. Sin SECURITY DEFINER, esa consulta
-- interna vuelve a evaluar la misma política, entrando en un loop
-- que termina devolviendo cero filas (el síntoma: "usuario sin perfil"
-- aunque la fila exista).
--
-- SECURITY DEFINER hace que la función corra con los permisos de
-- quien la creó (bypaseando RLS solo en esa consulta interna),
-- rompiendo el ciclo. set search_path = public es buena práctica
-- de seguridad para evitar que alguien manipule el search_path
-- y la función termine leyendo de una tabla maliciosa con el mismo nombre.
-- ============================================================

create or replace function auth_company_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select company_id from users where id = auth.uid();
$$;

create or replace function auth_role()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from users where id = auth.uid();
$$;

create or replace function operates_for_distributor(dist_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from distributor_users
    where distributor_id = dist_id and user_id = auth.uid()
  );
$$;
