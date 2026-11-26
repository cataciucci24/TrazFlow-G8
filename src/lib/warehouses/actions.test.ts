import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "logistics_manager",
  rpc: vi.fn(),
  revalidate: vi.fn(),
  erpEnabled: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({
  requireUserProfile: async () => ({ role: mocks.role, companyId: "company-a" }),
  hasRole: (profile: { role: string }, role: string) => profile.role === role,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/erp-sync/enabled", () => ({ isErpEnabled: mocks.erpEnabled }));

import { createWarehouse, deactivateWarehouse, reactivateWarehouse, renameWarehouse } from "./actions";

const initial = { error: null, success: null };
function form(code: string, name = "") {
  const data = new FormData();
  data.set("code", code);
  data.set("name", name);
  return data;
}

describe("warehouse management actions", () => {
  beforeEach(() => {
    mocks.role = "logistics_manager";
    mocks.rpc.mockReset().mockResolvedValue({ error: null });
    mocks.revalidate.mockReset();
    mocks.erpEnabled.mockReset().mockResolvedValue(false);
  });
  it("normalizes the code and invokes the scoped create operation", async () => {
    expect((await createWarehouse(initial, form(" dep-1 ", " Central "))).error).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("manage_manual_warehouse", { p_action: "create", p_code: "DEP-1", p_name: "Central" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout");
  });
  it("rejects another role before invoking the database", async () => {
    mocks.role = "warehouse_operator";
    expect((await renameWarehouse(initial, form("DEP-1", "Name"))).error).toMatch(/Solo logística/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports a stock conflict without claiming success", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "23514" } });
    const result = await deactivateWarehouse(initial, form("DEP-1"));
    expect(result.success).toBeNull();
    expect(result.error).toMatch(/pallets en stock/);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("reactivates a manual warehouse through its dedicated operation", async () => {
    expect((await reactivateWarehouse(initial, form("dep-1"))).success).toBe("Depósito activado.");
    expect(mocks.rpc).toHaveBeenCalledWith("reactivate_manual_warehouse", { p_code: "DEP-1" });
  });
  it("reports the database ERP restriction without claiming success", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "TF116" } });
    const result = await createWarehouse(initial, form("DEP-1", "Central"));
    expect(result.error).toMatch(/ERP/);
    expect(result.success).toBeNull();
  });
  it("blocks creation when ERP is enabled in the application", async () => {
    mocks.erpEnabled.mockResolvedValue(true);
    const result = await createWarehouse(initial, form("DEP-1", "Central"));
    expect(result.error).toMatch(/ERP/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
