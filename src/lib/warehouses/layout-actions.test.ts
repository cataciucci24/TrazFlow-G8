import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ role: "logistics_manager", update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({ requireUserProfile: async () => ({ role: mocks.role, companyId: "company-a" }), hasRole: (profile: { role: string }, role: string) => profile.role === role }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ update: mocks.update }) }) }));
import { updateWarehouseLayout } from "./layout-actions";

const initial = { error: null, success: null };
function form(layout: string) { const data = new FormData(); data.set("code", "ERP-01"); data.set("layout", layout); return data; }
describe("update warehouse layout", () => {
  beforeEach(() => {
    mocks.role = "logistics_manager";
    mocks.update.mockReset().mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReset().mockReturnValue({ eq: mocks.eq, select: mocks.select });
    mocks.select.mockReset().mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.maybeSingle.mockReset().mockResolvedValue({ data: { code: "ERP-01" }, error: null });
    mocks.revalidate.mockReset();
  });
  it("updates only layout scoped to company and code, including ERP warehouses", async () => {
    const result = await updateWarehouseLayout(initial, form('[{"label":" Sector "}]'));
    expect(result.success).toBeTruthy();
    expect(mocks.update).toHaveBeenCalledWith({ layout: [{ label: "Sector" }] });
    expect(mocks.eq).toHaveBeenNthCalledWith(1, "company_id", "company-a");
    expect(mocks.eq).toHaveBeenNthCalledWith(2, "code", "ERP-01");
  });
  it("denies operators and malformed input", async () => {
    mocks.role = "warehouse_operator";
    expect((await updateWarehouseLayout(initial, form('[{"label":"A"}]'))).error).toMatch(/Solo logística/);
    mocks.role = "logistics_manager";
    expect((await updateWarehouseLayout(initial, form('[]'))).error).toMatch(/niveles/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("reports the database restriction and refuses a missing or invisible row", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "23514" } }).mockResolvedValueOnce({ data: null, error: null });
    expect((await updateWarehouseLayout(initial, form('[{"label":"A"}]'))).error).toMatch(/cantidad de niveles/);
    expect((await updateWarehouseLayout(initial, form('[{"label":"A"}]'))).error).toMatch(/No se encontró/);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
