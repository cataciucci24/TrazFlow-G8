"use server";

import { requireUserProfile } from "@/lib/auth/session";

export type SaveDistributorStockState = {
  error: string | null;
  success: string | null;
};

/** La carga manual quedó deshabilitada: el ERP es la fuente de stock. */
export async function saveDistributorStock(
  _previousState: SaveDistributorStockState,
  _formData: FormData,
): Promise<SaveDistributorStockState> {
  void _previousState;
  void _formData;
  await requireUserProfile();
  return {
    error: "La carga manual de stock fue reemplazada por la integración con el ERP.",
    success: null,
  };
}
