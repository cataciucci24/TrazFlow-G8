// Escenario HTTP local de Playwright. Modela solo el recorrido manual; no sustituye PostgreSQL/RLS.
const id = (kind, number = 1) => `${kind}0000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const company = 'company-demo';
const actor = id('1');
export const mixedCode = 'PAL-MIXTO-001';
const catalog = [
  { id: id('5'), name: 'Arroz', sku: 'ARZ-1', unit_of_measure: 'cajas' },
  { id: id('5', 2), name: 'Queso', sku: 'QSO-2', unit_of_measure: 'kilogramos' },
];
const lots = catalog.map((product, index) => ({ id: id('6', index + 1), company_id: company,
  batch_number: `LOTE-${index + 1}`, expiration_date: '2099-12-31', source_system: 'trazflow',
  product_id: product.id, products: product }));
const copy = value => structuredClone(value);

export function createPalletsScenario() {
  let state;
  const reset = () => { state = { pallets: [], contents: [], orders: [], relations: [], events: [], movements: [], calls: [] }; };
  reset();
  const stamp = () => new Date(Date.now() + state.events.length).toISOString();
  const event = (type, orderId, details = {}, palletId = state.pallets[0]?.id ?? null) => {
    state.events.push({ id: id('9', state.events.length + 1), company_id: company, pallet_id: palletId,
      order_id: orderId, event_type: type, user_id: actor, user: { name: 'Operador Demo' }, details, created_at: stamp() });
  };
  const snapshot = () => state.contents.map(item => ({ productId: item.product_id, batchId: item.batch_id, quantity: item.quantity }))
    .sort((a, b) => a.batchId.localeCompare(b.batchId));
  // normalize_pallet_observations admite desconocidos como IDs nulos y ordena por lote.
  const normalize = items => !Array.isArray(items) || items.length > 100 || items.some(item =>
    !item || typeof item.productSku !== 'string' || typeof item.batchNumber !== 'string' ||
    (item.quantity !== null && (typeof item.quantity !== 'number' || item.quantity < 0 || Math.abs(item.quantity * 100 - Math.round(item.quantity * 100)) > 1e-7)))
    ? null : items.map(item => {
      const product = catalog.find(value => value.sku === item.productSku.trim());
      const lot = lots.find(value => value.product_id === product?.id && value.batch_number === item.batchNumber.trim());
      return { productId: product?.id ?? null, batchId: lot?.id ?? null, quantity: item.quantity };
    }).sort((a, b) => String(a.batchId ?? '\uffff').localeCompare(String(b.batchId ?? '\uffff')));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const filter = (rows, url) => rows.filter(row => [...url.searchParams].every(([key, value]) => {
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').map(part => part.replaceAll('"', '')).includes(String(row[key]));
    if (value === 'is.null') return row[key] == null;
    return true;
  }));
  const movement = (orderId, origin, destination, status) => state.movements.push({ id: id('8', state.movements.length + 1),
    pallet_id: state.pallets[0].id, order_id: orderId, origin_location: origin, destination_location: destination,
    resulting_status: status, created_at: stamp() });

  return function handle({ req, url, body, send, role }) {
    const path = url.pathname;
    if (path === '/test/pallets/reset') { reset(); send({ ok: true }); return true; }
    if (path === '/test/pallets/state') { send(copy(state)); return true; }
    if (!path.startsWith('/rest/v1/')) return false;
    const table = path.slice('/rest/v1/'.length);
    const single = String(req.headers.accept).includes('application/vnd.pgrst.object+json');
    const respond = rows => { const found = filter(rows, url); send(single ? found[0] ?? null : found); };
    const fail = (message, code = '22023') => send({ code, message }, code === '42501' ? 403 : 400);
    const pallet = state.pallets[0];
    if (table === 'products') { respond(catalog); return true; }
    if (table === 'batches') { respond(lots); return true; }
    if (table === 'warehouses') { respond([{ company_id: company, code: 'CENTRAL', name: 'Depósito central', source_system: 'trazflow', active: true }]); return true; }
    if (table === 'pallet_contents') { respond(state.contents); return true; }
    if (table === 'pallets') {
      if (req.method === 'PATCH') {
        const rows = filter(state.pallets, url);
        if (role !== 'logistics_manager' || !['assigned', 'in_warehouse'].includes(body.status)) fail('Unexpected pallet mutation', '42501');
        else { rows.forEach(row => Object.assign(row, body)); send(rows.map(row => ({ id: row.id }))); }
      } else respond(state.pallets.map(row => ({ ...row, traceability_events: [{ count: state.events.filter(e => e.pallet_id === row.id).length }] })));
      return true;
    }
    if (table === 'dispatch_orders') {
      if (req.method === 'POST') {
        if (role !== 'logistics_manager' || body.external_id) { fail('Only manual orders in this fixture', '42501'); return true; }
        const order = { ...body, id: id('2', state.orders.length + 1), status: 'draft', source_system: 'trazflow', external_id: null,
          driver_id: null, created_at: stamp(), confirmed_at: null, delivered_at: null };
        state.orders.push(order); event('order_created', order.id, {}, null); send({ id: order.id });
      } else if (req.method === 'PATCH') {
        const rows = filter(state.orders, url);
        if (role !== 'logistics_manager' || Object.keys(body).some(key => key !== 'driver_id')) fail('Unexpected order mutation', '42501');
        else { rows.forEach(row => Object.assign(row, body)); send(rows); }
      } else respond(state.orders.map(order => ({ ...order, distributors: { name: 'Destinatario Demo' },
        driver: order.driver_id ? { name: 'Chofer Demo' } : null,
        order_pallets: state.relations.filter(row => row.order_id === order.id) })));
      return true;
    }
    if (table === 'order_pallets') {
      if (req.method === 'POST') {
        if (role !== 'logistics_manager') { fail('Forbidden', '42501'); return true; }
        for (const row of body) {
          if (row.pallet_id !== pallet?.id || pallet.status !== 'assigned' || !state.orders.some(order => order.id === row.order_id && order.status === 'draft')) {
            fail('Unexpected association'); return true;
          }
          state.relations.push({ ...row, expected_items: copy(snapshot()), dispatch_items: null, reception_items: null,
            validated_at: null, validated_by: null, detected_at_dispatch: false, delivery_outcome: null, delivered_at: null });
        }
        send(null);
      } else respond(state.relations.map(row => ({ ...row, pallets: pallet })));
      return true;
    }
    if (table === 'traceability_events') {
      if (req.method === 'POST') { for (const row of body) event(row.event_type, row.order_id, row.details ?? {}, row.pallet_id); send(null); }
      else respond(state.events);
      return true;
    }
    if (table === 'movements') { respond(state.movements); return true; }
    if (table === 'order_notifications') { send([]); return true; }
    if (table === 'dispatch_notes') { send(null); return true; }
    if (!table.startsWith('rpc/')) return false;
    const fn = table.slice(4);
    if (fn === 'assign_order_driver') {
      const target = state.orders.find(order => order.id === body.p_order_id);
      if (role !== 'logistics_manager' || !target || !['draft', 'confirmed'].includes(target.status) || body.p_driver_id !== actor) fail('Acceso no autorizado', '42501');
      else { target.driver_id = actor; send(null); }
      return true;
    }
    if (!['create_pallet_with_items', 'return_pallet_to_warehouse', 'validate_order_pallet_items', 'confirm_dispatch_order',
      'confirm_delivery_pallet_items', 'get_order_delivery_pallets', 'get_pallet_scan_details'].includes(fn)) return false;
    state.calls.push({ fn, role, args: copy(body) });
    const result = outcome => {
      const found = !['forbidden', 'order_not_found', 'invalid_input', 'pallet_not_found'].includes(outcome)
        && !(fn === 'confirm_delivery_pallet_items' && outcome === 'invalid_status');
      const details = found && !['content_required', 'content_mismatch', 'wrong_order'].includes(outcome);
      return [{ outcome, pallet_id: found ? pallet?.id ?? null : null, qr_code: found ? pallet?.qr_code ?? null : null,
        product_name: details ? catalog.map(p => p.name).join(' · ') : null,
        product_sku: details ? catalog.map(p => p.sku).join(' · ') : null,
        batch_number: details ? lots.map(b => b.batch_number).join(' · ') : null,
        ...(fn === 'validate_order_pallet_items' ? { validated_at: null } : { registered_at: null }) }];
    };
    if (fn === 'create_pallet_with_items') {
      if (!['logistics_manager', 'warehouse_operator'].includes(role)) fail('Forbidden', '42501');
      else if (pallet || body.p_warehouse_code !== 'CENTRAL' || !Array.isArray(body.p_items) || body.p_items.length < 1 || body.p_items.length > 100 ||
        new Set(body.p_items.map(item => item.batch_id)).size !== body.p_items.length || body.p_items.some(item => {
          const lot = lots.find(lot => lot.id === item.batch_id);
          return !lot || typeof item.quantity !== 'number' || item.quantity <= 0 ||
            (lot.products.unit_of_measure === 'cajas' ? !Number.isInteger(item.quantity) : Math.abs(item.quantity * 100 - Math.round(item.quantity * 100)) > 1e-7);
        })) fail('Revisá el lote y la cantidad de cada ítem.');
      else {
        const items = [...body.p_items].sort((a, b) => a.batch_id.localeCompare(b.batch_id));
        state.pallets.push({ id: id('3'), company_id: company, qr_code: mixedCode, status: 'in_warehouse', current_location: 'Depósito',
          warehouse_code: 'CENTRAL', batch_id: items[0].batch_id, quantity: items[0].quantity, source_system: 'trazflow', external_id: null, created_at: stamp() });
        state.contents = items.map((item, index) => {
          const lot = lots.find(lot => lot.id === item.batch_id); const product = lot.products;
          return { item_id: id('7', index + 1), pallet_id: id('3'), company_id: company, batch_id: lot.id, batch_number: lot.batch_number,
            expiration_date: lot.expiration_date, product_id: product.id, product_name: product.name, product_sku: product.sku,
            unit_of_measure: product.unit_of_measure, quantity: item.quantity, lot_source_system: lot.source_system };
        });
        send([{ pallet_id: id('3'), qr_code: mixedCode }]);
      }
      return true;
    }
    if (fn === 'return_pallet_to_warehouse') {
      let outcome = 'returned';
      if (role !== 'logistics_manager') outcome = 'forbidden';
      else if (!body.p_qr_code?.trim() || body.p_qr_code.trim().length > 512 || !body.p_reason?.trim() || body.p_reason.trim().length > 1000) outcome = 'invalid_input';
      else if (body.p_qr_code.trim() !== pallet?.qr_code) outcome = 'pallet_not_found';
      else if (pallet.status === 'in_warehouse') outcome = 'already_in_warehouse';
      else if (!['delivered', 'delivery_discrepancy', 'received'].includes(pallet.status)) outcome = 'invalid_status';
      if (outcome === 'returned') {
        const order = [...state.orders].reverse().find(order => order.confirmed_at);
        const previous = pallet.status;
        movement(order?.id ?? null, pallet.current_location, 'Depósito', 'in_warehouse');
        Object.assign(pallet, { status: 'in_warehouse', current_location: 'Depósito', current_location_id: null });
        event('pallet_returned', order?.id ?? null, { reason: body.p_reason.trim(), previous_status: previous, warehouse_code: 'CENTRAL', items: snapshot() });
      }
      const found = !['forbidden', 'invalid_input', 'pallet_not_found'].includes(outcome);
      send([{ outcome, pallet_id: found ? pallet?.id ?? null : null, qr_code: found ? pallet?.qr_code ?? null : null }]); return true;
    }
    if (fn === 'get_pallet_scan_details') {
      const lastEvent = state.events.findLast(event => event.pallet_id === pallet?.id);
      send(body.p_qr_code === pallet?.qr_code ? state.contents.map(item => ({ qr_code: pallet.qr_code, product_name: item.product_name,
        product_sku: item.product_sku, batch_number: item.batch_number, quantity: item.quantity, unit_of_measure: item.unit_of_measure,
        physical_location: pallet.current_location, last_event_type: lastEvent?.event_type ?? null,
        last_event_at: lastEvent?.created_at ?? null, actor_name: 'Operador Demo', actor_role: role })) : []); return true;
    }
    const order = state.orders.find(order => order.id === body.p_order_id);
    const relation = state.relations.find(row => row.order_id === order?.id && row.pallet_id === pallet?.id);
    if (fn === 'get_order_delivery_pallets') {
      send(role === 'driver_operator' && order?.driver_id === actor && relation ? relation.expected_items.map(item => {
        const lot = lots.find(lot => lot.id === item.batchId); const product = lot.products;
        return { pallet_id: pallet.id, qr_code: pallet.qr_code, product_name: product.name, product_sku: product.sku,
          batch_number: lot.batch_number, quantity: item.quantity, unit_of_measure: product.unit_of_measure,
          delivery_outcome: relation.delivery_outcome, processed_at: relation.delivered_at };
      }) : []); return true;
    }
    if (fn === 'confirm_dispatch_order') {
      let outcome = role !== 'warehouse_operator' ? 'forbidden' : !order ? 'order_not_found' : order.status !== 'draft' ? 'invalid_status'
        : !relation ? 'no_pallets' : !relation.validated_at ? 'missing_pallets' : 'confirmed';
      if (outcome === 'confirmed' && (!same(relation.dispatch_items, relation.expected_items) || !same(snapshot(), relation.expected_items))) {
        fail('Hay ítems pendientes de validar o el contenido cambió.', '23514'); return true;
      }
      if (outcome === 'confirmed') {
        Object.assign(order, { status: 'confirmed', confirmed_at: stamp() });
        Object.assign(pallet, { status: 'in_transit', current_location: 'En tránsito' });
        event('dispatch_confirmed', order.id, { pallet_count: 1 }, null);
      }
      send([{ outcome, order_id: order?.id ?? null, status: order?.status ?? null, confirmed_at: order?.confirmed_at ?? null, pallet_count: relation ? 1 : null }]); return true;
    }
    const expectedRole = fn === 'validate_order_pallet_items' ? 'warehouse_operator' : 'driver_operator';
    let outcome = role !== expectedRole ? 'forbidden' : !order ? 'order_not_found' : null;
    if (outcome) { send(result(outcome)); return true; }
    if (fn === 'validate_order_pallet_items') {
      if (order.status !== 'draft') outcome = 'order_not_found';
      else if (body.p_qr_code?.trim() !== pallet?.qr_code) outcome = 'pallet_not_found';
      else if (!relation) outcome = 'wrong_order';
      else if (body.p_items == null && relation.expected_items.length > 1) outcome = 'content_required';
      else {
        const detected = body.p_items == null ? relation.expected_items : normalize(body.p_items);
        if (!same(detected, relation.expected_items) || !same(snapshot(), relation.expected_items)) {
          Object.assign(relation, { dispatch_items: null, validated_at: null, validated_by: null, detected_at_dispatch: false });
          event('dispatch_discrepancy', order.id, { type: 'content_mismatch', qr_code: pallet.qr_code, expected_items: copy(relation.expected_items), detected_items: copy(body.p_items) });
          outcome = 'content_mismatch';
        } else if (relation.validated_at) outcome = 'already_validated';
        else {
          Object.assign(relation, { dispatch_items: copy(detected), validated_at: stamp(), validated_by: actor, detected_at_dispatch: true });
          event('qr_scan', order.id, { qr_code: pallet.qr_code, validation_round: 1 }); outcome = 'validated';
        }
      }
      const rows = result(outcome); rows[0].validated_at = relation?.validated_at ?? null;
      if (['content_required', 'content_mismatch'].includes(outcome)) Object.assign(rows[0], { product_name: null, product_sku: null, batch_number: null });
      send(rows); return true;
    }
    if (order.driver_id !== actor) outcome = 'forbidden';
    else if (body.p_qr_code?.trim() !== pallet?.qr_code) outcome = 'pallet_not_found';
    else if (!relation) outcome = 'wrong_order';
    else if (relation.delivery_outcome) outcome = 'already_processed';
    else if (body.p_items == null && relation.expected_items.length > 1 && body.p_discrepancy_type !== 'missing') outcome = 'content_required';
    else if (order.status !== 'confirmed') outcome = 'invalid_status';
    else if (pallet.status !== 'in_transit') outcome = 'invalid_pallet_status';
    else {
      const detected = body.p_discrepancy_type === 'missing' ? [] : body.p_items == null ? relation.expected_items : normalize(body.p_items);
      if (!detected) outcome = 'invalid_input';
      else {
        const difference = body.p_discrepancy_type === 'missing' ? 'missing' : !same(detected, relation.expected_items) ? 'content_mismatch' : body.p_discrepancy_type;
        if (difference && !['missing', 'damaged', 'content_mismatch'].includes(difference)) { send(result('invalid_discrepancy_type')); return true; }
        Object.assign(relation, { reception_items: copy(detected), delivery_outcome: difference ?? 'delivered', delivered_at: stamp(), delivered_by: actor });
        Object.assign(order, { status: difference ? 'delivered_with_discrepancy' : 'delivered', delivered_at: stamp() });
        const status = difference ? 'delivery_discrepancy' : 'delivered';
        if (difference !== 'missing') movement(order.id, pallet.current_location, 'Destinatario Demo', status);
        Object.assign(pallet, { status, current_location: difference === 'missing' ? pallet.current_location : 'Destinatario Demo' });
        event('delivery_confirmed', order.id, { qr_code: pallet.qr_code, outcome: difference ?? 'delivered', recipient_id: order.distributor_id });
        if (difference) event('delivery_discrepancy', order.id, { type: difference, qr_code: pallet.qr_code });
        event('reception', order.id, { expected_items: copy(relation.expected_items), detected_items: copy(body.p_items), normalized_items: detected,
          reported_discrepancy: body.p_discrepancy_type, outcome: difference ?? 'delivered' });
        outcome = 'delivered';
      }
    }
    const rows = result(outcome); rows[0].registered_at = relation?.delivered_at ?? null; send(rows); return true;
  };
}
