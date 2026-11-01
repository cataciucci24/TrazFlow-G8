import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const admin = createClient("http://127.0.0.1:54321", process.env.TRZ_LOCAL_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const password = `Local-${randomUUID()}`;
const companyId = randomUUID(), otherCompanyId = randomUUID();
const users: { id: string; email: string; role: string; company: string }[] = [];
const shift = (days: number) => new Date(Date.now() - 3 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
const suffix = randomUUID().slice(0, 8);
async function checked<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function login(page: Page, role = "logistics_manager", company = companyId) {
  const user = users.find(user => user.role === role && user.company === company)!;
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
}
const payment = (company: string, status: string, start: number, end: number, invoice: string | null) => ({
  company_id: company, plan_code: "starter", plan_name: "Starter", billed_to: "Empresa Ñandú", amount_cents: 6900,
  status, payment_date: shift(start), period_start: shift(start), period_end: shift(end), invoice_number: invoice && `${invoice}-${suffix}`,
});
test.beforeAll(async () => {
  await checked(await admin.from("companies").insert([{ id: companyId, name: `TRZ47-50 ${companyId}` }, { id: otherCompanyId, name: `TRZ47-50 ${otherCompanyId}` }]));
  for (const [role, company] of [["logistics_manager", companyId], ["driver_operator", companyId], ["logistics_manager", otherCompanyId]]) {
    const email = `${randomUUID()}@subs.test`;
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error || !result.data.user) throw new Error(result.error?.message ?? "No local user");
    users.push({ id: result.data.user.id, email, role, company });
    await checked(await admin.from("users").insert({ id: result.data.user.id, email, role, company_id: company, name: "Sub local test" }));
  }
  await checked(await admin.from("company_plans").insert({ company_id: companyId, plan_code: "starter" }));
  await checked(await admin.from("company_payments").insert([
    payment(companyId, "paid", -40, -11, "OLD"), payment(companyId, "paid", -10, 5, "NOW"),
    payment(companyId, "pending", 6, 35, null), payment(otherCompanyId, "paid", -10, 5, "OTHER"),
  ]));
});
test.afterAll(async () => {
  for (const user of users) { const { error } = await admin.auth.admin.deleteUser(user.id); if (error) throw new Error(error.message); }
  await checked(await admin.from("companies").delete().in("id", [companyId, otherCompanyId]));
});

test("lista, factura, cancelación, acceso vigente y corte al terminar el período", async ({ page }, testInfo) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await login(page);
    await page.goto("/dashboard/account#pagos");
    await expect(page.getByRole("table", { name: "Pagos de la empresa" }).getByRole("row")).toHaveCount(4);
    await expect(page.getByRole("link", { name: /^Descargar factura/ })).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`), fullPage: true });
  }

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: `Descargar factura NOW-${suffix}` }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`factura-NOW-${suffix}.pdf`);
  const pdf = (await readFile(await download.path())).toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf).toContain("Empresa Ñandú");

  const cancel = page.getByRole("button", { name: "Cancelar suscripción", exact: true });
  await expect(cancel).toBeDisabled();
  await page.getByRole("checkbox").check();
  await cancel.click();
  await expect(page).toHaveURL(/done=subscription-canceled/);
  await expect(page.getByText(/Podés seguir usando TrazFlow hasta el/)).toBeVisible();
  await expect(cancel).toHaveCount(0);
  await expect(page.getByText("Anulado")).toBeVisible();
  await page.goto("/dashboard/account/review?selectedPlan=growth");
  await expect(page.getByText(/ya no admite cambios de plan/)).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);

  // Termina el período: el acceso se corta, pero las facturas siguen disponibles.
  await checked(await admin.from("company_plans").update({ access_until: shift(-1) }).eq("company_id", companyId));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/access-status/);
  await expect(page.getByRole("heading", { name: "Suscripción finalizada" })).toBeVisible();
  const ended = page.waitForEvent("download");
  await page.getByRole("link", { name: `Descargar factura OLD-${suffix}` }).click();
  expect((await ended).suggestedFilename()).toBe(`factura-OLD-${suffix}.pdf`);
  await page.goto("/dashboard/account");
  await expect(page).toHaveURL(/access-status/);
});

test("una empresa no descarga facturas ajenas y el chofer no accede", async ({ page, context }) => {
  await checked(await admin.from("company_plans").update({ canceled_at: null, access_until: null }).eq("company_id", companyId));
  const own = (await checked(await admin.from("company_payments").select("id").eq("invoice_number", `NOW-${suffix}`).single()))!;
  const foreign = (await checked(await admin.from("company_payments").select("id").eq("invoice_number", `OTHER-${suffix}`).single()))!;
  const pending = (await checked(await admin.from("company_payments").select("id").eq("company_id", companyId).is("invoice_number", null).limit(1).single()))!;
  await login(page);
  const invoice = (id: string) => context.request.get(`/dashboard/account/payments/${id}/invoice`, { maxRedirects: 0 });
  expect((await invoice(own.id)).status()).toBe(200);
  expect((await invoice(foreign.id)).status()).toBe(404);
  expect((await invoice(pending.id)).status()).toBe(404);
  expect((await invoice("no-es-uuid")).status()).toBe(404);
  await context.clearCookies();
  expect((await invoice(own.id)).status()).toBe(307);
  await login(page, "driver_operator");
  expect((await invoice(own.id)).status()).toBe(403);
});
