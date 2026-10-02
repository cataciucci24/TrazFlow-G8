-- TRZ-36: lectura administrativa limitada. No cambia las policies de solicitudes propias.
create function public.get_pending_access_requests()
returns table (
  request_id uuid, user_id uuid, email text, company_id uuid,
  company_name text, requested_role text, status text, created_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  caller_company uuid;
begin
  if auth.uid() is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;

  select profile.company_id into caller_company
  from public.users profile
  where profile.id = auth.uid() and profile.role = 'logistics_manager';

  if caller_company is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;

  return query
  select request.id, request.user_id, account.email::text, request.company_id,
    company.name, request.requested_role, request.status, request.created_at
  from public.access_requests request
  join auth.users account on account.id = request.user_id
  join public.companies company on company.id = request.company_id
  where request.company_id = caller_company and request.status = 'pending'
  order by request.created_at, request.id;
end;
$$;

revoke all on function public.get_pending_access_requests() from public, anon, service_role;
grant execute on function public.get_pending_access_requests() to authenticated;
