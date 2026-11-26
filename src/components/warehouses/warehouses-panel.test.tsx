import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/warehouses/actions", () => ({
  createWarehouse: vi.fn(), deactivateWarehouse: vi.fn(), reactivateWarehouse: vi.fn(), renameWarehouse: vi.fn(),
}));
import { WarehousesPanel } from "./warehouses-panel";
import type { Warehouse } from "@/lib/warehouses/types";

const warehouses: Warehouse[] = [
  { code: "MANUAL", name: "Principal", sourceSystem: "trazflow", externalId: null, active: true, syncedAt: null },
  { code: "ERP", name: "ERP Central", sourceSystem: "erp", externalId: "ext", active: false, syncedAt: null },
];

describe("warehouse panel", () => {
  it("shows manual controls, warehouse details and location counts", () => {
    const html = renderToStaticMarkup(<WarehousesPanel warehouses={warehouses} counts={{ MANUAL: 7, ERP: 2 }} erpEnabled={false} />);
    expect(html).toContain("Crear depósito");
    expect(html).toContain("Editar nombre");
    expect(html).toContain("Desactivar");
    expect(html).toContain("ERP · solo lectura");
    expect(html).toContain(">7<");
    expect(html).toContain(">2<");
  });
  it("hides manual creation when ERP is enabled", () => {
    const html = renderToStaticMarkup(<WarehousesPanel warehouses={warehouses} counts={{}} erpEnabled />);
    expect(html).not.toContain("Crear depósito");
    expect(html).toContain("sincronización");
  });
});
