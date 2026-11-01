import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const admin = createClient("http://127.0.0.1:54321", process.env.TRZ_LOCAL_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const password = `Local-${randomUUID()}`;
const companyId = randomUUID();
const email = `${randomUUID()}@imp.test`;
const sql = (query: string) => execFileSync("docker", ["exec", "-i", "supabase_db_TrazFlow-G8", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: query });
let userId: string;

test.beforeAll(async () => {
  const company = await admin.from("companies").insert({ id: companyId, name: `USH1 ERP ${companyId}` });
  if (company.error) throw new Error(company.error.message);
  sql(`insert into public.warehouses (company_id, code, name) values ('${companyId}', 'DEP-01', 'Central');
       insert into public.erp_warehouse_mappings (company_id, external_warehouse_id, warehouse_code, created_by) values ('${companyId}', 'Central - SRV', 'DEP-01', null);`);
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "No local user");
  userId = created.data.user.id;
  const profile = await admin.from("users").insert({ id: userId, email, role: "logistics_manager", company_id: companyId, name: "Import ERP" });
  if (profile.error) throw new Error(profile.error.message);
});
test.afterAll(async () => {
  // El outbox es de auditoría y no se borra desde la app: solo acá, sobre la empresa sintética.
  sql(`alter table public.erp_outbox_events disable trigger trg_erp_outbox_guard;
       delete from public.erp_outbox_events where company_id = '${companyId}';
       alter table public.erp_outbox_events enable trigger trg_erp_outbox_guard;
       delete from public.erp_warehouse_mappings where company_id = '${companyId}';
       delete from public.warehouses where company_id = '${companyId}';`);
  await admin.auth.admin.deleteUser(userId);
  await admin.from("companies").delete().eq("id", companyId);
});

test("con ERP las filas van al outbox, se envían y no crean nada en TrazFlow", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/dashboard/inventory/import");
  await expect(page.getByText(/Se envían al ERP y entran a TrazFlow con la sincronización/)).toBeVisible();
  await page.getByLabel("Planilla").setInputFiles({ name: "stock.csv", mimeType: "text/csv", buffer: Buffer.from([
    "Producto;SKU;Unidad;Lote;Vencimiento;Depósito;Cantidad",
    "Aceite;ACE-1;cajas;L1;31/12/2030;DEP-01;10",
    "Queso;QSO-1;kg;Q1;31/12/2030;DEP-01;12,5",
    "Yerba;YER-1;cajas;Y1;31/12/2030;SIN-VINCULO;4",
  ].join("\n")) });
  await page.getByRole("button", { name: "Revisar archivo", exact: true }).click();
  await expect(page.getByRole("table", { name: "Filas con errores" })).toContainText("no está vinculado");
  await page.getByRole("button", { name: "Confirmar 2 filas", exact: true }).click();
  await expect(page.getByText(/2 de 3 filas enviadas al ERP/)).toBeVisible();

  await expect.poll(async () => {
    const { data } = await admin.from("erp_outbox_events").select("status, erp_reference").eq("company_id", companyId).eq("event_type", "stock_import_requested");
    return (data ?? []).map(event => `${event.status}:${event.erp_reference?.slice(0, 9)}`);
  }, { timeout: 30_000 }).toEqual(["sent:MOCK-STE-", "sent:MOCK-STE-"]);
  const products = await admin.from("products").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  expect(products.count).toBe(0);
  const pallets = await admin.from("pallets").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  expect(pallets.count).toBe(0);
});
