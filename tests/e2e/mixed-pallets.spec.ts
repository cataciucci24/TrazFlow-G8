import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { QRCodeWriter, BarcodeFormat } from '@zxing/library';

const fixture = 'http://127.0.0.1:54329';
const code = 'PAL-MIXTO-001';
const actor = '10000000-0000-4000-8000-000000000001';
const firstOrder = '20000000-0000-4000-8000-000000000001';
const secondOrder = '20000000-0000-4000-8000-000000000002';
const firstLot = '60000000-0000-4000-8000-000000000001';
const secondLot = '60000000-0000-4000-8000-000000000002';
const observations = [{ productSku: 'ARZ-1', batchNumber: 'LOTE-1', quantity: 10 },
  { productSku: 'QSO-2', batchNumber: 'LOTE-2', quantity: 2.5 }];
const state = async (request: APIRequestContext) => {
  const response = await request.get(`${fixture}/test/pallets/state`);
  expect(response.ok()).toBeTruthy();
  return response.json();
};
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${email}@trazflow.test`);
  await page.getByLabel('Contraseña').fill('test1234');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  // Login pasa por complete-registration y dashboard; el chofer tiene otra redirección.
  // Esperar su destino final evita que el siguiente goto compita con esa navegación.
  await expect(page).toHaveURL(email === 'chofer' ? /\/dashboard\/deliveries$/ : /\/dashboard$/, { timeout: 60_000 });
  await expect(page.getByRole('main')).toBeVisible();
  if (email === 'chofer') await expect(page.getByRole('heading', { name: 'Mis entregas', exact: true })).toBeVisible();
}
async function createOrder(page: Page) {
  await page.goto('/dashboard/orders/new');
  await page.getByLabel('Distribuidor de destino').selectOption('40000000-0000-4000-8000-000000000001');
  await page.getByLabel('Fecha estimada de despacho').fill('2099-01-01');
  await page.getByRole('checkbox', { name: new RegExp(code) }).check();
  await page.getByRole('button', { name: 'Crear orden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?created=1/);
}
async function openDispatch(page: Page, orderId: string) {
  await login(page, 'deposito');
  await page.goto(`/dashboard/orders/${orderId}`);
  await expect(page.getByRole('heading', { name: 'Confirmar despacho', exact: true }).first()).toBeVisible();
}
async function openContents(page: Page) {
  await page.getByLabel('Código del pallet', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Validar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Validar contenido del pallet' });
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveCount(2);
  await expect(dialog.getByLabel('SKU', { exact: true }).nth(0)).toHaveValue('ARZ-1');
  await expect(dialog.getByLabel('SKU', { exact: true }).nth(1)).toHaveValue('QSO-2');
  await expect(dialog.getByLabel('Lote', { exact: true }).nth(1)).toHaveValue('LOTE-2');
  await expect(dialog.getByLabel('Cantidad', { exact: true }).nth(1)).toHaveValue('2.5');
  return dialog;
}
async function dispatch(page: Page) {
  const dialog = await openContents(page);
  await dialog.getByRole('button', { name: 'Comparar y confirmar', exact: true }).click();
  await expect(page.getByText('Carga sin inconsistencias', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar despacho', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirmar despacho' }).getByRole('button', { name: 'Confirmar despacho', exact: true }).click();
  // La revalidación desmonta el botón cuando la orden deja de estar en borrador.
  await expect(page.getByRole('dialog', { name: 'Confirmar despacho' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar despacho', exact: true })).toHaveCount(0);
}
async function camera(page: Page) {
  const matrix = new QRCodeWriter().encode(code, BarcodeFormat.QR_CODE, 280, 280, new Map());
  const pixels: number[] = [];
  for (let y = 0; y < 280; y++) for (let x = 0; x < 280; x++) if (matrix.get(x, y)) pixels.push(y * 280 + x);
  await page.addInitScript(({ pixels }) => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      const draw = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 400, 400); ctx.fillStyle = 'black';
        for (const pixel of pixels) ctx.fillRect(60 + pixel % 280, 60 + Math.floor(pixel / 280), 1, 1);
      };
      draw(); const timer = setInterval(draw, 100); const stream = canvas.captureStream(10);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream;
    } });
  }, { pixels });
}

for (const difference of [false, true]) {
  test(`pallet mixto manual: despacho, recepción ${difference ? 'con diferencias' : 'exacta'}, reingreso y nueva orden`, async ({ page, request }) => {
    await request.post(`${fixture}/test/reset`);
    await request.post(`${fixture}/test/pallets/reset`);
    await camera(page);
    await test.step('Armar dos lotes con un solo QR y cantidades de unidades distintas', async () => {
      await login(page, 'logistica');
      await page.goto('/dashboard/pallets/armar');
      await page.getByLabel('Producto y lote').selectOption(firstLot);
      await page.getByLabel('Cantidad', { exact: false }).fill('10');
      await page.getByRole('button', { name: 'Agregar ítem', exact: true }).click();
      await page.getByLabel('Producto y lote').nth(1).selectOption(secondLot);
      await page.getByLabel('Cantidad', { exact: false }).nth(1).fill('2.5');
      await expect(page.getByLabel('Producto y lote').nth(1).locator(`option[value="${firstLot}"]`)).toHaveAttribute('disabled', '');
      await page.getByRole('button', { name: 'Armar pallet con un único QR', exact: true }).click();
      await expect(page.getByText(`Pallet ${code} armado con 2 ítem(s) y un único QR.`, { exact: true })).toBeVisible();
      const data = await state(request);
      expect(data.pallets).toHaveLength(1); expect(data.contents).toHaveLength(2);
      expect(new Set(data.contents.map((item: { pallet_id: string }) => item.pallet_id)).size).toBe(1);
      expect(data.calls.find((call: { fn: string }) => call.fn === 'create_pallet_with_items').args).toEqual({
        p_items: [{ batch_id: firstLot, quantity: 10 }, { batch_id: secondLot, quantity: 2.5 }], p_warehouse_code: 'CENTRAL',
      });
    });
    await test.step('Crear orden manual y asignar chofer desde la interfaz', async () => {
      await createOrder(page);
      await page.goto(`/dashboard/orders/${firstOrder}`);
      await page.getByLabel('Chofer asignado').selectOption(actor);
      await page.getByRole('button', { name: 'Asignar', exact: true }).click();
      await expect(page.getByText('Chofer asignado correctamente.', { exact: true })).toBeVisible();
      const data = await state(request);
      expect(data.orders[0]).toMatchObject({ external_id: null, source_system: 'trazflow', driver_id: actor });
      expect(data.relations[0].expected_items).toHaveLength(2);
    });
    await test.step('Rechazar diferencias de cantidad, producto, lote, faltante y sobrante antes de despachar', async () => {
      await openDispatch(page, firstOrder);
      await expect(page.getByRole('button', { name: 'Confirmar despacho', exact: true })).toBeDisabled();
      for (const variant of ['quantity', 'sku', 'batch', 'missing', 'surplus']) {
        const dialog = await openContents(page);
        if (variant === 'quantity') await dialog.getByLabel('Cantidad', { exact: true }).nth(1).fill('2');
        if (variant === 'sku') await dialog.getByLabel('SKU', { exact: true }).nth(1).fill('DESCONOCIDO');
        if (variant === 'batch') await dialog.getByLabel('Lote', { exact: true }).nth(1).fill('LOTE-OTRO');
        if (variant === 'missing') await dialog.getByRole('button', { name: 'Quitar ítem 2', exact: true }).click();
        if (variant === 'surplus') {
          await dialog.getByRole('button', { name: 'Agregar ítem detectado', exact: true }).click();
          await dialog.getByLabel('SKU', { exact: true }).nth(2).fill('ARZ-1');
          await dialog.getByLabel('Lote', { exact: true }).nth(2).fill('LOTE-1');
          await dialog.getByLabel('Cantidad', { exact: true }).nth(2).fill('1');
        }
        await dialog.getByRole('button', { name: 'Comparar y confirmar', exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByText('Hay diferencias por ítem pendientes de corregir.', { exact: false })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Confirmar despacho', exact: true })).toBeDisabled();
        const data = await state(request);
        expect(data.relations[0].validated_at).toBeNull(); expect(data.relations[0].dispatch_items).toBeNull();
        expect(data.events.at(-1)).toMatchObject({ event_type: 'dispatch_discrepancy', details: { type: 'content_mismatch' } });
      }
      await dispatch(page);
      const data = await state(request);
      expect(data.relations[0].dispatch_items).toEqual(data.relations[0].expected_items);
      expect(data.pallets[0].status).toBe('in_transit');
    });
    await test.step('Recepción por ítem con el lector QR real sobre cámara sintética', async () => {
      await login(page, 'chofer');
      await page.goto(`/dashboard/deliveries/${firstOrder}`);
      await expect(page.getByText('0 / 1', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /Escanear pallet en la entrega/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Confirmar resultado' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('SKU', { exact: true })).toHaveCount(2);
      await expect(dialog.getByLabel('Cantidad', { exact: true }).nth(1)).toHaveValue('2.5');
      if (difference) await dialog.getByLabel('Cantidad', { exact: true }).nth(1).fill('2');
      await dialog.getByRole('button', { name: 'Confirmar recepción por ítem', exact: true }).click();
      await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
      await expect(page.getByText(difference ? 'Diferencia por ítem' : 'Entregado', { exact: true })).toBeVisible();
      const data = await state(request);
      expect(data.relations[0].delivery_outcome).toBe(difference ? 'content_mismatch' : 'delivered');
      expect(data.relations[0].reception_items[1].quantity).toBe(difference ? 2 : 2.5);
      const reception = data.events.find((event: { event_type: string }) => event.event_type === 'reception');
      expect(reception.details.expected_items).toEqual(data.relations[0].expected_items);
      expect(reception.details.detected_items).toEqual(observations.map((item, index) => ({ ...item, quantity: difference && index === 1 ? 2 : item.quantity })));
      await page.goto('/dashboard/pallets');
      await expect(page).not.toHaveURL(/\/dashboard\/pallets$/);
    });
    const before = await state(request);
    await test.step('Logística reingresa todo el pallet y exige motivo; reintentar no duplica historia', async () => {
      await login(page, 'logistica'); await page.goto('/dashboard/pallets');
      await page.getByRole('button', { name: 'Reingresar pallet', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Reingresar pallet a depósito' });
      await dialog.getByLabel('QR del pallet').fill(code);
      await expect(dialog.getByRole('button', { name: 'Confirmar reingreso', exact: true })).toBeDisabled();
      await dialog.getByLabel('Motivo del reingreso').fill('   ');
      await expect(dialog.getByRole('button', { name: 'Confirmar reingreso', exact: true })).toBeDisabled();
      expect((await state(request)).calls.filter((call: { fn: string }) => call.fn === 'return_pallet_to_warehouse')).toHaveLength(0);
      await dialog.getByLabel('Motivo del reingreso').fill('Devolución completa del cliente');
      await dialog.getByRole('button', { name: 'Confirmar reingreso', exact: true }).click();
      await expect(dialog.getByText('Pallet reingresado. Ya está disponible para una nueva orden.', { exact: true })).toBeVisible();
      const returned = await state(request);
      expect(returned.pallets[0]).toMatchObject({ status: 'in_warehouse', current_location: 'Depósito' });
      expect(returned.contents).toEqual(before.contents); expect(returned.relations[0]).toEqual(before.relations[0]);
      expect(returned.events.slice(0, before.events.length)).toEqual(before.events);
      expect(returned.events.at(-1)).toMatchObject({ event_type: 'pallet_returned', order_id: firstOrder,
        details: { reason: 'Devolución completa del cliente', items: before.relations[0].expected_items } });
      await dialog.getByLabel('QR del pallet').fill(code);
      await dialog.getByLabel('Motivo del reingreso').fill('Reintento');
      await dialog.getByRole('button', { name: 'Confirmar reingreso', exact: true }).click();
      await expect(dialog.getByText('El pallet ya está en depósito.', { exact: true })).toBeVisible();
      expect((await state(request)).events).toEqual(returned.events);
    });
    await test.step('Reutilizar en otra orden sin borrar recepción ni eventos de la anterior', async () => {
      await createOrder(page);
      const data = await state(request);
      expect(data.relations).toHaveLength(2);
      expect(data.relations[0]).toEqual(before.relations[0]);
      expect(data.relations[1]).toMatchObject({ order_id: secondOrder, expected_items: before.relations[0].expected_items,
        dispatch_items: null, reception_items: null, delivery_outcome: null });
      await page.goto(`/dashboard/traceability?qr=${code}`);
      await expect(page.getByRole('heading', { name: 'Trazabilidad de pallet', exact: true })).toBeVisible();
      await expect(page.getByText('Entrega confirmada por el chofer', { exact: true })).toBeVisible();
      await expect(page.getByText('Recepción registrada', { exact: true })).toBeVisible();
      await expect(page.getByText('pallet_returned', { exact: true })).toBeVisible();
      await expect(page.getByText('Despacho confirmado', { exact: true })).toBeVisible();
      await page.goto(`/dashboard/orders/${firstOrder}`);
      await expect(page.getByRole('table', { name: 'Pallets asociados a la orden' })).toContainText('QSO-2');
      await page.goto(`/dashboard/orders/${secondOrder}`);
      await expect(page.getByRole('table', { name: 'Pallets asociados a la orden' })).toContainText(code);
    });
  });
}
