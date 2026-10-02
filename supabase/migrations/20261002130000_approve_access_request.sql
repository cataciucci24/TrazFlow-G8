create function public.approve_access_request(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  manager_company uuid;
  request public.access_requests%rowtype;
  account auth.users%rowtype;
  declared_name text;
begin
  if auth.uid() is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  select u.company_id into manager_company from public.users u
    where u.id = auth.uid() and u.role = 'logistics_manager' for share;
  if manager_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  select ar.* into request from public.access_requests ar
    where ar.id = p_request_id and ar.company_id = manager_company for update;
  if not found then
    raise exception 'Solicitud no disponible' using errcode = 'P3701';
  end if;
  if request.status <> 'pending' then
    raise exception 'La solicitud ya no está pendiente' using errcode = 'P3702';
  end if;
  if request.requested_role not in ('warehouse_operator', 'distributor_operator') then
    raise exception 'Rol solicitado inválido' using errcode = 'P3703';
  end if;
  select a.* into account from auth.users a where a.id = request.user_id for share;
  if not found or account.email is null or btrim(account.email) = '' then
    raise exception 'Cuenta sin email disponible' using errcode = 'P3704';
  end if;
  if jsonb_typeof(account.raw_user_meta_data -> 'name') is distinct from 'string' then
    raise exception 'El solicitante debe completar su nombre' using errcode = 'P3705';
  end if;
  -- Mismos espacios exteriores que String.trim() y límite que registration/name.ts.
  declared_name := btrim(account.raw_user_meta_data ->> 'name',
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if declared_name = '' or char_length(declared_name) > 100 then
    raise exception 'El solicitante debe completar un nombre válido' using errcode = 'P3705';
  end if;
  if exists (select 1 from public.users u where u.id = request.user_id) then
    raise exception 'El usuario ya tiene perfil operativo' using errcode = 'P3706';
  end if;
  insert into public.users (id, company_id, name, email, role)
    values (request.user_id, request.company_id, declared_name, account.email,
      request.requested_role::public.user_role);
  update public.access_requests set status = 'approved' where id = request.id;
end;
$$;
revoke all on function public.approve_access_request(uuid) from public, anon, service_role;
grant execute on function public.approve_access_request(uuid) to authenticated;
