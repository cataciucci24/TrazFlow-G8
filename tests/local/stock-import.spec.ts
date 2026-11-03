import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const admin = createClient("http://127.0.0.1:54321", process.env.TRZ_LOCAL_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const password = `Local-${randomUUID()}`;
const companyId = randomUUID();
const users: { id: string; email: string; role: string }[] = [];
const HEADER = "Producto;SKU;Unidad;Lote;Vencimiento;Depósito;Cantidad";
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
// service_role no escribe depósitos: el alta y la limpieza van directo a la base local.
const sql = (query: string) => execFileSync("docker", ["exec", "-i", "supabase_db_TrazFlow-G8", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: query });
const upload = (page: Page, name: string, lines: string[]) => page.getByLabel("Planilla").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from([HEADER, ...lines].join("\n")) });

test.beforeAll(async () => {
  await checked(await admin.from("companies").insert({ id: companyId, name: `USH1 ${companyId}` }));
  sql(`insert into public.warehouses (company_id, code, name) values ('${companyId}', 'DEP-01', 'Central')`);
  for (const role of ["logistics_manager", "warehouse_operator"]) {
    const email = `${randomUUID()}@imp.test`;
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error || !result.data.user) throw new Error(result.error?.message ?? "No local user");
    users.push({ id: result.data.user.id, email, role });
    await checked(await admin.from("users").insert({ id: result.data.user.id, email, role, company_id: companyId, name: "Import test" }));
  }
});
test.afterAll(async () => {
  for (const user of users) { const { error } = await admin.auth.admin.deleteUser(user.id); if (error) throw new Error(error.message); }
  sql(`delete from public.pallets where company_id = '${companyId}'; delete from public.warehouses where company_id = '${companyId}'; delete from public.companies where id = '${companyId}'`);
});

test("plantilla, vista previa con errores, confirmación y reimportación", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/dashboard/inventory");
  await page.getByRole("link", { name: "Importar desde Excel", exact: true }).click();
  await expect(page).toHaveURL(/inventory\/import/);

  const template = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar plantilla", exact: true }).click();
  expect((await template).suggestedFilename()).toBe("plantilla-stock-trazflow.xlsx");

  await upload(page, "stock.csv", [
    "Aceite;ACE-1;cajas;L1;31/12/2030;DEP-01;10",
    "Aceite;ACE-1;cajas;L1;31/12/2030;DEP-01;10",
    "Queso;QSO-1;kg;Q1;31/12/2030;DEP-01;12,5",
    "Sal;SAL-1;litros;S1;31/02/2030;DEP-01;x",
    "Yerba;YER-1;cajas;Y1;31/12/2030;NO-EXISTE;4",
  ]);
  await page.getByRole("button", { name: "Revisar archivo", exact: true }).click();
  const summary = page.getByRole("region", { name: "Vista previa" }).or(page.locator("section", { hasText: "Vista previa" })).first();
  await expect(summary.getByText("Filas leídas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar 2 filas", exact: true })).toBeVisible();
  const errors = page.getByRole("table", { name: "Filas con errores" });
  await expect(errors.getByRole("row")).toHaveCount(4);
  await expect(errors).toContainText("Fila duplicada");
  await expect(errors).toContainText("«litros» inválida");
  await expect(errors).toContainText("Vencimiento inválido");
  await expect(errors).toContainText("El depósito no existe");
  expect((await admin.from("products").select("id", { count: "exact", head: true }).eq("company_id", companyId)).count).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("preview.png"), fullPage: true });

  await page.getByRole("button", { name: "Confirmar 2 filas", exact: true }).click();
  await expect(page.getByText("2 de 5 filas importadas como pallets en depósito.")).toBeVisible();
  const pallets = await checked(await admin.from("pallets").select("quantity, warehouse_code, batches(batch_number, expiration_date)").eq("company_id", companyId).order("quantity"));
  expect(pallets!.map(pallet => Number(pallet.quantity))).toEqual([10, 12.5]);
  expect(pallets!.every(pallet => pallet.warehouse_code === "DEP-01")).toBe(true);

  await page.getByRole("button", { name: "Revisar archivo", exact: true }).click();
  await expect(page.getByRole("table", { name: "Filas con errores" })).toContainText("ya tiene stock");
  await expect(page.getByRole("button", { name: /^Confirmar/ })).toHaveCount(0);
  expect((await admin.from("pallets").select("id", { count: "exact", head: true }).eq("company_id", companyId)).count).toBe(2);
});

test("archivos no admitidos y sin columnas dan un error claro", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/inventory/import");
  await page.getByLabel("Planilla").setInputFiles({ name: "stock.csv", mimeType: "text/csv", buffer: Buffer.from("Producto;SKU\nA;B") });
  await page.getByRole("button", { name: "Revisar archivo", exact: true }).click();
  await expect(page.getByText(/Faltan columnas: Unidad, Lote/)).toBeVisible();
  await page.getByLabel("Planilla").setInputFiles({ name: "stock.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("no es excel") });
  await page.getByRole("button", { name: "Revisar archivo", exact: true }).click();
  await expect(page.getByText(/No pudimos leer el archivo/)).toBeVisible();
});

test("5.000 filas se validan e importan", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/dashboard/inventory/import");
  const lines = Array.from({ length: 5000 }, (_, index) => `Masivo;BULK-${index % 50};cajas;LOTE-${index};31/12/2031;DEP-01;1`);
  await upload(page, "masivo.csv", lines);
  await page.getByRole("button", { name: "Revisar archivo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmar 5000 filas", exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Confirmar 5000 filas", exact: true }).click();
  await expect(page.getByText("5000 de 5000 filas importadas como pallets en depósito.")).toBeVisible({ timeout: 180_000 });
});

test("depósito no accede a la importación ni a la plantilla", async ({ page, context }) => {
  await login(page, "warehouse_operator");
  await page.goto("/dashboard/inventory/import");
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await context.request.get("/dashboard/inventory/import/template")).status()).toBe(403);
});
