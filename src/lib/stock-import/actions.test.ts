import { beforeEach, expect, test, vi } from "vitest";
import { MAX_IMPORT_BYTES } from "./rows";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), after: vi.fn(), revalidate: vi.fn(), enabled: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUserProfile: mocks.profile, hasRole: (profile: { role: string }, role: string) => profile.role === role }));
vi.mock("@/lib/erp-sync/enabled", () => ({ isErpEnabled: mocks.enabled }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/erp-outbox/run", () => ({ processCompanyErpOutbox: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/server", () => ({ after: mocks.after }));

import { confirmStockImport, previewStockImport } from "./actions";

const good = "Aceite;ACE-500;cajas;L1;2099-12-31;DEP-01;10";
function form(lines = [good]) {
  const data = new FormData();
  data.set("requestId", "10000000-0000-4000-8000-000000000001");
  data.set("file", new File([["Producto;SKU;Unidad;Lote;Vencimiento;Depósito;Cantidad", ...lines].join("\n")], "stock.csv"));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue({ role: "logistics_manager", companyId: "company-1" });
  mocks.enabled.mockResolvedValue(false);
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_rows.map((row: { row: number }) => ({ row: row.row, status: "imported" })), error: null }));
});

test.each([false, true])("una fila inválida no llega a la RPC en modo ERP=%s; las válidas sí", async enabled => {
  mocks.enabled.mockResolvedValue(enabled);
  const result = await confirmStockImport(form([good, good.replace("ACE-500", "INVALID@SKU")]));
  expect(result).toMatchObject({ imported: 1, errors: [{ row: 3 }] });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls[0]).toEqual(["import_stock_rows", expect.objectContaining({ p_mode: enabled ? "erp" : "manual", p_dry_run: false, p_rows: [expect.objectContaining({ row: 2, sku: "ACE-500" })] })]);
  expect(mocks.after).toHaveBeenCalledTimes(enabled ? 1 : 0);
});
test.each([false, true])("si todas son inválidas no hay escrituras ni envío ERP=%s", async enabled => {
  mocks.enabled.mockResolvedValue(enabled);
  expect(await confirmStockImport(form([good.replace(";10", ";0")]))).toMatchObject({ imported: 0 });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
test("duplicados no llegan a la RPC", async () => {
  expect(await confirmStockImport(form([good, good]))).toMatchObject({ imported: 1, errors: [{ row: 3, messages: [expect.stringMatching(/duplicada/)] }] });
  expect(mocks.rpc.mock.calls[0][1].p_rows).toHaveLength(1);
});
test.each([false, true])("depósito inexistente informado por la RPC no dispara envío ERP=%s", async enabled => {
  mocks.enabled.mockResolvedValue(enabled);
  mocks.rpc.mockResolvedValue({ data: [{ row: 2, status: "warehouse_not_found" }], error: null });
  expect(await confirmStockImport(form())).toMatchObject({ imported: 0, errors: [{ row: 2, messages: ["El depósito no existe o está inactivo en TrazFlow."] }] });
  expect(mocks.after).not.toHaveBeenCalled();
});
test("la vista previa solo usa dry-run", async () => {
  await previewStockImport(form());
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_dry_run: true, p_request_id: null });
  expect(mocks.after).not.toHaveBeenCalled();
});
test("un archivo de más de 4 MB se rechaza antes de leerlo o escribir", async () => {
  const data = form();
  data.set("file", new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "stock.csv"));
  expect(await confirmStockImport(data)).toEqual({ error: "El archivo supera los 4 MB." });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
test("el rol se valida antes de leer el archivo", async () => {
  mocks.profile.mockResolvedValue({ role: "warehouse_operator" });
  expect(await confirmStockImport(form())).toEqual({ error: "Solo logística puede importar stock." });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
