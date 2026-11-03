-- TRZ-47 a TRZ-50: pagos, facturas y cancelación al fin del período pagado.
-- Sin pasarela de cobro: los pagos los registra un proceso confiable con service_role.
begin;
create table public.company_payments (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 plan_code text not null references public.subscription_plans(code) on delete restrict,
 -- Copias: una factura emitida no cambia si después se edita el catálogo o la empresa.
 plan_name text not null,
 billed_to text not null,
 amount_cents integer not null check (amount_cents >= 0),
 currency text not null default 'USD' check (currency = 'USD'),
 status text not null check (status in ('paid', 'pending', 'failed', 'refunded', 'canceled')),
 payment_date date not null,
 -- Fechas de Argentina, ambos extremos incluidos.
 period_start date not null,
 period_end date not null,
 invoice_number text unique,
 created_at timestamptz not null default now(),
 check (period_end >= period_start),
 check (status not in ('paid', 'refunded') or invoice_number is not null)
);
create index company_payments_company_period_idx on public.company_payments(company_id, period_end desc);

alter table public.company_payments enable row level security;
revoke all on public.company_payments from public, anon, authenticated;
grant select on public.company_payments to authenticated;
grant all on public.company_payments to service_role;

create policy company_payments_read on public.company_payments for select to authenticated
 using (
  company_id = (select public.auth_company_id())
  and (select public.auth_role()) = 'logistics_manager'
  and exists (select 1 from public.users where id = (select auth.uid()) and revoked_at is null)
 );

-- access_until es el último día de acceso, incluido, en fecha de Argentina.
alter table public.company_plans
 add column canceled_at timestamptz,
 add column access_until date,
 add constraint company_plans_cancellation_check check ((canceled_at is null) = (access_until is null));

-- Garantía de "no ser cobrado": ningún proceso puede registrar un cobro posterior a la cancelación.
create function public.reject_payment_after_cancellation() returns trigger
language plpgsql set search_path = '' as $$
declare
 v_access_until date;
begin
 if new.status not in ('paid', 'pending') then return new; end if;
 select access_until into v_access_until from public.company_plans where company_id = new.company_id for share;
 if v_access_until is not null and new.period_start > v_access_until then
  raise exception 'La suscripción está cancelada: no se puede cobrar un período posterior a %', v_access_until
   using errcode = '23514';
 end if;
 return new;
end;
$$;
revoke all on function public.reject_payment_after_cancellation() from public, anon, authenticated;
create trigger company_payments_reject_after_cancellation
 before insert or update of status, period_start on public.company_payments
 for each row execute function public.reject_payment_after_cancellation();

create function public.cancel_company_subscription(p_confirmed boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
 v_company uuid;
 v_current public.company_plans%rowtype;
 v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
 v_access_until date;
begin
 select u.company_id into v_company from public.users u
 where u.id = auth.uid() and u.role = 'logistics_manager' and u.revoked_at is null
 for share;
 if v_company is null then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
 if p_confirmed is distinct from true then return 'confirmation_required'; end if;
 select * into v_current from public.company_plans where company_id = v_company for update;
 if not found then return 'unassigned'; end if;
 if v_current.canceled_at is not null then return 'already_canceled'; end if;
 select max(period_end) into v_access_until from public.company_payments
 where company_id = v_company and status = 'paid' and period_end >= v_today;
 if v_access_until is null then return 'no_paid_period'; end if;
 update public.company_plans set canceled_at = now(), access_until = v_access_until where company_id = v_company;
 update public.company_payments set status = 'canceled'
 where company_id = v_company and status = 'pending' and period_start > v_access_until;
 return 'canceled';
end;
$$;
revoke all on function public.cancel_company_subscription(boolean) from public, anon;
grant execute on function public.cancel_company_subscription(boolean) to authenticated;

-- Todos los roles la consultan: depósito y chofer no leen company_plans por RLS.
create function public.get_company_subscription_access()
returns table (canceled_at timestamptz, access_until date, ended boolean)
language sql stable security definer set search_path = '' as $$
 select p.canceled_at, p.access_until,
  p.access_until is not null and (now() at time zone 'America/Argentina/Buenos_Aires')::date > p.access_until
 from public.users u
 join public.company_plans p on p.company_id = u.company_id
 where u.id = auth.uid() and u.revoked_at is null;
$$;
revoke all on function public.get_company_subscription_access() from public, anon;
grant execute on function public.get_company_subscription_access() to authenticated;

-- Igual que TRZ-44/45, pero una suscripción cancelada ya no admite cambios de plan.
create or replace function public.change_company_plan(
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
 if v_current.canceled_at is not null then return 'subscription_canceled'; end if;
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
commit;
