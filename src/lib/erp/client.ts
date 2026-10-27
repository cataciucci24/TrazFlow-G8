import type {
  DispatchDocumentStatus,
  DispatchReport,
  DispatchReportResult,
  ErpDispatchOrder,
  ErpHealth,
  ErpMasterData,
  ErpProvider,
  ErpPullOptions,
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
}
