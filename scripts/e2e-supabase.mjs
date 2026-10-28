// Servicio HTTP de fixtures exclusivo de Playwright. Nunca se importa en la app.
import { createServer } from 'node:http';

const driverId = '10000000-0000-4000-8000-000000000001';
const orderId = '20000000-0000-4000-8000-000000000001';
const palletId = '30000000-0000-4000-8000-000000000001';
const user = { id: driverId, email: 'chofer@trazflow.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
let delivered = false;
let confirmations = 0;
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
  if (url.pathname === '/test/reset') { delivered = false; confirmations = 0; return send({ ok: true }); }
  if (url.pathname === '/test/state') return send({ delivered, confirmations });
  if (url.pathname === '/auth/v1/token') {
    if (body.email !== user.email || body.password !== 'test1234') return send({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 400);
    return send({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 360000, user });
  }
  if (url.pathname === '/auth/v1/user') return send(user);
  if (url.pathname === '/rest/v1/users') return send({ id: driverId, company_id: 'company-demo', name: 'Chofer Demo', email: user.email, role: 'driver_operator', revoked_at: null });
  if (url.pathname === '/rest/v1/dispatch_orders') {
    const order = { id: orderId, driver_id: driverId, distributor_id: 'recipient-demo', status: delivered ? 'delivered' : 'confirmed', estimated_dispatch_date: '2026-10-25', created_at: '2026-10-25T12:00:00Z', notes: null, distributors: { name: 'Destinatario Demo' }, driver: { name: 'Chofer Demo' }, order_pallets: [{ delivery_outcome: delivered ? 'delivered' : null }] };
    return send(url.searchParams.has('id') ? order : delivered ? [] : [order]);
  }
  if (url.pathname === '/rest/v1/rpc/get_order_delivery_pallets') return send([{ pallet_id: palletId, qr_code: 'PAL-DEMO-001', product_name: 'Producto Demo', product_sku: 'SKU-DEMO', batch_number: 'LOTE-DEMO', quantity: 10, unit_of_measure: 'cajas', delivery_outcome: delivered ? 'delivered' : null, processed_at: delivered ? '2026-10-25T12:00:00Z' : null }]);
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
