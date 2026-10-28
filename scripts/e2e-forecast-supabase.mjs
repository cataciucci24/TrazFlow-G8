// Fixtures aislados de TRZ-109; nunca se importan en la aplicación.
import { createServer } from 'node:http';
const companyId = 'company-forecast';
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const users = Object.fromEntries(['logistics_manager', 'warehouse_operator'].map((role, index) => {
  const id = `10000000-0000-4000-8000-00000000000${index + 1}`;
  return [id, { id, email: `${role}@forecast.test`, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', profileRole: role }];
}));
const customers = [{ id: 'late', name: 'Cliente atrasado' }, { id: 'next', name: 'Cliente próximo' }, { id: 'new', name: 'Cliente nuevo' }];
const timestamp = days => { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); date.setUTCHours(15, 0, 0, 0); return date.toISOString(); };
const orders = [
  ...[-60, -50, -40].map((days, index) => ({ id: `late-${index}`, distributor_id: 'late', confirmed_at: timestamp(days), status: index ? 'delivered' : 'confirmed' })),
  ...[-20, -10, -2].map((days, index) => ({ id: `next-${index}`, distributor_id: 'next', confirmed_at: timestamp(days), status: 'delivered_with_discrepancy' })),
  { id: 'new-1', distributor_id: 'new', confirmed_at: timestamp(-1), status: 'confirmed' },
];
const lines = orders.flatMap(order => [5, 15].map((quantity, index) => ({
  order_id: order.id, pallet_id: `${order.id}-${index}`, pallets: { quantity, batches: { products: { id: 'rice', name: 'Arroz', sku: 'ARR', unit_of_measure: 'cajas' } } },
})));
let failing = false;
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:54329');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/health') return send({ ok: true });
  if (url.pathname === '/test/failure') { failing = url.searchParams.get('enabled') === '1'; return send({ ok: true }); }
  if (url.pathname === '/test/session') {
    const user = Object.values(users).find(user => user.profileRole === url.searchParams.get('role'));
    if (!user) return send({}, 400);
    const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: 4102444800 })}.fixture`;
    return send({ access_token: token, refresh_token: 'fixture-refresh', expires_at: 4102444800, expires_in: 360000, token_type: 'bearer', user });
  }
  let user;
  try { const token = req.headers.authorization?.replace(/^Bearer /, ''); user = users[JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub]; } catch {}
  if (!user) return send({ message: 'No fixture session' }, 401);
  if (url.pathname === '/auth/v1/user') return send(user);
  if (url.pathname === '/rest/v1/users') return send({ id: user.id, company_id: companyId, name: 'Operador de prueba', email: user.email, role: user.profileRole, revoked_at: null });
  if (failing) return send({ code: 'XX000', message: 'Simulated database failure' }, 500);
  const paginate = rows => rows.slice(Number(url.searchParams.get('offset') ?? 0), Number(url.searchParams.get('offset') ?? 0) + Number(url.searchParams.get('limit') ?? 500));
  if (url.pathname === '/rest/v1/distributors') return send(paginate(customers));
  if (url.pathname === '/rest/v1/dispatch_orders') return send(user.profileRole === 'logistics_manager' ? paginate(orders) : []);
  if (url.pathname === '/rest/v1/order_pallets') return send(paginate(lines));
  return send({ message: 'Unexpected forecast fixture endpoint' }, 501);
}).listen(54329, '127.0.0.1');
