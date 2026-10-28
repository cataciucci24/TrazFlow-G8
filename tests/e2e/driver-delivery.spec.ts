import { expect, test } from '@playwright/test';
import { QRCodeWriter, BarcodeFormat } from '@zxing/library';
const code = 'PAL-DEMO-001';
const matrix = new QRCodeWriter().encode(code, BarcodeFormat.QR_CODE, 280, 280, new Map());
const blackPixels: number[] = [];
for (let y = 0; y < 280; y++) for (let x = 0; x < 280; x++) if (matrix.get(x, y)) blackPixels.push(y * 280 + x);

test('el chofer procesa un QR y la entrega queda cerrada', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  // Pausas para exponer las pantallas, nunca para sincronizar las aserciones.
  // Solo se activan con la configuración de presentación.
  const present = async (milliseconds = 4000) => {
    if (testInfo.config.metadata.presentation) await page.waitForTimeout(milliseconds);
  };
  await request.post('http://127.0.0.1:54329/test/reset');
  // Cámara sintética: el lector ZXing de producción decodifica los píxeles reales.
  // No reemplazamos el lector ni llamamos directamente a onScan o la Server Action.
  await page.addInitScript(({ pixels }) => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      const draw = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 400, 400);
        ctx.fillStyle = 'black';
        for (const position of pixels) ctx.fillRect(60 + position % 280, 60 + Math.floor(position / 280), 1, 1);
      };
      draw();
      const timer = setInterval(draw, 100);
      const stream = canvas.captureStream(10);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    } });
  }, { pixels: blackPixels });

  await test.step('Ingresar como chofer', async () => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('chofer@trazflow.test');
    await page.getByLabel('Contraseña').fill('test1234');
    await present();
    await page.getByRole('button', { name: 'Ingresar' }).click();
    // La primera navegación compila dashboard y entregas en next dev.
    await expect(page.getByRole('heading', { name: 'Mis entregas' })).toBeVisible({ timeout: 60_000 });
    await present();
  });
  await test.step('Abrir la orden asignada', async () => {
    await page.getByRole('link').filter({ hasText: 'Destinatario Demo' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmar entrega' })).toBeVisible();
    await expect(page.getByText('0 / 1', { exact: true })).toBeVisible();
    await present();
  });
  await test.step('Escanear y confirmar el QR', async () => {
    await page.getByRole('button', { name: /Escanear pallet en la entrega/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirmar resultado' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(code, { exact: true })).toBeVisible();
    const details = dialog.getByRole('region', { name: 'Ficha del pallet escaneado' });
    await expect(details.getByText('10 cajas', { exact: true })).toBeVisible();
    await expect(details.getByText('En tránsito', { exact: true })).toBeVisible();
    await expect(details.getByText('Despacho confirmado', { exact: true })).toBeVisible();
    await expect(details.getByText('Operador Demo · Operador de depósito', { exact: true })).toBeVisible();
    await expect(details).not.toContainText('chofer@');
    await page.screenshot({ path: testInfo.outputPath('trz106-mobile.png') });
    await present();
    await dialog.getByRole('button', { name: 'Entregado', exact: true }).click();
    await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Entregado', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Escanear pallet en la entrega/ })).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Ficha del pallet escaneado' }).getByText('Entrega confirmada', { exact: true })).toBeVisible();
    await present();
    const state = await request.get('http://127.0.0.1:54329/test/state');
    expect(await state.json()).toEqual({ delivered: true, confirmations: 1 });
  });
  await test.step('La entrega cerrada desaparece de pendientes', async () => {
    await page.getByRole('link', { name: 'Volver', exact: true }).click();
    await expect(page.getByText('No tenés entregas asignadas')).toBeVisible();
    await present(4000);
  });
});
