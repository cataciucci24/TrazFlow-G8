import type { PalletUnit } from "@/lib/pallets/units";

/** Roles de la app, espejo del enum `user_role` de Postgres. */
export type UserRole =
  | "logistics_manager"
  | "warehouse_operator"
  | "distributor_operator";

/** Perfil del usuario logueado (fila de la tabla `users`). */
export type UserProfile = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: UserRole;
};

/** Estados de una orden de despacho, espejo del enum `order_status` de Postgres. */
export type OrderStatus =
  | "draft"
  | "validating"
  | "has_discrepancy"
  | "confirmed"
  | "received"
  | "received_with_discrepancy";

/** Distribuidor de destino (fila de la tabla `distributors`). */
export type Distributor = {
  id: string;
  name: string;
};

/** Nivel de riesgo de quiebre según los días de cobertura disponibles. */
export type StockRiskLevel = "critical" | "caution";

/** Alerta calculada para el stock de un producto en una distribuidora. */
export type DistributorStockAlert = {
  id: string;
  distributorName: string;
  productName: string;
  productSku: string;
  currentStock: number;
  dailyConsumption: number;
  unitOfMeasure: PalletUnit;
  stockDays: number;
  riskLevel: StockRiskLevel;
};

/** Registro editable de stock informado por una distribuidora. */
export type DistributorStockEntry = {
  id: string;
  distributorId: string;
  distributorName: string;
  productId: string;
  productName: string;
  productSku: string;
  currentStock: number;
  dailyConsumption: number;
  unitOfMeasure: PalletUnit;
  stockDays: number;
  riskLevel: StockRiskLevel | null;
  updatedAt: string;
};

/** Orden de despacho (fila de la tabla `dispatch_orders`). */
export type DispatchOrder = {
  id: string;
  distributorId: string;
  distributorName: string;
  status: OrderStatus;
  estimatedDispatchDate: string;
  notes: string | null;
  createdAt: string;
};

/** Estados de un pallet, espejo del enum `pallet_status` de Postgres. */
export type PalletStatus =
  | "in_warehouse"
  | "assigned"
  | "in_transit"
  | "received"
  | "discrepancy";

/** Lote existente de un producto (por SKU), para elegirlo en el formulario en vez de tipearlo. */
export type ProductBatch = {
  productSku: string;
  batchNumber: string;
};

/** Producto existente de la empresa (por SKU), para elegirlo en el formulario en vez de tipearlo. */
export type ExistingProduct = {
  sku: string;
  name: string;
};

/** Lote (fila de `batches`) con los datos de producto necesarios para listarlo. */
export type Lot = {
  id: string;
  batchNumber: string;
  productName: string;
  productSku: string;
  expirationDate: string | null;
};

/** Pallet con la info de producto/lote necesaria para identificarlo en pantalla. */
export type Pallet = {
  id: string;
  qrCode: string;
  status: PalletStatus;
  currentLocation: string | null;
  productName: string;
  productSku: string;
  batchNumber: string;
  quantity: number | null;
  unitOfMeasure: PalletUnit | null;
};

/** Mercadería disponible cuyo lote vence dentro de los próximos 90 días. */
export type ExpirationAlert = {
  palletId: string;
  productName: string;
  productSku: string;
  batchNumber: string;
  quantity: number;
  unitOfMeasure: PalletUnit;
  currentLocation: string | null;
  expirationDate: string;
  daysRemaining: number;
  urgency: "critical" | "warning" | "upcoming";
};
