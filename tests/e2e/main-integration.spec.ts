import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("logistica@trazflow.test");
  await page.getByLabel("Contraseña").fill("test1234");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:54329/test/reset");
  await request.post("http://127.0.0.1:54329/test/mixed");
});

test("trazabilidad conserva contenido mixto y la línea de tiempo al integrar main", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/traceability?qr=PAL-DEMO-001");
  await expect(page.getByRole("list", { name: "Contenido del pallet" })).toContainText("Queso mixto");
  await expect(page.getByRole("heading", { name: "Línea de tiempo", exact: true })).toBeVisible();
  await expect(page.getByText("Alta en TrazFlow", { exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("remito muestra dos ítems de un solo pallet sin desbordar en móvil", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/orders/20000000-0000-4000-8000-000000000001/remito");
  await expect(page.getByRole("heading", { name: "Remito digital", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Pallets del remito R-000001" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText(/1 pallet.*2 ítems/)).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
