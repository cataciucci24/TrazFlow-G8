import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

async function session(context: BrowserContext, request: APIRequestContext, role: string) {
  const response = await request.get(`http://127.0.0.1:54329/test/session?role=${role}`);
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  await context.addCookies([{
    name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(data)).toString("base64url")}`,
    domain: "127.0.0.1", path: "/",
  }]);
}

test("logística ve fechas, rango, productos y clientes sin historial en celular", async ({ page, context, request }, testInfo) => {
  test.setTimeout(180_000);
  await session(context, request, "logistics_manager");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/next-orders");
  await expect(page.getByRole("heading", { name: "Próximos pedidos", exact: true })).toBeVisible({ timeout: 60_000 });
  const list = page.getByRole("list", { name: "Clientes ordenados por próxima orden" });
  const cards = list.locator(":scope > li");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Cliente atrasado");
  await expect(cards.nth(0)).toContainText("Fecha estimada superada");
  await expect(cards.nth(0)).toContainText("20 cajas por pedido con este producto");
  await expect(cards.nth(1)).toContainText("Rango orientativo");
  await expect(cards.nth(1)).toContainText("Cada 9 días");
  await expect(cards.nth(2)).toContainText("Historial insuficiente");
  await expect(cards.nth(2)).toContainText("Cliente nuevo");
  await page.getByText("Cómo calculamos las fechas", { exact: true }).click();
  await expect(page.getByText(/no garantiza una fecha/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("next-orders-mobile.png"), fullPage: true });
});

test("depósito no accede a las estimaciones ni ve el enlace de logística", async ({ page, context, request }) => {
  test.setTimeout(180_000);
  await session(context, request, "warehouse_operator");
  await page.goto("/dashboard/next-orders");
  await expect(page.getByRole("heading", { name: "Confirmar despacho", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Próximos pedidos", exact: true })).toHaveCount(0);
});

test("un fallo de consulta muestra error y permite reintentar", async ({ page, context, request }) => {
  test.setTimeout(180_000);
  await session(context, request, "logistics_manager");
  await request.get("http://127.0.0.1:54329/test/failure?enabled=1");
  try {
    await page.goto("/dashboard/next-orders");
    await expect(page.getByRole("heading", { name: "No se pudieron calcular los próximos pedidos" })).toBeVisible({ timeout: 60_000 });
    await request.get("http://127.0.0.1:54329/test/failure?enabled=0");
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Próximos pedidos", exact: true })).toBeVisible();
  } finally { await request.get("http://127.0.0.1:54329/test/failure?enabled=0"); }
});
