"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { processCompanyErpOutbox } from "@/lib/erp-outbox/run";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { createClient } from "@/lib/supabase/server";
import { decodeCsv, parseCsv } from "./csv";
import {
  IMPORT_STATUS_MESSAGES, MAX_IMPORT_BYTES, toRawRows, validateRows,
  type ImportPreview, type ImportResult, type ImportRow, type ImportRowError,
} from "./rows";
import { parseXlsx } from "./xlsx";

const CHUNK_SIZE = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN = "Solo logística puede importar stock.";

type Failure = { error: string };

/** El archivo se vuelve a leer al confirmar: nunca se confía en filas enviadas por el navegador. */
async function readFile(form: FormData): Promise<{ fileName: string; valid: ImportRow[]; errors: ImportRowError[]; total: number } | Failure> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí un archivo .xlsx o .csv." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "El archivo supera los 4 MB." };
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "xlsx" && extension !== "csv") return { error: "El archivo tiene que ser .xlsx o .csv." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const table = extension === "csv" ? parseCsv(decodeCsv(bytes)) : await parseXlsx(bytes);
  if (!table) return { error: "No pudimos leer el archivo. Revisá que sea un .xlsx válido." };
  const raw = toRawRows(table);
  if ("error" in raw) return raw;
  return { fileName: file.name, total: raw.rows.length, ...validateRows(raw.rows) };
}

/** Pasa las filas válidas por la base, de a tandas. Una tanda que falla deja sus filas sin procesar, no las pierde. */
async function runRows(valid: ImportRow[], mode: "erp" | "manual", requestId: string | null) {
  const supabase = await createClient();
  const accepted: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  let unprocessed = 0;
  for (let start = 0; start < valid.length; start += CHUNK_SIZE) {
    const chunk = valid.slice(start, start + CHUNK_SIZE);
    const { data, error } = await supabase.rpc("import_stock_rows", {
      p_request_id: requestId, p_mode: mode, p_dry_run: requestId === null, p_rows: chunk,
    });
    if (error || !Array.isArray(data)) {
      if (error?.code === "42501") throw new Error(FORBIDDEN);
      unprocessed += chunk.length;
      continue;
    }
    const statuses = new Map((data as { row: number; status: string }[]).map(item => [item.row, item.status]));
    for (const row of chunk) {
      const status = statuses.get(row.row);
      if (status === "ok" || status === "imported") accepted.push(row);
      else errors.push({ row: row.row, messages: [IMPORT_STATUS_MESSAGES[status ?? "write_failed"] ?? IMPORT_STATUS_MESSAGES.write_failed] });
    }
  }
  return { accepted, errors, unprocessed, supabase };
}

const byRow = (a: ImportRowError, b: ImportRowError) => a.row - b.row;

export async function previewStockImport(form: FormData): Promise<ImportPreview | Failure> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: FORBIDDEN };
  const file = await readFile(form);
  if ("error" in file) return file;
  const mode = await isErpEnabled(profile.companyId) ? "erp" : "manual";
  try {
    const { accepted, errors, unprocessed } = await runRows(file.valid, mode, null);
    if (unprocessed) return { error: "No pudimos validar el archivo contra tus datos. Probá de nuevo." };
    return {
      fileName: file.fileName, mode, total: file.total, validCount: accepted.length,
      errors: [...file.errors, ...errors].sort(byRow), sample: accepted.slice(0, 10),
    };
  } catch (error) {
    return { error: error instanceof Error && error.message === FORBIDDEN ? FORBIDDEN : "No pudimos validar el archivo. Probá de nuevo." };
  }
}

export async function confirmStockImport(form: FormData): Promise<ImportResult | Failure> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: FORBIDDEN };
  const requestId = form.get("requestId");
  if (typeof requestId !== "string" || !UUID.test(requestId)) return { error: "Volvé a revisar el archivo antes de confirmar." };
  const file = await readFile(form);
  if ("error" in file) return file;
  const mode = await isErpEnabled(profile.companyId) ? "erp" : "manual";
  try {
    const { accepted, errors, unprocessed, supabase } = await runRows(file.valid, mode, requestId);
    if (accepted.length) {
      if (mode === "erp") {
        after(() => processCompanyErpOutbox({
          db: { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage },
          companyId: profile.companyId,
        }));
      }
      for (const path of ["/dashboard/inventory", "/dashboard/pallets", "/dashboard/lots", "/dashboard/alerts", "/dashboard/integrations"]) revalidatePath(path);
    }
    return { mode, total: file.total, imported: accepted.length, errors: [...file.errors, ...errors].sort(byRow), unprocessed };
  } catch (error) {
    return { error: error instanceof Error && error.message === FORBIDDEN ? FORBIDDEN : "No pudimos importar el archivo. Podés reintentar: no se duplica." };
  }
}
