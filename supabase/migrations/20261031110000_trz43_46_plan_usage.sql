-- Registro independiente del pallet; no inventa altas eliminadas previamente.
begin;
lock table public.pallets in share row exclusive mode;
create table public.plan_usage_tracking (
 singleton boolean primary key default true check (singleton),
 started_at timestamptz not null default now()
);
insert into public.plan_usage_tracking default values;
create table public.plan_pallet_registrations (
 pallet_id uuid primary key, -- Sin FK al pallet: sobrevive a DELETE.
 company_id uuid not null references public.companies(id) on delete cascade,
 registered_at timestamptz not null
);
create index plan_pallet_registrations_company_date on public.plan_pallet_registrations(company_id, registered_at);
alter table public.plan_pallet_registrations enable row level security;
alter table public.plan_usage_tracking enable row level security;
revoke all on public.plan_pallet_registrations, public.plan_usage_tracking from anon, authenticated;
insert into public.plan_pallet_registrations select id, company_id, created_at from public.pallets;
create function public.record_plan_pallet_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.plan_pallet_registrations values (new.id, new.company_id, new.created_at);
 return new;
end;
$$;
revoke all on function public.record_plan_pallet_registration() from public, anon, authenticated;
create trigger trg_record_plan_pallet_registration after insert on public.pallets
 for each row execute function public.record_plan_pallet_registration();
-- Empresa y mes derivados en servidor, nunca del navegador.
create function public.get_company_plan_usage()
returns table (operators bigint, pallets bigint, month_start date, pallets_complete boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
 company uuid;
 local_month timestamp := date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires');
begin
 select u.company_id into company from public.users u
 where u.id = auth.uid() and u.role = 'logistics_manager' and u.revoked_at is null;
 if company is null then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
 return query select
 (select count(*) from public.users u where u.company_id = company
  and u.role in ('warehouse_operator', 'driver_operator') and u.revoked_at is null),
 (select count(*) from public.plan_pallet_registrations p where p.company_id = company
  and p.registered_at >= (local_month at time zone 'America/Argentina/Buenos_Aires')
  and p.registered_at < ((local_month + interval '1 month') at time zone 'America/Argentina/Buenos_Aires')),
 local_month::date,
 (select t.started_at <= (local_month at time zone 'America/Argentina/Buenos_Aires') from public.plan_usage_tracking t);
end;
$$;
revoke all on function public.get_company_plan_usage() from public, anon;
grant execute on function public.get_company_plan_usage() to authenticated;

commit;
