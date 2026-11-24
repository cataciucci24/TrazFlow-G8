import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), enabled: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUserProfile: mocks.profile, hasRole: (profile: { role: string }, ...roles: string[]) => roles.includes(profile.role) }));
vi.mock("@/lib/erp-sync/enabled", () => ({ isErpEnabled: mocks.enabled }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { createPalletWithItems } from "./item-actions";

const batchId = "11100000-0000-0000-0000-000000000031";
const items = [{ batch_id: batchId, quantity: 2.5 }];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue({ role: "logistics_manager", companyId: "company-1" });
  mocks.enabled.mockResolvedValue(false);
  mocks.rpc.mockResolvedValue({ data: [{ qr_code: "PAL-MIX" }], error: null });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [{ id: batchId, source_system: "erp" }], error: null }) };
  mocks.from.mockReturnValue(query);
});

describe("armado de pallets por ítem", () => {
  it.each(["logistics_manager", "warehouse_operator"])("%s puede enviar un armado atómico", async role => {
    mocks.profile.mockResolvedValue({ role, companyId: "company-1" });
    expect(await createPalletWithItems(items, " DEP-01 ")).toMatchObject({ error: null, success: expect.stringContaining("PAL-MIX") });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_pallet_with_items", { p_items: items, p_warehouse_code: "DEP-01" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/pallets");
  });
  it("el chofer no llega a la consulta ni a la escritura", async () => {
    mocks.profile.mockResolvedValue({ role: "driver_operator" });
    expect(await createPalletWithItems(items, "DEP-01")).toMatchObject({ success: null, error: expect.stringMatching(/permisos/) });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("un payload inválido no llega a la RPC", async () => {
    for (const value of [[], [{ batch_id: batchId, quantity: 0 }], [items[0], items[0]], null]) {
      expect(await createPalletWithItems(value as typeof items, "DEP-01")).toMatchObject({ success: null });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, 42, "x".repeat(41)])("rechaza el depósito inválido %j sin lanzar ni escribir", async warehouse => {
    expect(await createPalletWithItems(items, warehouse as string)).toMatchObject({ success: null, error: expect.any(String) });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("con ERP consulta los lotes de la empresa y rechaza un lote manual", async () => {
    mocks.enabled.mockResolvedValue(true);
    const query = mocks.from();
    query.in.mockResolvedValue({ data: [{ id: batchId, source_system: "trazflow" }], error: null });
    expect(await createPalletWithItems(items, "DEP-01")).toMatchObject({ error: expect.stringMatching(/sincronizados/), success: null });
    expect(query.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("un lote ajeno, ausente o una consulta fallida no produce escrituras", async () => {
    mocks.enabled.mockResolvedValue(true);
    for (const response of [{ data: [], error: null }, { data: null, error: { code: "42501" } }]) {
      mocks.from().in.mockResolvedValue(response);
      expect(await createPalletWithItems(items, "DEP-01")).toMatchObject({ success: null });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("un rechazo del tope ERP no se anuncia como éxito ni revalida", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "TF100", message: "diagnóstico interno" } });
    const result = await createPalletWithItems(items, "DEP-01");
    expect(result).toMatchObject({ success: null, error: expect.stringMatching(/saldo/) });
    expect(result.error).not.toContain("diagnóstico interno");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("sin confirmación de la base no inventa el QR ni el éxito", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await createPalletWithItems(items, "DEP-01")).toMatchObject({ success: null });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
