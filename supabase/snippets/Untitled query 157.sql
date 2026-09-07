-- 1. Producto para la empresa de los usuarios de test
insert into products (id, company_id, sku, name, description, category)
select
  gen_random_uuid(),
  u.company_id,
  'SKU-TEST-01',
  'Producto de prueba',
  'Seed manual para testing de US5',
  'General'
from users u
where u.email = 'logistica@trazflow.test'
  and not exists (
    select 1 from products p
    where p.company_id = u.company_id and p.sku = 'SKU-TEST-01'
  )
limit 1;

-- 2. Lote para ese producto
insert into batches (id, product_id, batch_number, expiration_date, quantity)
select
  gen_random_uuid(),
  p.id,
  'LOTE-TEST-001',
  current_date + interval '90 days',
  100
from products p
where p.sku = 'SKU-TEST-01'
  and not exists (
    select 1 from batches b
    where b.product_id = p.id and b.batch_number = 'LOTE-TEST-001'
  )
limit 1;

-- 3. Ocho pallets in_warehouse, QR simples para tipear a mano
insert into pallets (company_id, batch_id, qr_code, status, current_location)
select
  u.company_id,
  b.id,
  'QR-TEST-' || lpad(n::text, 3, '0'),
  'in_warehouse',
  'Depósito Central'
from users u
cross join batches b
cross join generate_series(1, 8) as n
where u.email = 'logistica@trazflow.test'
  and b.batch_number = 'LOTE-TEST-001'
  and not exists (
    select 1 from pallets pl
    where pl.qr_code = 'QR-TEST-' || lpad(n::text, 3, '0')
  );

-- Verificación
select id, qr_code, status, current_location from pallets order by qr_code;