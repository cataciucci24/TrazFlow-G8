-- ============================================================
-- TRAZFLOW — SUPABASE SCHEMA (PostgreSQL)
-- Sprint 1 MVP — Flujo: Despacho -> Validación -> Recepción -> Trazabilidad
-- Roles: logistics_manager, warehouse_operator, distributor_operator
-- ============================================================

-- ------------------------------------------------------------
-- 0. EXTENSIONES
-- ------------------------------------------------------------
create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ------------------------------------------------------------
-- 1. ENUMS
-- ------------------------------------------------------------

create type user_role as enum (
  'logistics_manager',    -- responsable_logistico
  'warehouse_operator',   -- operador_deposito
  'distributor_operator'  -- operador_distribuidor
);

create type pallet_status as enum (
  'in_warehouse',   -- creado, todavía no asociado a un despacho en tránsito
  'assigned',       -- asociado a una orden, pendiente de validar/confirmar
  'in_transit',     -- despacho confirmado, viajando
  'received',       -- distribuidor confirmó recepción, coincide con lo esperado
  'discrepancy'     -- hubo faltante / sobrante detectado en despacho o recepción
);

create type order_status as enum (
  'draft',                -- US1: orden creada, sin pallets o sin validar
  'validating',           -- US3: escaneo QR en curso
  'has_discrepancy',      -- US4: se detectaron faltantes/pallets incorrectos
  'confirmed',            -- US5: despacho confirmado, mercadería "en tránsito"
  'received',             -- US6: distribuidor registró la recepción
  'received_with_discrepancy' -- US6: recepción con diferencias respecto a lo esperado
);

create type event_type as enum (
  'order_created',
  'pallet_associated',
  'qr_scan',
  'dispatch_discrepancy',
  'dispatch_confirmed',
  'reception',
  'reception_discrepancy',
  'location_update'
);

-- ------------------------------------------------------------
-- 2. COMPANIES (empresas)
-- ------------------------------------------------------------
-- Empresa dueña de la mercadería (multi-tenant: todo cuelga de una empresa)

create table companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  tax_id        text unique, -- CUIT
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. USERS (usuarios, extiende auth.users de Supabase)
-- ------------------------------------------------------------
-- Supabase Auth maneja el login; acá guardamos el perfil + rol + empresa.

create table users (
  id            uuid primary key references auth.users(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete restrict,
  name          text not null,
  email         text not null,
  role          user_role not null,
  created_at    timestamptz not null default now()
);

create index idx_users_company on users(company_id);

-- ------------------------------------------------------------
-- 4. DISTRIBUTORS (distribuidores)
-- ------------------------------------------------------------
-- Destino de los despachos. Un distribuidor puede tener usuarios propios
-- (distributor_operator) que confirman recepciones.

create table distributors (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade, -- empresa que lo dio de alta
  name          text not null,
  address       text,
  contact_info  text,
  created_at    timestamptz not null default now()
);

-- Relación opcional: qué usuarios (distributor_operator) operan para qué distribuidor
create table distributor_users (
  distributor_id uuid not null references distributors(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  primary key (distributor_id, user_id)
);

-- ------------------------------------------------------------
-- 5. PRODUCTS Y BATCHES (productos y lotes)
-- ------------------------------------------------------------

create table products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  sku           text not null,
  name          text not null,
  description   text,
  category      text,
  created_at    timestamptz not null default now(),
  unique (company_id, sku)
);

create table batches (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  batch_number      text not null,
  expiration_date   date,
  quantity          integer not null check (quantity >= 0),
  created_at        timestamptz not null default now(),
  unique (product_id, batch_number)
);

-- ------------------------------------------------------------
-- 6. PALLETS
-- ------------------------------------------------------------
-- Cada pallet tiene identidad digital mediante código QR (Sprint 1).

create table pallets (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  batch_id          uuid not null references batches(id) on delete restrict,
  qr_code           text not null unique,   -- string codificado en el QR físico
  status            pallet_status not null default 'in_warehouse',
  current_location  text,                    -- texto libre en MVP (depósito / distribuidor / "en tránsito")
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_pallets_company on pallets(company_id);
create index idx_pallets_status on pallets(status);

-- ------------------------------------------------------------
-- 7. DISPATCH ORDERS (órdenes de despacho)
-- ------------------------------------------------------------

create table dispatch_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  distributor_id  uuid not null references distributors(id) on delete restrict,
  created_by      uuid not null references users(id),
  status          order_status not null default 'draft',
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  received_at     timestamptz
);

create index idx_orders_company on dispatch_orders(company_id);
create index idx_orders_status on dispatch_orders(status);

-- Tabla puente: qué pallets integran una orden, y qué pasó con cada uno
-- (esperado vs. detectado en despacho, esperado vs. recibido en destino)

create table order_pallets (
  order_id              uuid not null references dispatch_orders(id) on delete cascade,
  pallet_id             uuid not null references pallets(id) on delete restrict,
  expected              boolean not null default true,   -- se agregó a la orden (US2)
  detected_at_dispatch  boolean not null default false,  -- se escaneó al validar (US3)
  received              boolean not null default false,  -- se confirmó recepción (US6)
  primary key (order_id, pallet_id)
);

-- ------------------------------------------------------------
-- 8. MOVEMENTS (movimientos)
-- ------------------------------------------------------------
-- Cambios de estado/ubicación de un pallet a lo largo de la cadena.
-- Es la vista "resumida" que alimenta la consulta de trazabilidad (US7).

create table movements (
  id                  uuid primary key default gen_random_uuid(),
  pallet_id           uuid not null references pallets(id) on delete cascade,
  order_id            uuid references dispatch_orders(id) on delete set null,
  origin_location     text,
  destination_location text not null,
  resulting_status    pallet_status not null,
  user_id             uuid references users(id),
  created_at          timestamptz not null default now()
);

create index idx_movements_pallet on movements(pallet_id);

-- ------------------------------------------------------------
-- 9. TRACEABILITY EVENTS (eventos de trazabilidad)
-- ------------------------------------------------------------
-- Log de auditoría append-only: cada acción del flujo queda registrada.
-- "details" en jsonb para no tener que migrar el schema por cada tipo de evento.

create table traceability_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  pallet_id     uuid references pallets(id) on delete cascade,
  order_id      uuid references dispatch_orders(id) on delete cascade,
  event_type    event_type not null,
  user_id       uuid references users(id),
  details       jsonb,
  created_at    timestamptz not null default now()
);

create index idx_events_pallet on traceability_events(pallet_id);
create index idx_events_order on traceability_events(order_id);
create index idx_events_company_date on traceability_events(company_id, created_at desc);

-- ============================================================
-- 10. ROW LEVEL SECURITY (RLS)
-- ============================================================
-- Regla base: un usuario solo ve datos de su propia empresa,
-- salvo el distributor_operator, que además necesita ver las
-- órdenes dirigidas a su distribuidor (aunque sean de otra empresa).

alter table companies enable row level security;
alter table users enable row level security;
alter table distributors enable row level security;
alter table distributor_users enable row level security;
alter table products enable row level security;
alter table batches enable row level security;
alter table pallets enable row level security;
alter table dispatch_orders enable row level security;
alter table order_pallets enable row level security;
alter table movements enable row level security;
alter table traceability_events enable row level security;

-- Función helper: empresa del usuario autenticado
create or replace function auth_company_id()
returns uuid
language sql stable
as $$
  select company_id from users where id = auth.uid();
$$;

-- Función helper: rol del usuario autenticado
create or replace function auth_role()
returns user_role
language sql stable
as $$
  select role from users where id = auth.uid();
$$;

-- Función helper: ¿el usuario opera para este distribuidor?
create or replace function operates_for_distributor(dist_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1 from distributor_users
    where distributor_id = dist_id and user_id = auth.uid()
  );
$$;

-- --- users: cada uno ve su propio perfil + compañeros de su empresa
create policy users_select on users
  for select using (company_id = auth_company_id());

-- --- products / batches / pallets: acotados a la empresa
create policy products_company on products
  for all using (company_id = auth_company_id());

create policy batches_company on batches
  for all using (
    product_id in (select id from products where company_id = auth_company_id())
  );

create policy pallets_select on pallets
  for select using (
    company_id = auth_company_id()
    or id in (
      select pallet_id from order_pallets op
      join dispatch_orders o on o.id = op.order_id
      where operates_for_distributor(o.distributor_id)
    )
  );

create policy pallets_write on pallets
  for insert with check (company_id = auth_company_id());

create policy pallets_update on pallets
  for update using (
    company_id = auth_company_id()
    or id in (
      select pallet_id from order_pallets op
      join dispatch_orders o on o.id = op.order_id
      where operates_for_distributor(o.distributor_id)
    )
  );

-- --- dispatch_orders: la empresa dueña, o el distribuidor destinatario
create policy orders_select on dispatch_orders
  for select using (
    company_id = auth_company_id()
    or operates_for_distributor(distributor_id)
  );

create policy orders_insert on dispatch_orders
  for insert with check (
    company_id = auth_company_id()
    and auth_role() = 'logistics_manager'
  );

create policy orders_update on dispatch_orders
  for update using (
    company_id = auth_company_id()
    or operates_for_distributor(distributor_id)
  );

-- --- order_pallets: sigue la visibilidad de la orden
create policy order_pallets_select on order_pallets
  for select using (
    order_id in (
      select id from dispatch_orders
      where company_id = auth_company_id() or operates_for_distributor(distributor_id)
    )
  );

create policy order_pallets_write on order_pallets
  for all using (
    order_id in (
      select id from dispatch_orders
      where company_id = auth_company_id() or operates_for_distributor(distributor_id)
    )
  );

-- --- movements y traceability_events: mismo criterio, vía pallet/orden
create policy movements_select on movements
  for select using (
    pallet_id in (select id from pallets where company_id = auth_company_id())
    or order_id in (select id from dispatch_orders where operates_for_distributor(distributor_id))
  );

create policy events_select on traceability_events
  for select using (company_id = auth_company_id());

create policy events_insert on traceability_events
  for insert with check (company_id = auth_company_id());

-- ============================================================
-- 11. TRIGGER: updated_at automático en pallets
-- ============================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_pallets_updated_at
before update on pallets
for each row execute function set_updated_at();
