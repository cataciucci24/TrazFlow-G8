-- ============================================================================
-- Migración: 0003_fix_default_privileges.sql
-- ============================================================================
-- Causa raíz:
--   El rol `postgres` (con el que corren las migraciones) tiene un
--   ALTER DEFAULT PRIVILEGES que revoca SELECT/INSERT/UPDATE/DELETE sobre
--   tablas nuevas para anon, authenticated y service_role.
--   Resultado: toda tabla creada en el schema public nace sin esos permisos
--   básicos a nivel tabla, independientemente de lo que digan las policies
--   de RLS. En Postgres el chequeo de GRANT a nivel tabla ocurre ANTES de
--   evaluar RLS, así que sin SELECT sobre la tabla, la policy nunca llega
--   a evaluarse (esto también afecta a service_role, ya que rolbypassrls
--   solo saltea las policies, no el chequeo de privilegio de tabla).
--
-- Este fix hace dos cosas:
--   1) Otorga los GRANTs que faltan sobre las tablas YA existentes.
--   2) Corrige el default privilege para que las tablas FUTURAS (creadas
--      por migraciones que corren como `postgres`) nazcan con los permisos
--      correctos, sin depender de acordarse de hacer GRANT a mano cada vez.
--
-- Modelo de acceso de TrazFlow:
--   - anon: SIN acceso a las tablas de negocio. El sistema no tiene acceso
--     público/sin login (3 roles: responsable logístico, operador de
--     depósito, operador del distribuidor), así que anon no recibe GRANTs.
--   - authenticated: acceso completo a nivel tabla (SELECT/INSERT/UPDATE/
--     DELETE); el control real de "quién puede ver/tocar qué fila" lo
--     hacen las policies de RLS ya existentes (users_select, etc.).
--   - service_role: acceso completo, uso exclusivo server-side.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) GRANTs sobre las tablas existentes del schema public
-- ----------------------------------------------------------------------------

-- authenticated: permisos a nivel tabla. RLS sigue siendo la capa que
-- filtra filas según company_id / rol del usuario.
grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

-- service_role: acceso administrativo completo (uso server-side únicamente).
grant select, insert, update, delete
  on all tables in schema public
  to service_role;

-- anon: sin GRANTs sobre tablas de negocio. Si en el futuro se agrega algún
-- endpoint público (ej. tracking público de un pallet por código sin login),
-- se otorga select puntual sobre esa tabla específica, no en bloque acá.

-- Secuencias (necesario si alguna tabla usa serial/identity y las queries
-- de authenticated necesitan currval/nextval, ej. al hacer INSERT):
grant usage, select on all sequences in schema public to authenticated;
grant usage, select on all sequences in schema public to service_role;

-- ----------------------------------------------------------------------------
-- 2) Default privileges: que las tablas futuras nazcan bien
-- ----------------------------------------------------------------------------
-- Esto sobrescribe el default privilege problemático que dejó sin permisos
-- a las tablas creadas después de él. Se define para el rol `postgres`
-- porque es el rol con el que corren las migraciones.

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

-- Nota: no se agrega un default privilege para anon a propósito. Si el
-- equipo decide en algún sprint futuro exponer algo público, se hace el
-- GRANT explícito sobre esa tabla puntual en su propia migración.