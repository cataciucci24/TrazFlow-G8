import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: { role: "warehouse_operator", companyId: "empresa-a" }, calls: [] as Array<[string, ...unknown[]]>, rows: [] as unknown[], failure: -1 }));
vi.mock("@/lib/auth/session", () => ({ requireUserProfile: async () => mocks.profile, hasRole: (profile: { role: string }, ...roles: string[]) => roles.includes(profile.role) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  mocks.calls.push(["from", table]);
  const chain = {
    select: (value: string) => { mocks.calls.push(["select", value]); return chain; },
    eq: (column: string, value: string) => { mocks.calls.push(["eq", column, value]); return chain; },
    order: (column: string) => { mocks.calls.push(["order", column]); return chain; },
    range: async (from: number, to: number) => { mocks.calls.push(["range", from, to]); return from === mocks.failure ? { data: null, error: new Error("red") } : { data: mocks.rows.slice(from, to + 1), error: null }; },
  };
  return chain;
} }) }));
vi.mock("@/lib/pallets/contents", () => ({ attachPalletContents: async (_db: unknown, rows: unknown[]) => rows }));
vi.mock("@/lib/pallets/mapping", () => ({ PALLET_SELECT: "campos_pallet", mapPalletRow: (row: { id: string }) => ({ id: row.id }) }));
import { getLocationPallets, getLocations } from "./queries";

describe("consultas de la pantalla de ubicaciones", () => {
  beforeEach(() => { mocks.calls = []; mocks.rows = []; mocks.failure = -1; mocks.profile.role = "warehouse_operator"; });
  it.each([1000, 1001, 2000])("página %i ubicaciones por empresa y orden estable", async (count) => {
    mocks.rows = Array.from({ length: count }, (_, index) => ({ id: `${index}` }));
    const rows = await getLocations();
    expect(rows).toHaveLength(count);
    expect(new Set(rows.map((row) => row.id)).size).toBe(count);
    expect(mocks.calls).toContainEqual(["eq", "company_id", "empresa-a"]);
    expect(mocks.calls).toContainEqual(["order", "code"]);
    expect(mocks.calls).toContainEqual(["order", "id"]);
  });
  it("incluye pallets posteriores a la primera página con su historial", async () => {
    mocks.rows = Array.from({ length: 1001 }, (_, index) => ({ id: `${index}`, traceability_events: [{ count: index === 1000 ? 1 : 0 }] }));
    const rows = await getLocationPallets();
    expect(rows).toHaveLength(1001);
    expect(rows[1000]).toMatchObject({ id: "1000", hasHistory: true });
    expect(mocks.calls).toContainEqual(["eq", "company_id", "empresa-a"]);
    expect(mocks.calls).toContainEqual(["order", "qr_code"]);
    expect(mocks.calls).toContainEqual(["order", "id"]);
  });
  it("propaga errores posteriores y rechaza roles ajenos antes de consultar", async () => {
    mocks.rows = Array(500).fill({ id: "a" }); mocks.failure = 500;
    await expect(getLocations()).rejects.toThrow("No se pudieron consultar las ubicaciones");
    await expect(getLocationPallets()).rejects.toThrow("No se pudieron consultar los pallets");
    mocks.calls = []; mocks.profile.role = "driver_operator";
    await expect(getLocationPallets()).rejects.toThrow("Sin permiso");
    await expect(getLocations()).rejects.toThrow("Sin permiso");
    expect(mocks.calls).toHaveLength(0);
  });
});
