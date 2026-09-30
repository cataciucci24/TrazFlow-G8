create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  requested_role text not null
    check (requested_role in ('warehouse_operator','distributor_operator')),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.access_requests enable row level security;

create policy "insert own pending request" on public.access_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

create policy "read own request" on public.access_requests
  for select to authenticated
  using (user_id = auth.uid());

grant select, insert on public.access_requests to authenticated;

create or replace function public.get_registration_companies()
returns table (id uuid, name text)
language sql
security definer
set search_path = public
as $$
  select c.id, c.name from public.companies c order by c.name;
$$;

revoke all on function public.get_registration_companies() from public;
grant execute on function public.get_registration_companies() to anon, authenticated;