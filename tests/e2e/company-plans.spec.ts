import { expect, test } from "@playwright/test";

test.setTimeout(180_000);
// Fixtures change between requests; bypass Next's development fetch cache.
test.use({ extraHTTPHeaders: { "Cache-Control": "no-cache" } });

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
    const commercial = page.locator("#equipamiento > summary");
    await commercial.click();
    const equipment = page.getByRole("table", { name: "Equipamiento por plan", exact: true });
    await expect(equipment.getByText(/US\$\s*450/)).toBeVisible();
    await expect(equipment.getByText(/US\$\s*1\.350/)).toBeVisible();
    await expect(page.getByText("Consumibles según uso", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(equipment.getByText("No especificado", { exact: true })).toBeVisible();
    await expect(starter.getByText("Suscripción mensual en USD", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /contratar|activar|pagar|continuar|confirmar/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /contratar|activar|pagar|continuar|confirmar/i })).toHaveCount(0);
    const selectStarter = starter.getByRole("button");
    const selectEnterprise = enterprise.getByRole("button");
    await expect(selectStarter).toHaveAttribute("aria-pressed", "false");
    await selectStarter.focus();
    await page.keyboard.press("Enter");
    await expect(selectStarter).toHaveAttribute("aria-pressed", "true");
    await expect(selectStarter).toHaveText("Seleccionado");
    await expect(selectStarter).toBeDisabled();
    await expect(selectEnterprise).toBeEnabled();
    await expect(page.getByRole("status", { name: "Selección de plan", exact: true })).toContainText("Selección provisional: Starter");
    await expect(page).toHaveURL(/selectedPlan=starter/);
    await selectEnterprise.click();
    await expect(selectStarter).toHaveAttribute("aria-pressed", "false");
    await expect(selectEnterprise).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(1);
    await page.goBack();
    await expect(selectStarter).toHaveAttribute("aria-pressed", "true");
    await page.goForward();
    await expect(selectEnterprise).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(selectEnterprise).toHaveAttribute("aria-pressed", "true");
    await expect(current.getByText("Sin plan asignado", { exact: true })).toBeVisible();
    expect(await (await request.get("http://127.0.0.1:54329/test/plan-state")).json()).toMatchObject({ companyPlanCode: null, planMutations: 0 });
    await page.getByRole("button", { name: "Quitar selección", exact: true }).click();
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/selectedPlan=/);
    await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`), fullPage: true });

    await request.post("http://127.0.0.1:54329/test/plan", { data: { code: "growth" } });
    await page.reload();
    await expect(current.getByRole("heading", { name: "Growth", exact: true })).toBeVisible();
    await expect(growth.getByText("Tu plan actual", { exact: true })).toBeVisible();
    await expect(starter.getByText("Tu plan actual", { exact: true })).toHaveCount(0);
    await expect(growth.getByRole("button", { name: "Plan actual: Growth", exact: true })).toBeDisabled();
    await selectStarter.click();
    await expect(selectStarter).toHaveAttribute("aria-pressed", "true");
    await expect(growth.getByText("Tu plan actual", { exact: true })).toBeVisible();
    await page.reload();
    await expect(current.getByRole("heading", { name: "Growth", exact: true })).toBeVisible();
    await expect(selectStarter).toHaveAttribute("aria-pressed", "true");
    expect(await (await request.get("http://127.0.0.1:54329/test/plan-state")).json()).toMatchObject({ companyPlanCode: "growth", planMutations: 0 });
    await page.screenshot({ path: testInfo.outputPath(`account-growth-${width}.png`), fullPage: true });

    await page.getByRole("link", { name: "Ver resumen del plan", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/account\/review\?selectedPlan=starter/);
    await expect(page.getByRole("heading", { name: "Resumen del plan", exact: true })).toBeVisible();
    const summary = page.getByRole("region", { name: "Starter", exact: true });
    await expect(summary.getByText(/US\$\s*69/)).toBeVisible();
    await expect(summary.getByText("Moneda: USD", { exact: true })).toBeVisible();
    await expect(summary.getByText("Hasta 3 operadores", { exact: true })).toBeVisible();
    await expect(summary.getByText("Hasta 500 pallets por mes", { exact: true })).toBeVisible();
    await expect(summary.getByText("Plan actual de tu empresa: Growth.", { exact: true })).toBeVisible();
    await commercial.click();
    await expect(equipment.getByText("1 unidad", { exact: true })).toBeVisible();
    await expect(equipment.getByText("Zebra ZQ320", { exact: true })).toBeVisible();
    await expect(equipment.getByText(/US\$\s*450/)).toBeVisible();
    await expect(page.getByText("Este plan todavía no fue contratado", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /confirmar|contratar|activar|pagar/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /confirmar|contratar|activar|pagar/i })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`), fullPage: true });
    await page.getByRole("link", { name: "Volver a comparar planes", exact: true }).click();
    await expect(selectStarter).toHaveAttribute("aria-pressed", "true");
    await selectEnterprise.click();
    await page.getByRole("link", { name: "Ver resumen del plan", exact: true }).click();
    const enterpriseSummary = page.getByRole("region", { name: "Enterprise", exact: true });
    await expect(enterpriseSummary.getByText("A medida", { exact: true })).toBeVisible();
    await expect(enterpriseSummary.getByText("Operadores ilimitados", { exact: true })).toBeVisible();
    await commercial.click();
    await expect(equipment.getByText("No especificado", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Volver a comparar planes", exact: true }).click();
    await expect(selectEnterprise).toHaveAttribute("aria-pressed", "true");
    await expect(current.getByRole("heading", { name: "Growth", exact: true })).toBeVisible();
    expect(await (await request.get("http://127.0.0.1:54329/test/plan-state")).json()).toMatchObject({ companyPlanCode: "growth", planMutations: 0 });


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
    await commercial.click();
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
    await expect(page.getByRole("button", { name: /^Seleccionar plan/ })).toHaveCount(0);

    await request.post("http://127.0.0.1:54329/test/plan", { data: { companyPlanUnavailable: true } });
    await page.reload();
    await expect(selectStarter).toBeDisabled();
    await expect(selectEnterprise).toBeDisabled();
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);

  });
}

test("el chofer no accede al catálogo comercial", async ({ page, request }) => {
  await request.post("http://127.0.0.1:54329/test/reset");
  await page.goto("/login");
  await page.getByLabel("Email").fill("chofer@trazflow.test");
  await page.getByLabel("Contraseña").fill("test1234");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mis entregas", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto("/dashboard/account?selectedPlan=starter");
  await expect(page).toHaveURL(/\/dashboard\/deliveries$/);
  await expect(page.getByRole("link", { name: "Tu cuenta: ver plan de la empresa", exact: true })).toHaveCount(0);
  await page.goto("/dashboard/account/review?selectedPlan=starter");
  await expect(page).toHaveURL(/\/dashboard\/deliveries$/);

});


test("los identificadores inválidos no seleccionan planes ni habilitan confirmación", async ({ page, request }) => {
  await request.post("http://127.0.0.1:54329/test/reset");
  await request.post("http://127.0.0.1:54329/test/plan", { data: { code: "growth" } });
  await page.goto("/login");
  await page.getByLabel("Email").fill("logistica@trazflow.test");
  await page.getByLabel("Contraseña").fill("test1234");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Centro de control" })).toBeVisible({ timeout: 60_000 });
  for (const query of ["selectedPlan=missing", "selectedPlan=", "selectedPlan=growth", "selectedPlan=starter&selectedPlan=enterprise"]) {
    await page.goto(`/dashboard/account?${query}`);
    await expect(page.getByText("La selección indicada no está disponible", { exact: false })).toBeVisible();
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Plan actual", exact: true }).getByRole("heading", { name: "Growth", exact: true })).toBeVisible();
    await page.goto(`/dashboard/account/review?${query}`);
    await expect(page.getByRole("heading", { name: "Selección no disponible", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver a comparar planes", exact: true })).toHaveAttribute("href", "/dashboard/account#planes");

  }
  await page.goto("/dashboard/account");
  const starter = page.getByRole("article", { name: "Starter", exact: true }).getByRole("button");
  await starter.click();
  await expect(starter).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("La selección indicada no está disponible", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /continuar|confirmar|contratar|pagar/i })).toHaveCount(0);
  expect(await (await request.get("http://127.0.0.1:54329/test/plan-state")).json()).toMatchObject({ companyPlanCode: "growth", planMutations: 0 });
});

test("depósito no inicia la selección provisional", async ({ page, request }) => {
  await request.post("http://127.0.0.1:54329/test/reset");
  await page.goto("/login");
  await page.getByLabel("Email").fill("deposito@trazflow.test");
  await page.getByLabel("Contraseña").fill("test1234");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Confirmar despacho", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto("/dashboard/account?selectedPlan=starter");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/dashboard/account/review?selectedPlan=starter");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: /^Seleccionar plan/ })).toHaveCount(0);
});

test("sin sesión no se puede acceder a una selección por URL", async ({ page }) => {
  await page.goto("/dashboard/account?selectedPlan=starter");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard/account/review?selectedPlan=starter");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: /^Seleccionar plan/ })).toHaveCount(0);
});


test("el resumen revalida el catálogo vigente y bloquea consultas fallidas", async ({ page, request }) => {
  await request.post("http://127.0.0.1:54329/test/reset");
  const plan = { code: "review-test", name: "Plan de prueba", monthly_price_cents: 9900, currency: "USD",
    max_operators: 2, max_pallets_per_month: 200, printer_count: 1,
    printer_model: "Modelo de prueba", equipment_price_cents: 0, preliminary: false };
  await request.post("http://127.0.0.1:54329/test/plan", { data: { plans: [plan] } });
  await page.goto("/login");
  await page.getByLabel("Email").fill("logistica@trazflow.test");
  await page.getByLabel("Contraseña").fill("test1234");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Centro de control" })).toBeVisible({ timeout: 60_000 });
  await page.goto("/dashboard/account?selectedPlan=review-test");
  await expect(page.getByRole("article", { name: "Plan de prueba", exact: true }).getByText(/US\$\s*99/)).toBeVisible();
  await request.post("http://127.0.0.1:54329/test/plan", { data: { plans: [
    { ...plan, monthly_price_cents: 12345, max_operators: 7, max_pallets_per_month: 987 },
  ] } });
  await page.getByRole("link", { name: "Ver resumen del plan", exact: true }).click();
  const summary = page.getByRole("region", { name: "Plan de prueba", exact: true });
  await expect(summary.getByText(/US\$\s*123,45/)).toBeVisible();
  await expect(summary.getByText("Hasta 7 operadores", { exact: true })).toBeVisible();
  await expect(summary.getByText("Hasta 987 pallets por mes", { exact: true })).toBeVisible();
  await expect(summary.getByText("Tu empresa no tiene un plan asignado.", { exact: true })).toBeVisible();
  await page.locator("#equipamiento > summary").click();
  await expect(page.getByRole("table", { name: "Equipamiento por plan", exact: true }).getByText(/US\$\s*0/)).toBeVisible();
  await expect(page.getByText("Propuesta comercial preliminar", { exact: true })).toHaveCount(0);

  await request.post("http://127.0.0.1:54329/test/plan", { data: { plans: [] } });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Selección no disponible", exact: true })).toBeVisible();
  await page.goto("/dashboard/account/review");
  await expect(page.getByRole("heading", { name: "Selección no disponible", exact: true })).toBeVisible();

  await request.post("http://127.0.0.1:54329/test/plan", { data: { companyPlanUnavailable: true } });
  await page.goto("/dashboard/account/review?selectedPlan=starter");
  await expect(page.getByText("No pudimos consultar el plan actual de tu empresa.", { exact: false })).toBeVisible();
  await expect(page.getByText("Este plan todavía no fue contratado", { exact: true })).toHaveCount(0);
  await request.post("http://127.0.0.1:54329/test/plan", { data: { catalogUnavailable: true } });
  await page.reload();
  await expect(page.getByText("No pudimos cargar el catálogo de planes.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Starter", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Volver a comparar planes", exact: true })).toBeVisible();
  expect(await (await request.get("http://127.0.0.1:54329/test/plan-state")).json()).toMatchObject({ companyPlanCode: null, planMutations: 0 });
});
