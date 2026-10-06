import type { ProductUnit } from "@/lib/pallets/units";

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
  /** Fecha de revocación del acceso (TRZ-38); null si el acceso está vigente. */
  revokedAt: string | null;
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
  unitOfMeasure: ProductUnit;
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
  unitOfMeasure: ProductUnit;
  stockDays: number;
  riskLevel: StockRiskLevel | null;
  updatedAt: string;
  /** Detalle por lote; vacío en filas informadas antes de TRZ-90. */
  batches: DistributorBatchStock[];
};

/** Cantidad de un lote en una distribuidora, en la unidad de su producto. */
export type DistributorBatchStock = {
  batchId: string;
  batchNumber: string;
  expirationDate: string | null;
  quantity: number;
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
  /** Unidad base del producto; queda fija una vez creado. */
  unitOfMeasure: ProductUnit;
};

/** Lote (fila de `batches`) con los datos de producto necesarios para listarlo. */
export type Lot = {
  id: string;
  batchNumber: string;
  productName: string;
  productSku: string;
  /** Unidad del producto, en la que se suman las cantidades de sus pallets. */
  unitOfMeasure: ProductUnit;
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
  /** Unidad de su producto. */
  unitOfMeasure: ProductUnit;
};

/** Pallet con la marca de si ya tiene eventos de trazabilidad (la base impide eliminarlo). */
export type PalletWithHistory = Pallet & { hasHistory: boolean };

/** Días de cada nivel de alerta de vencimiento, configurables por empresa (TRZ-90). */
export type ExpirationThresholds = {
  criticalDays: number;
  cautionDays: number;
  upcomingDays: number;
};

/**
 * Mercadería cuyo lote vence dentro del último nivel de alerta: un pallet en depósito
 * o un lote informado por una distribuidora (TRZ-90).
 */
export type ExpirationAlert = {
  id: string;
  source: "warehouse" | "distributor";
  productName: string;
  productSku: string;
  batchNumber: string;
  quantity: number;
  unitOfMeasure: ProductUnit;
  /** Ubicación del pallet en depósito o nombre de la distribuidora. */
  currentLocation: string | null;
  expirationDate: string;
  daysRemaining: number;
  urgency: "critical" | "warning" | "upcoming";
};
