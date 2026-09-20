-- ============================================================================
-- Migración: revoke_anon_privileges
-- ============================================================================
-- Contexto:
--   La migración 20260830234815_fix_default_privileges documenta que `anon`
--   no debe tener acceso a las tablas de negocio, pero nunca hizo REVOKE:
--   solo otorgó GRANTs a authenticated y service_role. En una base creada
--   desde cero (supabase db reset, staging, proyecto nuevo) `anon` queda con
--   los defaults de Supabase (arwdDxtm sobre tablas nuevas de `public`).
--   En el proyecto remoto ese estado se corrigió a mano desde el SQL Editor,
--   sin migración, por lo que repo y remoto estaban desincronizados.
--
-- Esta migración deja a `anon` sin acceso en cualquier base, y es idempotente:
-- aplicarla sobre el remoto (ya corregido a mano) solo elimina los permisos
-- residuales TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
--
-- El frontend no usa `anon` para leer datos: toda consulta corre con la
-- sesión del usuario (rol `authenticated`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tablas y secuencias existentes: anon sin acceso
-- ----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ----------------------------------------------------------------------------
-- 2) Defaults: que los objetos futuros creados por `postgres` no se otorguen
--    a anon (las migraciones corren como `postgres`).
-- ----------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- ----------------------------------------------------------------------------
-- 3) Funciones SECURITY DEFINER expuestas vía /rest/v1/rpc a anon
-- ----------------------------------------------------------------------------
-- En una base desde cero las funciones nacen con EXECUTE explícito para anon.
-- authenticated y service_role conservan sus grants explícitos.
revoke execute on all functions in schema public from anon;
-- set_updated_at es función de trigger (no se chequea EXECUTE al dispararse).
revoke execute on function public.set_updated_at() from public;

-- Los helpers de RLS los evalúan las policies con el rol `authenticated`, por
-- eso se revoca a PUBLIC/anon y se otorga explícitamente a authenticated y
-- service_role (revocar solo de PUBLIC sin este GRANT rompería todas las
-- policies).
revoke execute on function public.auth_company_id() from public, anon;
revoke execute on function public.auth_role() from public, anon;
revoke execute on function public.operates_for_distributor(uuid) from public, anon;

grant execute on function public.auth_company_id() to authenticated, service_role;
grant execute on function public.auth_role() to authenticated, service_role;
grant execute on function public.operates_for_distributor(uuid) to authenticated, service_role;

-- rls_auto_enable() es la función del event trigger `ensure_rls`. Los event
-- triggers no requieren EXECUTE del rol que ejecuta el DDL, y no debe ser
-- invocable como RPC por nadie. Existe en el proyecto remoto pero no la crea
-- ninguna migración del repo, por eso el REVOKE es condicional.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
