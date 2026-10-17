import { ERP_CONTRACT_VERSION, type ErpDispatchOrder, type ErpLot, type ErpProduct, type ErpStockBalance } from "./types.ts";

/**
 * Datos deterministas del mock ERP. Los ids imitan los de ERPNext (item_code, batch_id, nombre de Sales Order)
 * para que la demo con mock y con ERPNext se vea igual.
 */
export type MockErpFixtures = {
  products: ErpProduct[];
  lots: ErpLot[];
  stock: ErpStockBalance[];
  orders: ErpDispatchOrder[];
};

const T0 = "2026-10-01T12:00:00.000Z";
const T1 = "2026-10-10T12:00:00.000Z";
const WAREHOUSE = "Depósito Central - SRV";

export const MOCK_ERP_FIXTURES: MockErpFixtures = {
  products: [
    { externalId: "ACE-500", sku: "ACE-500", name: "Aceite de girasol 500 ml", uom: "Caja", batchTracked: true, active: true, updatedAt: T0 },
    { externalId: "ARR-1KG", sku: "ARR-1KG", name: "Arroz largo fino 1 kg", uom: "Caja", batchTracked: true, active: true, updatedAt: T0 },
    { externalId: "QSO-HORMA", sku: "QSO-HORMA", name: "Queso en horma", uom: "Kg", batchTracked: true, active: true, updatedAt: T1 },
    { externalId: "SAL-FINA", sku: "SAL-FINA", name: "Sal fina 500 g", uom: "Unidad", batchTracked: true, active: false, updatedAt: T1 },
  ],
  lots: [
    { externalId: "L-2026-0915", productExternalId: "ACE-500", lotNumber: "L-2026-0915", manufacturingDate: "2026-09-15", expirationDate: "2027-03-31", active: true, updatedAt: T0 },
    { externalId: "L-2026-0921", productExternalId: "ACE-500", lotNumber: "L-2026-0921", manufacturingDate: "2026-09-21", expirationDate: "2027-04-15", active: true, updatedAt: T0 },
    { externalId: "ARR-2026-08", productExternalId: "ARR-1KG", lotNumber: "ARR-2026-08", manufacturingDate: "2026-08-01", expirationDate: "2027-08-01", active: true, updatedAt: T0 },
    { externalId: "QSO-2026-1003", productExternalId: "QSO-HORMA", lotNumber: "QSO-2026-1003", manufacturingDate: "2026-10-03", expirationDate: "2026-12-03", active: true, updatedAt: T1 },
  ],
  stock: [
    { productExternalId: "ACE-500", lotExternalId: "L-2026-0915", warehouseExternalId: WAREHOUSE, quantity: 120, uom: "Caja" },
    { productExternalId: "ACE-500", lotExternalId: "L-2026-0921", warehouseExternalId: WAREHOUSE, quantity: 80, uom: "Caja" },
    { productExternalId: "ARR-1KG", lotExternalId: "ARR-2026-08", warehouseExternalId: WAREHOUSE, quantity: 200, uom: "Caja" },
    { productExternalId: "QSO-HORMA", lotExternalId: "QSO-2026-1003", warehouseExternalId: WAREHOUSE, quantity: 356.5, uom: "Kg" },
  ],
  orders: [
    {
      contractVersion: ERP_CONTRACT_VERSION,
      externalId: "SAL-ORD-2026-00012",
      status: "pending",
      customer: { externalId: "CUST-NORTE", name: "Distribuidora Norte" },
      scheduledDate: "2026-10-20",
      lines: [
        { externalId: "SAL-ORD-2026-00012-1", productExternalId: "ACE-500", quantity: 65, uom: "Caja", warehouseExternalId: WAREHOUSE },
        { externalId: "SAL-ORD-2026-00012-2", productExternalId: "ARR-1KG", quantity: 40, uom: "Caja", warehouseExternalId: WAREHOUSE },
      ],
      updatedAt: T0,
    },
    {
      contractVersion: ERP_CONTRACT_VERSION,
      externalId: "SAL-ORD-2026-00013",
      status: "pending",
      customer: { externalId: "CUST-SUR", name: "Almacén del Sur" },
      scheduledDate: "2026-10-21",
      lines: [
        { externalId: "SAL-ORD-2026-00013-1", productExternalId: "QSO-HORMA", quantity: 48.25, uom: "Kg", warehouseExternalId: WAREHOUSE },
      ],
      updatedAt: T1,
    },
    {
      contractVersion: ERP_CONTRACT_VERSION,
      externalId: "SAL-ORD-2026-00009",
      status: "delivered",
      customer: { externalId: "CUST-NORTE", name: "Distribuidora Norte" },
      scheduledDate: "2026-10-05",
      lines: [
        { externalId: "SAL-ORD-2026-00009-1", productExternalId: "ACE-500", quantity: 20, uom: "Caja", warehouseExternalId: WAREHOUSE },
      ],
      updatedAt: T0,
    },
  ],
};
