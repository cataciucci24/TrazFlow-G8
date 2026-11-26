import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "logistics_manager",
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({
  requireUserProfile: async () => ({ role: mocks.role }),
  hasRole: (profile: { role: string }, role: string) => profile.role === role,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

import { createWarehouse, deactivateWarehouse, renameWarehouse } from "./actions";

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
});
