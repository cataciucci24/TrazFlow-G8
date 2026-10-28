import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type * as MenuModule from "./row-actions-menu";

const require = createRequire(import.meta.url);
const ts = require("typescript");

type Element = { type: unknown; props: Record<string, unknown> };

// Mismo enfoque que modal.test.ts: se compila el componente y se reemplazan los hooks de React, sin DOM.
function harness() {
  const states: unknown[] = [];
  let cursor = 0;
  const refs: { current: unknown }[] = [];
  let refCursor = 0;
  let ids = 0;
  const hooks = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (update: unknown) => { states[index] = typeof update === "function" ? (update as (value: unknown) => unknown)(states[index]) : update; }];
    },
    useRef: (initial: unknown) => refs[refCursor++] ?? (refs[refCursor - 1] = { current: initial }),
    useId: () => `menu-${ids++ % 2}`,
    useEffect: () => {},
    useLayoutEffect: () => {},
  };
  const code = ts.transpileModule(readFileSync(new URL("./row-actions-menu.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => name === "react" ? hooks
      : name === "react-dom" ? { createPortal: (node: unknown) => ({ portal: node }) }
      : name === "next/link" ? { __esModule: true, default: "Link" }
      : require(name),
    compiledModule, compiledModule.exports,
  );
  const api = compiledModule.exports as typeof MenuModule;
  function render(props: Parameters<typeof MenuModule.RowActionsMenu>[0]) {
    cursor = 0;
    refCursor = 0;
    return api.RowActionsMenu(props) as unknown as Element;
  }
  return { api, render, refs };
}

function all(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!node || typeof node !== "object") return [];
  if ("portal" in node) return all((node as { portal: unknown }).portal);
  if (!("props" in node)) return [];
  const element = node as Element;
  return [element, ...all(element.props.children)];
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object" && "props" in node) return text((node as Element).props.children);
  return "";
}

const byRole = (tree: Element, role: string) => all(tree).filter((element) => element.props.role === role);
const trigger = (tree: Element) => all(tree).find((element) => element.props["aria-haspopup"] === "menu")!;

function setup(onSelect = () => {}) {
  const env = harness();
  (globalThis as { document?: unknown }).document = { body: {}, activeElement: null };
  const props = {
    label: "Acciones del pallet PAL-1",
    actions: [
      { label: "Ver trazabilidad", href: "/dashboard/traceability?qr=PAL-1" },
      { label: "Ver QR", onSelect },
      { label: "Eliminar", disabledReason: "tiene historial de trazabilidad" },
    ],
  };
  return { ...env, props };
}

test("botón '⋯' con nombre accesible y semántica de menu button", () => {
  const { render, props } = setup();
  const button = trigger(render(props));
  assert.equal(button.type, "button");
  assert.equal(button.props["aria-label"], "Acciones del pallet PAL-1");
  assert.equal(button.props["aria-expanded"], false);
  assert.equal(button.props["aria-controls"], undefined);
  assert.equal(byRole(render(props), "menu").length, 0, "cerrado no dibuja el menú");
});

test("al abrir: role=menu con todas las opciones, links y deshabilitadas con motivo", () => {
  const { render, props } = setup();
  (trigger(render(props)).props.onClick as () => void)();
  const tree = render(props);
  const button = trigger(tree);
  assert.equal(button.props["aria-expanded"], true);
  const [menu] = byRole(tree, "menu");
  assert.equal(button.props["aria-controls"], menu.props.id);
  assert.equal(menu.props["aria-labelledby"], button.props.id);

  const items = byRole(tree, "menuitem");
  assert.deepEqual(items.map(text), ["Ver trazabilidad", "Ver QR", "Eliminar — tiene historial de trazabilidad"]);
  assert.equal(items[0].type, "Link");
  assert.equal(items[0].props.href, "/dashboard/traceability?qr=PAL-1");
  assert.equal(items[2].props["aria-disabled"], true);
  assert.ok(items.every((item) => item.props.tabIndex === -1), "el foco se mueve con flechas, no con Tab");
});

test("una opción deshabilitada no hace nada; una acción cierra, devuelve el foco y se ejecuta", () => {
  let selected = 0;
  const { render, props, refs } = setup(() => selected++);
  (trigger(render(props)).props.onClick as () => void)();
  let focused = 0;
  refs[0].current = { focus: () => focused++ };

  let prevented = 0;
  const disabled = byRole(render(props), "menuitem")[2];
  (disabled.props.onClick as (event: unknown) => void)({ preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.equal(byRole(render(props), "menu").length, 1, "sigue abierto");

  (byRole(render(props), "menuitem")[1].props.onClick as (event: unknown) => void)({ preventDefault: () => {} });
  assert.equal(selected, 1);
  assert.equal(focused, 1, "el foco vuelve al botón antes de abrir el diálogo");
  assert.equal(byRole(render(props), "menu").length, 0, "se cerró");
});

test("Escape cierra y devuelve el foco; flecha arriba en el botón abre en la última opción", () => {
  const { render, props, refs } = setup();
  let prevented = 0;
  (trigger(render(props)).props.onKeyDown as (event: unknown) => void)({ key: "ArrowUp", preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  const [menu] = byRole(render(props), "menu");
  assert.ok(menu, "abrió");
  let focused = 0;
  refs[0].current = { focus: () => focused++ };
  (menu.props.onKeyDown as (event: unknown) => void)({ key: "Escape", preventDefault: () => {} });
  assert.equal(focused, 1);
  assert.equal(byRole(render(props), "menu").length, 0);
});

test("nextMenuIndex: flechas con vuelta, Inicio y Fin", () => {
  const { api } = harness();
  assert.equal(api.nextMenuIndex(0, "ArrowDown", 3), 1);
  assert.equal(api.nextMenuIndex(2, "ArrowDown", 3), 0);
  assert.equal(api.nextMenuIndex(0, "ArrowUp", 3), 2);
  assert.equal(api.nextMenuIndex(-1, "ArrowDown", 3), 0, "sin foco, flecha abajo va a la primera");
  assert.equal(api.nextMenuIndex(1, "Home", 3), 0);
  assert.equal(api.nextMenuIndex(1, "End", 3), 2);
  assert.equal(api.nextMenuIndex(1, "a", 3), null);
  assert.equal(api.nextMenuIndex(0, "ArrowDown", 0), null);
});

test("menuPosition: abajo a la derecha, arriba si no entra, nunca fuera de la pantalla", () => {
  const { api } = harness();
  const viewport = { width: 390, height: 800 };
  const menu = { width: 208, height: 200 };
  assert.deepEqual(api.menuPosition({ top: 100, bottom: 136, left: 330, right: 374 }, menu, viewport), { top: 140, left: 166 });
  assert.deepEqual(api.menuPosition({ top: 700, bottom: 736, left: 330, right: 374 }, menu, viewport), { top: 496, left: 166 });
  assert.equal(api.menuPosition({ top: 100, bottom: 136, left: 0, right: 40 }, menu, viewport).left, 8, "no se sale por la izquierda");
  assert.equal(api.menuPosition({ top: 100, bottom: 136, left: 0, right: 40 }, { width: 500, height: 200 }, viewport).left, 8, "más ancho que la pantalla");
  const tall = api.menuPosition({ top: 100, bottom: 136, left: 330, right: 374 }, { width: 208, height: 790 }, viewport);
  assert.equal(tall.top, 8, "sin lugar arriba ni abajo, pegado al margen");
});
