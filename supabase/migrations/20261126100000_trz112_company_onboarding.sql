-- TRZ-112 (parte 2): alta de empresa desde la app.
--
-- Hasta acá las empresas se cargaban a mano en la base y el registro solo permitía sumarse a una existente
-- (US27 + US30). Desde esta migración, un usuario con email confirmado y sin perfil puede dar de alta su empresa:
--
--   * create_company_with_manager crea, en UNA transacción, la empresa, su perfil logistics_manager, el plan
--     elegido (solo planes con precio publicado: Starter o Growth; Enterprise es gestión comercial, como en
--     TRZ-44/45) y el depósito DEP-01 "Depósito principal" (transitorio hasta TRZ-116; igual al que TRZ-101 les
--     creó a las empresas que ya existían). Si algo falla, no queda nada a medias.
--   * La empresa arranca SIN ERP (no se crea erp_company_settings): trabaja en modo manual hasta que logística
--     configure uno en Integración ERP → Configuración.
--   * El CUIT es único sin importar guiones o espacios (índice sobre los dígitos). Se valida (11 dígitos, prefijo
--     y dígito verificador) solo en la RPC, no con un check en la tabla: el CUIT de TrazFlow Demo cargado a mano
--     no tiene un dígito verificador válido y no se toca.
--   * get_signup_plans muestra los planes elegibles a quien todavía no tiene perfil (la RLS de
--     subscription_plans solo deja leer el catálogo a logística).
--
-- No cambia ninguna política RLS: los datos de la empresa nueva quedan aislados por company_id como los demás.

/* ---------- CUIT único (sin importar el formato) ---------- */

-- Falla si dos empresas ya tienen el mismo CUIT con distinto formato: hay que resolverlo a mano antes.
create unique index companies_tax_id_digits_key on public.companies ((regexp_replace(tax_id, '[^0-9]', '', 'g')))
  where tax_id is not null;

/* ---------- Validación de CUIT ---------- */

-- Recibe 11 dígitos. Mismo algoritmo que src/lib/registration/cuit.ts (mantenerlos iguales).
create function public.is_valid_cuit(p_digits text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  weights constant int[] := array[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  total int := 0;
  check_digit int;
begin
  if p_digits is null or p_digits !~ '^(20|23|24|27|30|33|34)[0-9]{9}$' then return false; end if;
  for i in 1..10 loop
    total := total + substr(p_digits, i, 1)::int * weights[i];
  end loop;
  check_digit := 11 - (total % 11);
  if check_digit = 11 then check_digit := 0; end if;
  -- Un resto que da 10 no es un CUIT válido (AFIP cambia el prefijo a 23/33 en ese caso).
  return check_digit < 10 and check_digit = substr(p_digits, 11, 1)::int;
end;
$$;

revoke all on function public.is_valid_cuit(text) from public, anon, authenticated, service_role;

/* ---------- Planes elegibles en el alta ---------- */

create function public.get_signup_plans()
returns table (
  code text, name text, monthly_price_cents integer, currency text,
  max_operators integer, max_pallets_per_month integer, preliminary boolean
)
language sql stable security definer
set search_path = ''
as $$
  select plan.code, plan.name, plan.monthly_price_cents, plan.currency,
    plan.max_operators, plan.max_pallets_per_month, plan.preliminary
  from public.subscription_plans plan
  where plan.monthly_price_cents is not null
    and (select auth.uid()) is not null
    and not exists (select 1 from public.users profile where profile.id = (select auth.uid()))
  order by plan.display_order;
$$;

revoke all on function public.get_signup_plans() from public, anon, service_role;
grant execute on function public.get_signup_plans() to authenticated;

/* ---------- Alta de empresa ---------- */

-- Errores (mensajes en src/lib/registration/company.ts):
--   42501 sin sesión · P4101 email sin confirmar · P4102 cuenta sin email · P4103 nombre de la persona inválido
--   P4104 ya tiene perfil · P4105 tiene una solicitud pendiente · P4106 nombre de empresa inválido
--   P4107 CUIT inválido · P4108 CUIT ya registrado · P4109 plan no elegible
create function public.create_company_with_manager(p_company_name text, p_tax_id text, p_plan_code text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  -- Mismos espacios exteriores que String.trim(), como approve_access_request.
  spaces constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_uid uuid := auth.uid();
  account auth.users%rowtype;
  declared_name text;
  company_name text;
  digits text;
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;

  select a.* into account from auth.users a where a.id = v_uid for update;
  if not found then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  if account.email_confirmed_at is null then
    raise exception 'Confirmá tu email antes de dar de alta la empresa' using errcode = 'P4101';
  end if;
  if account.email is null or btrim(account.email) = '' then
    raise exception 'Cuenta sin email disponible' using errcode = 'P4102';
  end if;
  if jsonb_typeof(account.raw_user_meta_data -> 'name') is distinct from 'string' then
    raise exception 'Completá tu nombre' using errcode = 'P4103';
  end if;
  declared_name := btrim(account.raw_user_meta_data ->> 'name', spaces);
  if declared_name = '' or char_length(declared_name) > 100 then
    raise exception 'Completá un nombre válido' using errcode = 'P4103';
  end if;

  -- Una empresa por usuario: quien ya tiene perfil (de esta u otra empresa) no crea otra.
  if exists (select 1 from public.users u where u.id = v_uid) then
    raise exception 'El usuario ya tiene perfil operativo' using errcode = 'P4104';
  end if;
  -- Con una solicitud pendiente, primero hay que esperar la respuesta. Una rechazada no impide el alta.
  if exists (select 1 from public.access_requests r where r.user_id = v_uid and r.status = 'pending') then
    raise exception 'Tenés una solicitud de acceso pendiente' using errcode = 'P4105';
  end if;

  company_name := btrim(coalesce(p_company_name, ''), spaces);
  if char_length(company_name) < 2 or char_length(company_name) > 140 then
    raise exception 'Nombre de empresa inválido' using errcode = 'P4106';
  end if;

  if p_tax_id is null or p_tax_id !~ '^[0-9 .-]+$' then
    raise exception 'CUIT inválido' using errcode = 'P4107';
  end if;
  digits := regexp_replace(p_tax_id, '[^0-9]', '', 'g');
  if not public.is_valid_cuit(digits) then
    raise exception 'CUIT inválido' using errcode = 'P4107';
  end if;
  if exists (select 1 from public.companies c where regexp_replace(c.tax_id, '[^0-9]', '', 'g') = digits) then
    raise exception 'Ya hay una empresa con ese CUIT' using errcode = 'P4108';
  end if;

  if not exists (
    select 1 from public.subscription_plans plan
    where plan.code = p_plan_code and plan.monthly_price_cents is not null
  ) then
    raise exception 'Plan no disponible para el alta' using errcode = 'P4109';
  end if;

  begin
    insert into public.companies (name, tax_id)
      values (company_name, substr(digits, 1, 2) || '-' || substr(digits, 3, 8) || '-' || substr(digits, 11, 1))
      returning id into v_company;
  exception when unique_violation then
    -- Dos altas simultáneas con el mismo CUIT: la segunda llega acá.
    raise exception 'Ya hay una empresa con ese CUIT' using errcode = 'P4108';
  end;

  -- Si este insert choca (dos altas simultáneas del mismo usuario), se revierte todo, también la empresa.
  insert into public.users (id, company_id, name, email, role)
    values (v_uid, v_company, declared_name, account.email, 'logistics_manager');
  insert into public.company_plans (company_id, plan_code) values (v_company, p_plan_code);
  insert into public.warehouses (company_id, code, name) values (v_company, 'DEP-01', 'Depósito principal');

  return v_company;
end;
$$;

revoke all on function public.create_company_with_manager(text, text, text) from public, anon, service_role;
grant execute on function public.create_company_with_manager(text, text, text) to authenticated;

comment on function public.create_company_with_manager(text, text, text) is
  'TRZ-112: alta de empresa con su primer logistics_manager, plan elegido y DEP-01, en una sola transacción.';
