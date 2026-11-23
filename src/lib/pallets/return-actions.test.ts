import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUserProfile: mocks.profile, hasRole: (profile: { role: string }, ...roles: string[]) => roles.includes(profile.role) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { returnPalletToWarehouse } from "./return-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue({ role: "logistics_manager", companyId: "company-1" });
  mocks.rpc.mockResolvedValue({ data: [{ outcome: "returned" }], error: null });
});

describe("reingreso de pallets", () => {
  it.each(["warehouse_operator", "driver_operator"])("%s no puede iniciar el reingreso", async role => {
    mocks.profile.mockResolvedValue({ role });
    expect(await returnPalletToWarehouse("PAL-1", "Devolución completa")).toMatchObject({ success: null, error: expect.stringMatching(/Solo logística/) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("normaliza QR y motivo y solo envía esos datos a la RPC", async () => {
    expect(await returnPalletToWarehouse(" PAL-1 ", " Error de destino ")).toMatchObject({ error: null, success: expect.stringMatching(/nueva orden/) });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("return_pallet_to_warehouse", { p_qr_code: "PAL-1", p_reason: "Error de destino" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/orders");
  });
  it.each([["", "Motivo"], ["PAL-1", " "], ["x".repeat(513), "Motivo"], ["PAL-1", "x".repeat(1001)], [null, "Motivo"], ["PAL-1", {}]])("rechaza datos inválidos antes de escribir", async (code, reason) => {
    expect(await returnPalletToWarehouse(code as string, reason as string)).toMatchObject({ success: null, error: expect.any(String) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("el reintento idempotente informa que ya está en depósito", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ outcome: "already_in_warehouse" }], error: null });
    expect(await returnPalletToWarehouse("PAL-1", "Reintento")).toMatchObject({ error: null, success: expect.stringMatching(/ya está en depósito/) });
  });
  it.each(["invalid_status", "warehouse_inactive", "pallet_not_found", "forbidden"])("el rechazo %s no se presenta como éxito", async outcome => {
    mocks.rpc.mockResolvedValue({ data: [{ outcome }], error: null });
    expect(await returnPalletToWarehouse("PAL-1", "Motivo")).toMatchObject({ success: null, error: expect.any(String) });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("un error de base no expone el diagnóstico ni cambia las vistas", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "datos privados del servidor" } });
    const result = await returnPalletToWarehouse("PAL-1", "Motivo");
    expect(result).toMatchObject({ success: null, error: expect.any(String) });
    expect(result.error).not.toContain("datos privados");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
