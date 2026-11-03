import type {
  BatchPickingPolicy,
  DeliveryReceipt,
  DeliveryReport,
  DeliveryReportResult,
  DispatchDocumentStatus,
  DispatchReport,
  DispatchReportResult,
  ErpDispatchOrder,
  ErpHealth,
  ErpMasterData,
  ErpProvider,
  ErpPullOptions,
  PalletScanReport,
  StockEntryReport,
  StockImportReport,
} from "./types.ts";

/**
 * Única puerta de TrazFlow hacia el ERP. El resto de la app depende de esta interfaz, nunca de un proveedor
 * concreto ni de URLs. Todas las operaciones fallan con ErpError.
 */
export interface ErpClient {
  readonly provider: ErpProvider;

  /** Verifica conectividad y credenciales. */
  healthcheck(): Promise<ErpHealth>;

  /** Productos, lotes y stock disponible por lote. */
  pullMasterData(options?: ErpPullOptions): Promise<ErpMasterData>;

  /** Órdenes de despacho originadas en el ERP que todavía pueden despacharse. */
  pullDispatchOrders(options?: ErpPullOptions): Promise<ErpDispatchOrder[]>;

  /**
   * Informa qué pallets y lotes salieron realmente. Idempotente por `report.idempotencyKey`: repetir la clave
   * devuelve el resultado original con `duplicate: true` en vez de registrar otra salida.
   */
  reportDispatch(report: DispatchReport): Promise<DispatchReportResult>;

  /**
   * Estado en el ERP del documento que generó el reporte con esa clave (TRZ-100). Sirve para saber cuándo el ERP
   * ya descontó el stock de lo despachado. Si hay varios documentos con la misma clave (uno anulado y uno
   * corregido) gana el confirmado, después el borrador y por último el anulado.
   */
  getDispatchStatus(idempotencyKey: string): Promise<DispatchDocumentStatus>;

  /**
   * Informa cómo cerró la entrega (TRZ-103): resultado por pallet y diferencias, en el documento que generó el
   * despacho. Idempotente por `report.idempotencyKey`. Si ese documento todavía no existe falla con `not_ready`
   * (reintentable). Nunca confirma el documento: eso lo hace administración en el ERP.
   */
  reportDelivery(report: DeliveryReport): Promise<DeliveryReportResult>;

  /**
   * Adjunta el remito firmado (foto o PDF) al documento del despacho (TRZ-103). Idempotente por
   * `receipt.idempotencyKey`. Mismo `not_ready` si el documento todavía no existe.
   */
  attachDeliveryReceipt(receipt: DeliveryReceipt, content: Uint8Array): Promise<DeliveryReportResult>;

  /**
   * Regla con la que el ERP elige qué lote sale primero (TRZ-65). TrazFlow la usa solo para sugerir el orden de los
   * pallets al armar una orden. Si el ERP no tiene una regla configurada, devuelve `fifo`.
   */
  getBatchPickingPolicy(): Promise<BatchPickingPolicy>;

  /**
   * TRZ-62: alta o baja de stock como documento en borrador (en ERPNext, un Stock Entry). Nunca lo confirma: lo
   * hace el ERP. Idempotente por `entry.idempotencyKey`.
   */
  reportStockEntry(entry: StockEntryReport): Promise<DeliveryReportResult>;

  /**
   * USH1: crea el producto y el lote que falten y deja el stock como documento en borrador. Nunca lo confirma.
   * Idempotente por `entry.idempotencyKey`.
   */
  reportStockImport(entry: StockImportReport): Promise<DeliveryReportResult>;

  /**
   * TRZ-63: agrega (scan) o saca (unscan) el pallet del documento de preparación de la orden (en ERPNext, un Pick
   * List en borrador). Idempotente por `scan.idempotencyKey`. Un unscan que llega antes que su scan falla con
   * `not_ready` (reintentable).
   */
  reportPalletScan(scan: PalletScanReport): Promise<DeliveryReportResult>;
}
