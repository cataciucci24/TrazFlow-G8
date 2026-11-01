-- MVP: asignación interna inmediata, sin efectos comerciales ni reinicio de consumo.
begin;
create table public.company_plan_change_requests (
 company_id uuid not null references public.companies(id) on delete cascade,
 request_id uuid not null,
 previous_code text not null,
 previous_assigned_at timestamptz not null,
 target_code text not null,
 applied_at timestamptz not null,
 primary key (company_id, request_id)
);
alter table public.company_plan_change_requests enable row level security;
revoke all on public.company_plan_change_requests from public, anon, authenticated;

create function public.change_company_plan(
 p_target_code text, p_expected_code text, p_expected_assigned_at timestamptz,
 p_request_id uuid, p_confirmed boolean
) returns text language plpgsql security definer set search_path = '' as $$
declare
 v_company uuid;
 v_current public.company_plans%rowtype;
 v_request public.company_plan_change_requests%rowtype;
 v_price integer;
 v_applied timestamptz;
begin
 select u.company_id into v_company from public.users u
 where u.id = auth.uid() and u.role = 'logistics_manager' and u.revoked_at is null
 for share;
 if v_company is null then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
 if p_confirmed is distinct from true or p_request_id is null or p_expected_code is null
    or p_expected_assigned_at is null or p_target_code is null then return 'confirmation_required'; end if;
 select * into v_current from public.company_plans where company_id = v_company for update;
 if not found then return 'unassigned'; end if;
 select * into v_request from public.company_plan_change_requests
 where company_id = v_company and request_id = p_request_id;
 if found then
  if v_request.target_code = p_target_code and v_request.previous_code = p_expected_code
     and v_request.previous_assigned_at = p_expected_assigned_at
     and v_current.plan_code = v_request.target_code and v_current.assigned_at = v_request.applied_at then
   return 'already_applied';
  end if;
  return 'stale';
 end if;
 if v_current.plan_code <> p_expected_code or v_current.assigned_at <> p_expected_assigned_at then return 'stale'; end if;
 select monthly_price_cents into v_price from public.subscription_plans where code = p_target_code for share;
 if not found then return 'invalid_plan'; end if;
 if v_price is null then return 'commercial_required'; end if;
 if p_target_code = v_current.plan_code then return 'same_plan'; end if;
 -- Distinta versión incluso ante dos cambios dentro de la misma transacción.
 v_applied := greatest(clock_timestamp(), v_current.assigned_at + interval '1 microsecond');
 update public.company_plans set plan_code = p_target_code, assigned_at = v_applied where company_id = v_company;
 insert into public.company_plan_change_requests values
 (v_company, p_request_id, p_expected_code, p_expected_assigned_at, p_target_code, v_applied);
 return 'changed';
end;
$$;
revoke all on function public.change_company_plan(text,text,timestamptz,uuid,boolean) from public, anon;
grant execute on function public.change_company_plan(text,text,timestamptz,uuid,boolean) to authenticated;
commit;
