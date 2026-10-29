import { expect, test } from "@playwright/test";

test.setTimeout(180_000);

for (const width of [390, 768, 1280]) {
  test(`Cuenta y plan muestra catálogo y asignación real a ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await request.post("http://127.0.0.1:54329/test/reset");
    await page.goto("/login");
    await page.getByLabel("Email").fill("logistica@trazflow.test");
    await page.getByLabel("Contraseña").fill("test1234");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Centro de control" })).toBeVisible({ timeout: 60_000 });
    if (width < 1024) await page.getByRole("button", { name: "Menú", exact: true }).click();
    await page.getByRole("link", { name: "Tu cuenta: ver plan de la empresa", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Cuenta y plan", exact: true })).toBeVisible({ timeout: 60_000 });
    const current = page.getByRole("region", { name: "Plan actual", exact: true });
    await expect(current.getByText("Sin plan asignado", { exact: true })).toBeVisible();
    const starter = page.getByRole("article", { name: "Starter", exact: true });
    await expect(starter.getByText(/US\$\s*69/)).toBeVisible();
    await expect(starter.getByText("Hasta 3 operadores", { exact: true })).toBeVisible();
    await expect(starter.getByText("Hasta 500 pallets por mes", { exact: true })).toBeVisible();
    const growth = page.getByRole("article", { name: "Growth", exact: true });
    await expect(growth.getByText(/US\$\s*269/)).toBeVisible();
    await expect(growth.getByText("Hasta 3.000 pallets por mes", { exact: true })).toBeVisible();
    const enterprise = page.getByRole("article", { name: "Enterprise", exact: true });
    await expect(enterprise.getByText("A medida", { exact: true })).toBeVisible();
    await expect(enterprise.getByText("Operadores ilimitados", { exact: true })).toBeVisible();
    const equipment = page.getByRole("table", { name: "Equipamiento por plan", exact: true });
    await expect(equipment.getByText(/US\$\s*450/)).toBeVisible();
    await expect(equipment.getByText(/US\$\s*1\.350/)).toBeVisible();
    await expect(page.getByText("Consumibles según uso", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(equipment.getByText("No especificado", { exact: true })).toBeVisible();
    await expect(starter.getByText("Suscripción mensual en USD", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /seleccionar|contratar|activar|pagar/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /seleccionar|contratar|activar|pagar/i })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`), fullPage: true });

    await request.post("http://127.0.0.1:54329/test/plan", { data: { code: "growth" } });
    await page.reload();
    await expect(current.getByRole("heading", { name: "Growth", exact: true })).toBeVisible();
    await expect(growth.getByText("Tu plan actual", { exact: true })).toBeVisible();
    await expect(starter.getByText("Tu plan actual", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`account-growth-${width}.png`), fullPage: true });

    // Un catálogo distinto verifica que la UI no dependa de nombres o precios fijos.
    await request.post("http://127.0.0.1:54329/test/plan", { data: { code: "custom", plans: [
      { code: "custom", name: "Plan de prueba", monthly_price_cents: 0, currency: "USD",
        max_operators: 2, max_pallets_per_month: null, printer_count: null,
        printer_model: "Modelo de prueba", equipment_price_cents: 0, preliminary: false },
    ] } });
    await page.reload();
    const custom = page.getByRole("article", { name: "Plan de prueba", exact: true });
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(custom.getByText(/US\$\s*0/)).toBeVisible();
    await expect(custom.getByText("Hasta 2 operadores", { exact: true })).toBeVisible();
    await expect(custom.getByText("Pallets sin límite mensual", { exact: true })).toBeVisible();
    await expect(custom.getByText("Tu plan actual", { exact: true })).toBeVisible();
    await expect(equipment.getByText("No especificado", { exact: true })).toBeVisible();
    await expect(equipment.getByText(/US\$\s*0/)).toBeVisible();
    await expect(page.getByText("Propuesta comercial preliminar", { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await request.post("http://127.0.0.1:54329/test/plan", { data: { plans: [] } });
    await page.reload();
    await expect(page.getByText("Todavía no hay planes publicados", { exact: true })).toBeVisible();
    await expect(current.getByText("Sin plan asignado", { exact: true })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(equipment).toHaveCount(0);

    await request.post("http://127.0.0.1:54329/test/plan", { data: { unavailable: true } });
    await page.reload();
    await expect(page.getByText("No pudimos consultar el plan de tu empresa.", { exact: false })).toBeVisible();
    await expect(current.getByText("Sin plan asignado", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No pudimos cargar el catálogo de planes.", { exact: false })).toBeVisible();
  });
}

test("el chofer no accede al catálogo comercial", async ({ page, request }) => {
  await request.post("http://127.0.0.1:54329/test/reset");
  await page.goto("/login");
  await page.getByLabel("Email").fill("chofer@trazflow.test");
  await page.getByLabel("Contraseña").fill("test1234");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mis entregas", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto("/dashboard/account");
  await expect(page).toHaveURL(/\/dashboard\/deliveries$/);
  await expect(page.getByRole("link", { name: "Tu cuenta: ver plan de la empresa", exact: true })).toHaveCount(0);
});
