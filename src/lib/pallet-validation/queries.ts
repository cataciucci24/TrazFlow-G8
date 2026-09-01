import { createClient } from "@/lib/supabase/server";
import type { OrderPalletValidation } from "@/lib/pallet-validation/types";

type RawOrderPallet = {
  validated_at: string | null;
  validated_by: string | null;
  pallets:
    | {
        id: string;
        qr_code: string;
        batches:
          | {
              batch_number: string;
              products:
                | { name: string; sku: string }
                | { name: string; sku: string }[]
                | null;
            }
          | {
              batch_number: string;
              products:
                | { name: string; sku: string }
                | { name: string; sku: string }[]
                | null;
            }[]
          | null;
      }
    | {
        id: string;
        qr_code: string;
        batches: null;
      }[]
    | null;
};

/** Pallets de una orden con el estado persistido de validación de US3. */
export async function getOrderPalletValidations(
  orderId: string,
): Promise<OrderPalletValidation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_pallets")
    .select(
      "validated_at, validated_by, pallets ( id, qr_code, batches ( batch_number, products ( name, sku ) ) )",
    )
    .eq("order_id", orderId)
    .order("pallet_id");

  if (error) {
    throw new Error(
      `No se pudieron leer las validaciones de pallets (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  return ((data ?? []) as unknown as RawOrderPallet[]).flatMap((row) => {
    const pallet = Array.isArray(row.pallets) ? row.pallets[0] : row.pallets;
    if (!pallet) return [];

    const batch = Array.isArray(pallet.batches)
      ? pallet.batches[0]
      : pallet.batches;
    const product = batch
      ? Array.isArray(batch.products)
        ? batch.products[0]
        : batch.products
      : null;

    return [{
      id: pallet.id,
      qrCode: pallet.qr_code,
      productName: product?.name ?? "—",
      productSku: product?.sku ?? "—",
      batchNumber: batch?.batch_number ?? "—",
      validatedAt: row.validated_at,
      validatedBy: row.validated_by,
    }];
  });
}
