import assert from "node:assert/strict";
import test from "node:test";
import { mapOrderPalletValidations, ORDER_PALLET_VALIDATION_SELECT } from "./mapping.ts";

const location = { warehouse_code: "DEP-01", code: "B03", aisle: "B", rack: "3", level: "1", position: "1" };

test("la query de validación pide la ubicación por el FK de current_location_id", () => {
  assert.match(ORDER_PALLET_VALIDATION_SELECT, /location:warehouse_locations!pallets_company_location_fkey/);
});

test("mapea pallets de la orden con validación y ubicación", () => {
  const result = mapOrderPalletValidations([
    {
      validated_at: "2026-10-28T12:00:00Z",
      validated_by: "user-1",
      pallets: {
        id: "p1",
        qr_code: "PAL-001",
        location,
        batches: { batch_number: "L-1", products: [{ name: "Arroz", sku: "ARZ" }] },
      },
    },
    {
      validated_at: null,
      validated_by: null,
      pallets: [{ id: "p2", qr_code: "PAL-002", location: null, batches: null }],
    },
    { validated_at: null, validated_by: null, pallets: null },
  ]);

  assert.deepEqual(result, [
    {
      id: "p1",
      qrCode: "PAL-001",
      productName: "Arroz",
      productSku: "ARZ",
      batchNumber: "L-1",
      location: { warehouseCode: "DEP-01", code: "B03", aisle: "B", rack: "3", level: "1", position: "1" },
      validatedAt: "2026-10-28T12:00:00Z",
      validatedBy: "user-1",
    },
    {
      id: "p2",
      qrCode: "PAL-002",
      productName: "—",
      productSku: "—",
      batchNumber: "—",
      location: null,
      validatedAt: null,
      validatedBy: null,
    },
  ]);
});
