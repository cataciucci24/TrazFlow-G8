import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { LocationsPanel } from "./locations-panel";
import type { LocationActionState } from "../../lib/locations/types";

const require = createRequire(import.meta.url);
const ts = require("typescript");
type Element = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join(" ").replace(/\s+/g, " ");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return "";
}
function harness() {
  const states: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  const calls: FormData[] = [];
  let cursor = 0;
  let nextResult: LocationActionState = { success: "Movimiento registrado", error: null };
  const hooks = {
    useCallback: (fn: unknown) => fn,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (update: unknown) => { states[index] = typeof update === "function" ? update(states[index]) : update; }];
    },
    useTransition: () => [false, (fn: () => Promise<void>) => pending.push(fn())],
  };
  const feedback = () => {
    const [state, setState] = hooks.useState({ error: null, success: null }) as [LocationActionState, (state: LocationActionState) => void];
    return { state, show: setState, clear: () => setState({ error: null, success: null }), clearError: () => { if (state.error) setState({ error: null, success: null }); } };
  };
  const compiled = { exports: {} as { LocationsPanel: typeof LocationsPanel } };
  const code = ts.transpileModule(readFileSync(new URL("./locations-panel.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return hooks;
    if (name === "next/link") return { default: "link" };
    if (name === "next/navigation") return { useRouter: () => ({ refresh: () => {} }) };
    if (name.endsWith("use-location-feedback")) return { useLocationFeedback: feedback };
    if (name.endsWith("/rules")) return { canLocatePallet: (s: string) => ["in_warehouse", "assigned"].includes(s), findScannedLocation: () => undefined };
    if (name.endsWith("/actions")) return { createLocation: async () => nextResult, assignLocation: async (_state: unknown, form: FormData) => { calls.push(form); return nextResult; } };
    if (name.endsWith("design-system")) return { InlineAlert: "alert", SectionHeader: "heading", TableShell: "table-shell" };
    if (name.endsWith("location-qr")) return { LocationQr: "qr" };
    if (name.endsWith("qr-scanner")) return { QrScanner: "scanner" };
    if (name.endsWith("warehouse-field")) return { WarehouseField: "warehouse-field" };
    if (name === "@/lib/warehouses/types") return require("../../lib/warehouses/types.ts");
    return require(name);
  }, compiled, compiled.exports);
  const props: Parameters<typeof LocationsPanel>[0] = {
    locations: ["a", "b"].map((id) => ({ id, company_id: "company", warehouse_code: "DEP-01", code: id.toUpperCase(), aisle: "1", rack: "1", level: "1", position: id })),
    pallets: [{ id: "pallet", qrCode: "PAL-1", status: "in_warehouse", currentLocation: null, warehouseCode: "DEP-01", productName: "Producto", productSku: "SKU", batchNumber: "L", quantity: 1, unitOfMeasure: "unidades" }],
    locationIds: { pallet: null }, canMove: true, initialPalletId: "pallet",
  };
  const render = () => { cursor = 0; return nodes(compiled.exports.LocationsPanel(props)); };
  const select = (tree: Element[], name: string) => tree.find((n) => n.type === "select" && n.props.name === name)!;
  const change = (tree: Element[], name: string, value: string) => {
    (select(tree, name).props.onChange as (e: { target: { value: string } }) => void)({ target: { value } });
  };
  const submit = async (tree: Element[]) => {
    const previousFormData = globalThis.FormData;
    const values = tree.filter((n) => n.type === "select" || n.props.type === "hidden").map((n) => [n.props.name, n.props.value] as [string, string]);
    // Browser FormData reads the selected DOM values; supply those values in Node.
    globalThis.FormData = class extends previousFormData {
      constructor() { super(); for (const [name, value] of values) this.set(name, value); }
    };
    try {
      const form = tree.filter((n) => n.type === "form")[1];
      (form.props.onSubmit as (e: unknown) => void)({ preventDefault: () => {}, currentTarget: {} });
      await Promise.all(pending.splice(0));
    } finally { globalThis.FormData = previousFormData; }
  };
  return { props, render, select, change, submit, calls, setResult: (state: LocationActionState) => { nextResult = state; } };
}

test("confirmar conserva selección, actualiza contexto y explica el destino idéntico", async () => {
  const h = harness();
  h.change(h.render(), "locationId", "a");
  await h.submit(h.render());
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].get("expectedLocationId"), "");
  h.props.pallets[0] = { ...h.props.pallets[0], currentLocation: "DEP-01 / A" };
  h.props.locationIds.pallet = "a";
  const tree = h.render();
  assert.equal(h.select(tree, "palletId").props.value, "pallet");
  assert.equal(h.select(tree, "locationId").props.value, "a");
  assert.ok(tree.some((n) => text(n.props.children).includes("Ubicación actual: DEP-01 / A")));
  assert.ok(tree.some((n) => text(n.props.children).includes("El pallet ya se encuentra en esta ubicación.")));
  assert.equal(tree.find((n) => n.type === "button" && text(n.props.children) === "Confirmar ubicación")!.props.disabled, true);
  assert.equal(tree.find((n) => n.props.name === "expectedLocationId")!.props.value, "a");
  await h.submit(tree); // Even a forced submit must not send a duplicate movement.
  assert.equal(h.calls.length, 1);
  h.change(h.render(), "locationId", "b");
  await h.submit(h.render());
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].get("expectedLocationId"), "a");
});

test("un error de movimiento conserva la selección y se limpia al corregirla", async () => {
  const h = harness();
  h.setResult({ error: "La ubicación cambió mientras operabas.", success: null });
  h.change(h.render(), "locationId", "a");
  await h.submit(h.render());
  let tree = h.render();
  assert.equal(h.select(tree, "locationId").props.value, "a");
  assert.ok(tree.some((n) => n.type === "alert" && text(n.props.children).includes("La ubicación cambió")));
  h.change(tree, "locationId", "b");
  tree = h.render();
  assert.ok(!tree.some((n) => n.type === "alert" && text(n.props.children).includes("La ubicación cambió")));
});

test("TRZ-101: solo se ofrecen ubicaciones del depósito del pallet", () => {
  const h = harness();
  h.props.locations.push({ id: "n", company_id: "company", warehouse_code: "DEPOSITO-NORTE", code: "N1", aisle: "1", rack: "1", level: "1", position: "n" });
  const options = (tree: Element[]) => nodes(h.select(tree, "locationId").props.children)
    .filter((n) => n.type === "option" && n.props.value).map((n) => n.props.value);
  assert.deepEqual(options(h.render()), ["a", "b"]);
  h.props.pallets[0] = { ...h.props.pallets[0], warehouseCode: "DEPOSITO-NORTE" };
  assert.deepEqual(options(h.render()), ["n"]);
});

test("TRZ-101: con un solo depósito, el alta de ubicación lo nombra e incluye el selector (que se oculta solo)", () => {
  const h = harness();
  h.props.warehouses = [{ code: "DEP-01", name: "Depósito Central", externalId: null, sourceSystem: "trazflow", active: true, syncedAt: null }];
  const tree = h.render();
  assert.ok(tree.some((n) => n.type === "heading" && String(n.props.description).startsWith("Depósito DEP-01 · Depósito Central")));
  assert.ok(tree.some((n) => n.type === "warehouse-field"));
});
