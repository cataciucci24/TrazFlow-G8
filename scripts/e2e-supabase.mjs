// Servicio HTTP de fixtures exclusivo de Playwright. Nunca se importa en la app.
import { createServer } from 'node:http';

const driverId = '10000000-0000-4000-8000-000000000001';
const orderId = '20000000-0000-4000-8000-000000000001';
const palletId = '30000000-0000-4000-8000-000000000001';
const user = { id: driverId, email: 'chofer@trazflow.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
let delivered = false;
let confirmations = 0;
let activeRole = 'driver_operator';
let validated = false;
let companyPlanCode = null;
let plansUnavailable = false;
let planMutations = 0;
let companyPlanUnavailable = false;
let catalogUnavailable = false;
let planUsage = { operators: 0, pallets: 0, month_start: "2026-10-01", pallets_complete: true };
let usageUnavailable = false;
const subscriptionPlans = [
  { code: 'starter', name: 'Starter', monthly_price_cents: 6900, currency: 'USD', max_operators: 3, max_pallets_per_month: 500, printer_count: 1, printer_model: 'Zebra ZQ320', equipment_price_cents: 45000, preliminary: true },
  { code: 'growth', name: 'Growth', monthly_price_cents: 26900, currency: 'USD', max_operators: 10, max_pallets_per_month: 3000, printer_count: 3, printer_model: 'Zebra ZQ320', equipment_price_cents: 135000, preliminary: true },
  { code: 'enterprise', name: 'Enterprise', monthly_price_cents: null, currency: 'USD', max_operators: null, max_pallets_per_month: null, printer_count: null, printer_model: 'Zebra ZQ320', equipment_price_cents: null, preliminary: true },
];
let catalogPlans = subscriptionPlans;
const roleEmails = { 'chofer@trazflow.test': 'driver_operator', 'deposito@trazflow.test': 'warehouse_operator', 'logistica@trazflow.test': 'logistics_manager' };
const product = { id: 'product-demo', name: 'Producto Demo con descripción extendida para comprobar el diseño en celular', sku: 'SKU-DEMO', unit_of_measure: 'cajas' };
const batch = { id: 'batch-demo', batch_number: 'LOTE-DEMO', expiration_date: '2099-12-31', source_system: 'erp', products: product };
const pallet = { id: palletId, qr_code: 'PAL-DEMO-001', status: 'assigned', current_location: 'Depósito central — Sector de preparación de pedidos', warehouse_code: 'CENTRAL', quantity: 10, created_at: '2026-10-25T12:00:00Z', source_system: 'trazflow', external_id: null, synced_at: null, batches: batch, traceability_events: [{ count: 1 }] };
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: driverId, aud: 'authenticated', role: 'authenticated', exp: 4102444800 })}.fixture`;
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1:54329');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/health') return send({ ok: true });
  if (url.pathname === '/test/usage') { planUsage = body.usage ?? planUsage; usageUnavailable = Boolean(body.unavailable); return send({ok: true}); }
  if (url.pathname === '/rest/v1/rpc/get_company_plan_usage') return usageUnavailable ? send({message: 'unavailable'}, 500) : send([planUsage]);
  if (url.pathname === '/test/reset') { planUsage = { operators: 0, pallets: 0, month_start: '2026-10-01', pallets_complete: true }; usageUnavailable = false; delivered = false; confirmations = 0; validated = false; activeRole = 'driver_operator'; companyPlanCode = null; plansUnavailable = false; catalogPlans = subscriptionPlans; planMutations = 0; companyPlanUnavailable = false; catalogUnavailable = false; return send({ ok: true }); }
  if (url.pathname === '/test/plan') { companyPlanCode = body.code ?? null; plansUnavailable = Boolean(body.unavailable); catalogPlans = body.plans ?? subscriptionPlans; companyPlanUnavailable = Boolean(body.companyPlanUnavailable); catalogUnavailable = Boolean(body.catalogUnavailable); return send({ ok: true }); }
  if (url.pathname === '/test/state') return send({ delivered, confirmations });
  if (url.pathname === '/test/plan-state') return send({ companyPlanCode, planMutations });
  if (url.pathname === '/auth/v1/token') {
    if (!roleEmails[body.email] || body.password !== 'test1234') return send({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 400);
    activeRole = roleEmails[body.email];
    return send({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 360000, user });
  }
  if (url.pathname === '/auth/v1/user') return send(user);
  if (url.pathname === '/rest/v1/subscription_plans' || url.pathname === '/rest/v1/company_plans') {
    if (req.method !== 'GET') { planMutations++; return send({ message: 'Plans are read-only' }, 403); }
    if (plansUnavailable || (catalogUnavailable && url.pathname.endsWith('/subscription_plans')) || (companyPlanUnavailable && url.pathname.endsWith('/company_plans'))) return send({ code: 'PGRST205', message: 'Catalog unavailable' }, 503);
    if (url.pathname.endsWith('/subscription_plans')) return send(catalogPlans);
    return send(companyPlanCode ? { subscription_plans: catalogPlans.find(plan => plan.code === companyPlanCode) } : null);
  }
  if (url.pathname === '/rest/v1/users') {
    const profile = { id: driverId, company_id: 'company-demo', name: 'Operador Demo', email: user.email, role: activeRole, revoked_at: null };
    return send(url.searchParams.has('role') ? [profile] : profile);
  }
  if (url.pathname === '/rest/v1/dispatch_orders') {
    const order = { id: orderId, driver_id: driverId, distributor_id: 'recipient-demo', status: delivered ? 'delivered' : activeRole === 'driver_operator' ? 'confirmed' : 'draft', source_system: 'trazflow', external_id: null, synced_at: null, estimated_dispatch_date: '2026-10-25', created_at: '2026-10-25T12:00:00Z', notes: 'Pedido de prueba con observaciones para comprobar que todo el contenido siga visible en una pantalla pequeña.', distributors: { name: 'Destinatario Demo' }, driver: { name: 'Chofer Demo' }, order_pallets: [{ validated_at: validated ? '2026-10-25T12:00:00Z' : null, delivery_outcome: delivered ? 'delivered' : null }] };
    return send(url.searchParams.has('id') ? order : delivered ? [] : [order]);
  }
  if (url.pathname === '/rest/v1/pallets') return send([pallet]);
  if (url.pathname === '/rest/v1/products') return send([product]);
  if (url.pathname === '/rest/v1/batches') return send([batch]);
  if (url.pathname === '/rest/v1/warehouses') return send([{ code: 'CENTRAL', name: 'Depósito central', source_system: 'erp', active: true, external_id: 'CENTRAL', synced_at: null }]);
  if (url.pathname === '/rest/v1/order_pallets') return send([{ pallet_id: palletId, pallets: pallet, validated_at: validated ? '2026-10-25T12:00:00Z' : null, validated_by: validated ? driverId : null }]);
  if (url.pathname === '/rest/v1/order_notifications') return send([{ id: 'notice-demo', event_type: 'dispatch_wrong_pallet', description: 'Un pallet escaneado no corresponde a esta orden.', pallet_id: palletId, created_at: '2026-10-25T12:00:00Z' }]);
  if (['order_delivery_receipts', 'traceability_events', 'distributor_batch_stocks', 'distributor_product_stocks', 'dispatch_order_lines'].some(table => url.pathname === `/rest/v1/${table}`)) return send([]);
  if (url.pathname === '/rest/v1/erp_sync_runs' || url.pathname === '/rest/v1/erp_company_settings') return send(null);
  if (url.pathname === '/rest/v1/rpc/get_expiration_thresholds') return send([{ critical_days: 30, caution_days: 60, upcoming_days: 90 }]);
  if (url.pathname === '/rest/v1/rpc/erp_stock_overview') return send([]);
  if (url.pathname === '/rest/v1/rpc/erp_outbox_driver_claim') return send([]);
  if (url.pathname === '/rest/v1/rpc/erp_integration_summary') return send([{ pending_count: 1, unreported_count: 1 }]);
  if (url.pathname === '/rest/v1/rpc/erp_dispatched_unreported') return send([{ order_id: orderId, order_external_id: 'ERP-ORDEN-DEMO-001', order_status: 'confirmed', confirmed_at: '2026-10-25T12:00:00Z', distributor_name: 'Destinatario Demo', event_id: '40000000-0000-4000-8000-000000000001', event_status: 'failed', attempts: 1, last_error_code: 'timeout', next_attempt_at: null, total_count: 1 }]);
  if (url.pathname === '/rest/v1/rpc/erp_integration_activity') return send([{ kind: 'dispatch_confirmed', id: '40000000-0000-4000-8000-000000000001', status: 'failed', occurred_at: '2026-10-25T12:00:00Z', finished_at: null, attempts: 1, next_attempt_at: null, error_code: 'timeout', error_message: 'El ERP no respondió a tiempo. El reporte queda pendiente para el siguiente intento.', error_count: 1, order_id: orderId, order_external_id: 'ERP-ORDEN-DEMO-001', pallet_count: 1, erp_reference: null, provider: 'mock', total_count: 1 }]);
  if (url.pathname === '/rest/v1/rpc/validate_order_pallet') {
    if (body.p_order_id !== orderId || body.p_qr_code !== pallet.qr_code) return send({ message: 'Unexpected validation input' }, 400);
    validated = true;
    return send([{ outcome: 'validated', pallet_id: palletId, qr_code: pallet.qr_code, product_name: product.name, product_sku: product.sku, batch_number: batch.batch_number, validated_at: '2026-10-25T12:00:00Z' }]);
  }
  if (url.pathname === '/rest/v1/rpc/get_order_delivery_pallets') return send([{ pallet_id: palletId, qr_code: 'PAL-DEMO-001', product_name: 'Producto Demo', product_sku: 'SKU-DEMO', batch_number: 'LOTE-DEMO', quantity: 10, unit_of_measure: 'cajas', delivery_outcome: delivered ? 'delivered' : null, processed_at: delivered ? '2026-10-25T12:00:00Z' : null }]);
  if (url.pathname === '/rest/v1/rpc/get_pallet_scan_details') return send(body.p_qr_code === 'PAL-DEMO-001' ? [{
    qr_code: 'PAL-DEMO-001', product_name: 'Producto Demo', product_sku: 'SKU-DEMO', batch_number: 'LOTE-DEMO',
    quantity: 10, unit_of_measure: 'cajas', physical_location: delivered ? 'Destinatario Demo' : activeRole === 'driver_operator' ? 'En tránsito' : pallet.current_location,
    last_event_type: delivered ? 'delivery_confirmed' : validated ? 'qr_scan' : activeRole === 'driver_operator' ? 'dispatch_confirmed' : 'location_assigned', last_event_at: '2026-10-25T12:00:00Z',
    actor_name: delivered ? 'Chofer Demo' : 'Operador Demo', actor_role: delivered ? 'driver_operator' : 'warehouse_operator',
  }] : []);
  if (url.pathname === '/rest/v1/rpc/confirm_delivery_pallet') {
    if (body.p_order_id !== orderId || body.p_qr_code !== 'PAL-DEMO-001' || body.p_discrepancy_type !== null) return send({ message: 'Unexpected delivery input' }, 400);
    confirmations++;
    const outcome = delivered ? 'already_processed' : 'delivered';
    delivered = true;
    return send([{ outcome, pallet_id: palletId, qr_code: 'PAL-DEMO-001', product_name: 'Producto Demo', product_sku: 'SKU-DEMO', batch_number: 'LOTE-DEMO' }]);
  }
  console.error('Unexpected fixture request', req.method, url.pathname);
  return send({ message: 'Endpoint not implemented by test fixture' }, 501);
}).listen(54329, '127.0.0.1');
