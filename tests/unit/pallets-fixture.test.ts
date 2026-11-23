import { describe, expect, it } from 'vitest';
import { createPalletsScenario, mixedCode } from '../../scripts/e2e-pallets-scenario.mjs';

const firstLot = '60000000-0000-4000-8000-000000000001';
const secondLot = '60000000-0000-4000-8000-000000000002';
const items = [{ batch_id: firstLot, quantity: 10 }, { batch_id: secondLot, quantity: 2.5 }];
function fixture() {
  const handle = createPalletsScenario();
  return (path: string, body = {}, role = 'logistics_manager', method = path.includes('/rpc/') ? 'POST' : 'GET') => {
    let response: { data: unknown; status: number } | undefined;
    const handled = handle({ req: { method, headers: {} }, url: new URL(path, 'http://127.0.0.1:54329'), body, role,
      send: (data: unknown, status = 200) => { response = { data, status }; } });
    return { handled, ...response };
  };
}
describe('contratos del escenario HTTP de pallets manuales', () => {
  it('crea un pallet y dos filas de pallet_contents; las consultas respetan filtros', () => {
    const request = fixture();
    expect(request('/rest/v1/rpc/create_pallet_with_items', { p_items: items, p_warehouse_code: 'CENTRAL' })).toMatchObject({
      status: 200, data: [{ pallet_id: '30000000-0000-4000-8000-000000000001', qr_code: mixedCode }],
    });
    const contents = request('/rest/v1/pallet_contents', {}, 'logistics_manager', 'GET').data;
    expect(contents).toEqual([
      expect.objectContaining({ batch_id: firstLot, product_sku: 'ARZ-1', quantity: 10, lot_source_system: 'trazflow' }),
      expect.objectContaining({ batch_id: secondLot, product_sku: 'QSO-2', quantity: 2.5, lot_source_system: 'trazflow' }),
    ]);
    expect(request('/rest/v1/pallets?status=eq.assigned').data).toEqual([]);
    expect(request('/rest/v1/batches?id=in.(60000000-0000-4000-8000-000000000002)').data).toEqual([
      expect.objectContaining({ id: secondLot, products: expect.objectContaining({ sku: 'QSO-2' }) }),
    ]);
  });
  it.each([
    [[], 'logistics_manager'],
    [[items[0], items[0]], 'logistics_manager'],
    [[{ batch_id: firstLot, quantity: 0 }], 'logistics_manager'],
    [[{ batch_id: firstLot, quantity: 1.5 }], 'logistics_manager'],
    [[{ batch_id: secondLot, quantity: 1.001 }], 'logistics_manager'],
    [[{ batch_id: 'unknown', quantity: 1 }], 'logistics_manager'],
    [items, 'driver_operator'],
  ])('rechaza armado inválido sin dejar un pallet parcial: %j / %s', (invalidItems, role) => {
    const request = fixture();
    expect(request('/rest/v1/rpc/create_pallet_with_items', { p_items: invalidItems, p_warehouse_code: 'CENTRAL' }, role).status).toBe(role === 'driver_operator' ? 403 : 400);
    expect(request('/rest/v1/pallets').data).toEqual([]);
    expect(request('/rest/v1/pallet_contents').data).toEqual([]);
  });
  it('exige rol, motivo y estado real para reingresar; no genera eventos al rechazar', () => {
    const request = fixture();
    request('/rest/v1/rpc/create_pallet_with_items', { p_items: items, p_warehouse_code: 'CENTRAL' });
    const path = '/rest/v1/rpc/return_pallet_to_warehouse';
    for (const [reason, role, outcome] of [
      ['Devolución', 'warehouse_operator', 'forbidden'],
      [' ', 'logistics_manager', 'invalid_input'],
      ['x'.repeat(1001), 'logistics_manager', 'invalid_input'],
      ['Reintento', 'logistics_manager', 'already_in_warehouse'],
    ]) expect(request(path, { p_qr_code: mixedCode, p_reason: reason }, role).data).toEqual([
      expect.objectContaining({ outcome }),
    ]);
    request('/rest/v1/pallets?status=eq.in_warehouse', { status: 'assigned' }, 'logistics_manager', 'PATCH');
    expect(request(path, { p_qr_code: mixedCode, p_reason: 'No entregado' }).data).toEqual([
      expect.objectContaining({ outcome: 'invalid_status' }),
    ]);
    expect(request('/rest/v1/traceability_events').data).toEqual([]);
    expect(request('/rest/v1/movements').data).toEqual([]);
  });
  it('no simula silenciosamente RPC desconocidas y reinicia el escenario completo', () => {
    const request = fixture();
    expect(request('/rest/v1/rpc/unknown')).toEqual({ handled: false });
    request('/rest/v1/rpc/create_pallet_with_items', { p_items: items, p_warehouse_code: 'CENTRAL' });
    request('/test/pallets/reset');
    expect(request('/test/pallets/state').data).toEqual({ pallets: [], contents: [], orders: [], relations: [], events: [], movements: [], calls: [] });
  });
  it('no filtra la fecha de una validación previa en resultados rechazados', () => {
    const request = fixture();
    const order = '20000000-0000-4000-8000-000000000001';
    request('/rest/v1/rpc/create_pallet_with_items', { p_items: items, p_warehouse_code: 'CENTRAL' });
    request('/rest/v1/dispatch_orders', {}, 'logistics_manager', 'POST');
    request('/rest/v1/pallets?status=eq.in_warehouse', { status: 'assigned' }, 'logistics_manager', 'PATCH');
    request('/rest/v1/order_pallets', [{ order_id: order, pallet_id: '30000000-0000-4000-8000-000000000001', expected: true }], 'logistics_manager', 'POST');
    const path = '/rest/v1/rpc/validate_order_pallet_items';
    expect(request(path, { p_order_id: order, p_qr_code: mixedCode, p_items: [
      { productSku: 'ARZ-1', batchNumber: 'LOTE-1', quantity: 10 }, { productSku: 'QSO-2', batchNumber: 'LOTE-2', quantity: 2.5 },
    ] }, 'warehouse_operator').data).toEqual([expect.objectContaining({ outcome: 'validated', validated_at: expect.any(String) })]);
    expect(request(path, { p_order_id: order, p_qr_code: mixedCode, p_items: null }, 'warehouse_operator').data).toEqual([{
      outcome: 'content_required', pallet_id: '30000000-0000-4000-8000-000000000001', qr_code: mixedCode,
      product_name: null, product_sku: null, batch_number: null, validated_at: null,
    }]);
    expect(request(path, { p_order_id: order, p_qr_code: 'PAL-INEXISTENTE', p_items: [] }, 'warehouse_operator').data).toEqual([{
      outcome: 'pallet_not_found', pallet_id: null, qr_code: null, product_name: null, product_sku: null, batch_number: null, validated_at: null,
    }]);
  });
});
