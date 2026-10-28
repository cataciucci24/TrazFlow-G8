import { expect, test, type Page } from "@playwright/test";

// Each scenario visits several lazily compiled Next.js routes and captures them.
test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill("test1234");
  await page.getByRole("button", { name: "Ingresar" }).click();
  const heading = email === "deposito@trazflow.test" ? "Confirmar despacho" : "Centro de control";
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 60_000 });
}

async function fitsViewport(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:54329/test/reset");
});

for (const width of [320, 390, 768, 1280]) {
  test(`logística conserva datos y acciones sin desbordar a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page, "logistica@trazflow.test");
    await expect(page.getByRole("heading", { name: "Centro de control" })).toBeVisible();
    await fitsViewport(page);

    if (width < 1024) {
      const menu = page.getByRole("button", { name: "Menú", exact: true });
      const menuBox = await menu.boundingBox();
      expect(menuBox!.x).toBeLessThan(width / 2);
      await menu.click();
      const dialog = page.getByRole("dialog", { name: "Menú de navegación de TrazFlow" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("link", { name: "Órdenes de despacho", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await menu.click();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(menu).toBeFocused();
    } else {
      await expect(page.getByRole("button", { name: "Menú", exact: true })).not.toBeVisible();
    }

    for (const [path, tableName] of [
      ["orders", "Órdenes de despacho registradas"],
      ["pallets", "Pallets registrados"],
      ["integrations", "Actividad de la integración ERP"],
    ]) {
      await page.goto(`/dashboard/${path}`);
      const table = page.getByRole("table", { name: tableName, exact: true });
      await expect(table).toBeVisible();
      const row = table.locator("tbody tr").first();
      await expect(row).toHaveCSS("display", width < 768 ? "grid" : "table-row");
      for (const cell of await row.getByRole("cell").all()) await expect(cell).toBeVisible();
      await fitsViewport(page);
      await page.screenshot({ path: testInfo.outputPath(`${path}-${width}.png`), fullPage: true });
    }

    await page.goto("/dashboard/pallets");
    await page.getByRole("searchbox", { name: "Buscar", exact: true }).fill("NO-EXISTE");
    await expect(page.getByText("Sin resultados para estos filtros")).toBeVisible();
    await page.getByRole("searchbox", { name: "Buscar", exact: true }).fill("PAL-DEMO-001");
    await expect(page.getByRole("table", { name: "Pallets registrados", exact: true })).toBeVisible();
    const actions = page.getByRole("button", { name: "Acciones del pallet PAL-DEMO-001" });
    await actions.click();
    const actionMenu = page.getByRole("menu", { name: "Acciones del pallet PAL-DEMO-001" });
    await expect(actionMenu).toBeVisible();
    const menuBounds = await actionMenu.boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(actionMenu).not.toBeVisible();
    await expect(actions).toBeFocused();
  });
}

test("depósito valida por código y mantiene escaneo y confirmación al alcance del pulgar", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "deposito@trazflow.test");
  await page.getByRole("link").filter({ hasText: "Destinatario Demo" }).click();
  const scan = page.getByRole("button", { name: "Abrir cámara para escanear QR" });
  const confirm = page.getByRole("button", { name: "Confirmar despacho", exact: true });
  // La primera apertura también compila el detalle de la orden en next dev.
  await expect(scan).toBeVisible({ timeout: 60_000 });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Código del pallet").fill("PAL-DEMO-001");
  await page.getByRole("button", { name: "Validar", exact: true }).click();
  await expect(page.locator(".feedback-success").filter({ hasText: "Pallet validado correctamente." })).toBeVisible();
  const details = page.getByRole("region", { name: "Ficha del pallet escaneado" });
  await expect(details.getByText("Validación de carga", { exact: true })).toBeVisible();
  await expect(details.getByText("10 cajas", { exact: true })).toBeVisible();
  await expect(confirm).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scanBox = await scan.boundingBox();
  const confirmBox = await confirm.boundingBox();
  expect(scanBox!.height).toBeGreaterThanOrEqual(48);
  expect(confirmBox!.height).toBeGreaterThanOrEqual(48);
  expect(scanBox!.y).toBeGreaterThan(844 / 2);
  expect(scanBox!.y + scanBox!.height).toBeLessThanOrEqual(confirmBox!.y);
  expect(confirmBox!.y + confirmBox!.height).toBeLessThanOrEqual(844);
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath("dispatch-mobile.png"), fullPage: true });
  await confirm.click();
  const dialog = page.getByRole("dialog", { name: "Confirmar despacho", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirmar despacho", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
