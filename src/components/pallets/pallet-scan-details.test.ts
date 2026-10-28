import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { PalletScanDetails } from "./pallet-scan-details";
import type { PalletScanResult } from "../../lib/scans/types";

const require = createRequire(import.meta.url);
const ts = require("typescript");
type Element = { type: unknown; props: Record<string, unknown> };
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return "";
}
function harness() {
  const states: unknown[] = [];
  let cursor = 0;
  let mounted = false;
  let cleanup: (() => void) | undefined;
  let resolve!: (result: PalletScanResult) => void;
  let reject!: (error: Error) => void;
  const request = new Promise<PalletScanResult>((yes, no) => { resolve = yes; reject = no; });
  const compiled = { exports: {} as { PalletScanDetails: typeof PalletScanDetails } };
  const code = ts.transpileModule(readFileSync(new URL("./pallet-scan-details.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return {
      useState: (initial: unknown) => {
        const i = cursor++;
        if (!(i in states)) states[i] = initial;
        return [states[i], (update: unknown) => { states[i] = typeof update === "function" ? update(states[i]) : update; }];
      },
      useEffect: (effect: () => () => void) => { if (!mounted) { mounted = true; cleanup = effect(); } },
    };
    if (name.endsWith("scans/actions")) return { getPalletScanDetails: () => request };
    if (name.endsWith("scans/types")) return require("../../lib/scans/types.ts");
    return require(name);
  }, compiled, compiled.exports);
  const render = () => { cursor = 0; return text(compiled.exports.PalletScanDetails({ qrCode: "PAL-1" })); };
  return { render, resolve: async (result: PalletScanResult) => { resolve(result); await request; },
    reject: async () => { reject(new Error("offline")); await request.catch(() => {}); }, unmount: () => cleanup?.() };
}

const pallet = { qr_code: "PAL-1", product_name: "Arroz", product_sku: "ARR", batch_number: "L-1", quantity: 12.5,
  unit_of_measure: "kilogramos", physical_location: "DEP-01 / A01", last_event_type: "dispatch_confirmed",
  last_event_at: "2026-10-27T13:00:00Z", actor_name: "Ambar", actor_role: "warehouse_operator" };

test("muestra cantidad real, ubicación y última acción con persona, rol y fecha", async () => {
  const h = harness();
  assert.match(h.render(), /Cargando/);
  await h.resolve({ pallet, error: null });
  const content = h.render();
  for (const expected of ["Arroz", "L-1", "12,5 kilogramos", "DEP-01 / A01", "Despacho confirmado", "Ambar", "Operador de depósito", "27/10/26"]) assert.ok(content.includes(expected), expected);
});

test("distingue un pallet sin historial, cantidad o ubicación", async () => {
  const h = harness(); h.render();
  await h.resolve({ pallet: { ...pallet, quantity: null, physical_location: null, last_event_type: null, last_event_at: null, actor_name: null, actor_role: null }, error: null });
  const content = h.render();
  for (const expected of ["Sin movimientos registrados", "Sin cantidad registrada", "Sin ubicación"]) assert.ok(content.includes(expected));
});

test("un error de conexión ofrece reintentar y no se presenta como historial vacío", async () => {
  const h = harness(); h.render(); await h.reject();
  assert.match(h.render(), /Revisá tu conexión/);
  assert.match(h.render(), /Reintentar consulta/);
  assert.doesNotMatch(h.render(), /Sin movimientos registrados/);
});

test("una respuesta tardía no modifica una ficha desmontada", async () => {
  const h = harness(); h.render(); h.unmount();
  await h.resolve({ pallet, error: null });
  assert.match(h.render(), /Cargando/);
  assert.doesNotMatch(h.render(), /Ambar/);
});
