import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = "http://127.0.0.1:54321";
const admin = createClient(url, process.env.TRZ_LOCAL_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const password = `Local-${randomUUID()}`;
let companyId: string;
const users: { id: string; email: string; role: string }[] = [];
async function checked<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function login(page: Page, role = "logistics_manager") {
  const user = users.find(user => user.role === role)!;
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
}
async function assign(code: string) {
  await checked(await admin.from("company_plans").upsert({ company_id: companyId, plan_code: code, assigned_at: new Date().toISOString() }));
}
async function current() {
  const data = await checked(await admin.from("company_plans").select("plan_code,assigned_at").eq("company_id", companyId).single());
  if (!data) throw new Error("La empresa local no tiene asignación");
  return data;
}
test.beforeAll(async () => {
  companyId = randomUUID();
  await checked(await admin.from("companies").insert({ id: companyId, name: `TRZ44-45 local ${companyId}` }));
  for (const role of ["logistics_manager", "warehouse_operator", "driver_operator"]) {
    const email = `${randomUUID()}@plans.test`;
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error || !result.data.user) throw new Error(result.error?.message ?? "No local user");
    users.push({ id: result.data.user.id, email, role });
    await checked(await admin.from("users").insert({ id: result.data.user.id, email, role, company_id: companyId, name: "Plan local test" }));
  }
  // Altas sintéticas aisladas para demostrar exceso; nunca se insertan fuera de localhost.
  await checked(await admin.from("plan_pallet_registrations").insert(Array.from({ length: 501 }, () => ({ pallet_id: randomUUID(), company_id: companyId, registered_at: new Date().toISOString() }))));
});
test.afterAll(async () => {
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id); if (error) throw new Error(error.message);
  }
  if (companyId) await checked(await admin.from("companies").delete().eq("id", companyId));
});

for (const width of [390, 1280]) {
  test(`subida y bajada confirmadas conservan consumo y persisten a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await assign("starter");
    await login(page);
    await page.goto("/dashboard/account");
    await page.getByRole("button", { name: "Seleccionar plan Growth", exact: true }).click();
    await page.getByRole("link", { name: "Ver resumen del plan", exact: true }).click();
    const upgrade = page.getByRole("button", { name: "Confirmar subida", exact: true });
    await expect(upgrade).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(upgrade).toBeEnabled();
    await upgrade.click();
    await expect(page).toHaveURL(/account\?done=plan-changed/);
    await expect(page.getByText("El plan de tu empresa se actualizó correctamente.")).toBeVisible();
    expect((await current()).plan_code).toBe("growth");
    await expect(page.getByRole("button", { name: "Plan actual: Growth", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Seleccionar plan Starter", exact: true }).click();
    await page.getByRole("link", { name: "Ver resumen del plan", exact: true }).click();
    await expect(page.getByText("Tu uso supera los límites del plan inferior seleccionado: Starter.", { exact: true })).toBeVisible();
    const downgrade = page.getByRole("button", { name: "Confirmar bajada", exact: true });
    await expect(downgrade).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`downgrade-${width}.png`), fullPage: true });
    await downgrade.click();
    await expect(page).toHaveURL(/account\?done=plan-changed/);
    await page.reload();
    await expect(page.getByRole("button", { name: "Plan actual: Starter", exact: true })).toBeDisabled();
    expect((await current()).plan_code).toBe("starter");
    const count = await admin.from("plan_pallet_registrations").select("pallet_id", { count: "exact", head: true }).eq("company_id", companyId);
    expect(count.error).toBeNull(); expect(count.count).toBe(501);
    await expect(page.getByText("Tu uso supera los límites del plan asignado: Starter.", { exact: true })).toBeVisible();
  });
}

test("Enterprise, empresa sin plan, confirmación inválida y resumen obsoleto", async ({ page }) => {
  await assign("starter"); await login(page);
  await page.goto("/dashboard/account/review?selectedPlan=enterprise");
  await expect(page.getByRole("button", { name: "Requiere gestión comercial", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await checked(await admin.from("company_plans").delete().eq("company_id", companyId));
  await page.goto("/dashboard/account/review?selectedPlan=growth");
  await expect(page.getByText(/La asignación inicial requiere gestión administrativa/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar subida" })).toHaveCount(0);
  await assign("starter");
  await page.goto("/dashboard/account/review?selectedPlan=growth");
  await page.getByRole("checkbox").check();
  await page.locator('input[name="requestId"]').evaluate(input => (input as HTMLInputElement).value = "invalid");
  await page.getByRole("button", { name: "Confirmar subida", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confirmá que revisaste" })).toBeVisible();
  expect((await current()).plan_code).toBe("starter");
  await page.reload();
  // La misma clave con otra fecha también debe invalidar un resumen abierto.
  await assign("starter");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirmar subida", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "cambió desde que abriste" })).toBeVisible();
  expect((await current()).plan_code).toBe("starter");
});

for (const role of ["warehouse_operator", "driver_operator"]) {
  test(`${role} no accede al resumen ni cambia planes`, async ({ page }) => {
    await assign("starter"); await login(page, role);
    await page.goto("/dashboard/account/review?selectedPlan=growth");
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await current()).plan_code).toBe("starter");
  });
}

test("RPC local serializa dos solicitudes concurrentes y permite reintentar solo la ganadora", async () => {
  await assign("starter");
  const client = createClient(url, process.env.TRZ_LOCAL_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const manager = users.find(user => user.role === "logistics_manager")!;
  const loginResult = await client.auth.signInWithPassword({ email: manager.email, password });
  if (loginResult.error) throw new Error(loginResult.error.message);
  const before = await current();
  const args = [randomUUID(), randomUUID()].map(id => ({ p_target_code: "growth", p_expected_code: "starter", p_expected_assigned_at: before.assigned_at, p_request_id: id, p_confirmed: true }));
  const results = await Promise.all(args.map(args => client.rpc("change_company_plan", args)));
  for (const result of results) expect(result.error).toBeNull();
  expect(results.map(result => result.data).sort()).toEqual(["changed", "stale"]);
  const after = await current();
  const replay = await client.rpc("change_company_plan", args[results.findIndex(result => result.data === "changed")]);
  expect(replay.error).toBeNull(); expect(replay.data).toBe("already_applied");
  expect((await current()).assigned_at).toBe(after.assigned_at);
  await client.auth.signOut();
});
