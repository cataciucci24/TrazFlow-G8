import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type * as ModalModule from "./modal";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// Isolate handlers and the effect lifecycle; browser focus trapping is native to <dialog>.
function harness() {
  const effects: (() => void | (() => void))[] = [];
  let nextId = 0;
  const hooks = {
    useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    useRef: () => ({ current: null }),
    useId: () => `modal-test-${nextId++}`,
  };
  const source = readFileSync(new URL("./modal.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => name === "react" ? hooks : require(name), compiledModule, compiledModule.exports,
  );
  return { api: compiledModule.exports as typeof ModalModule, effects };
}

function buttons(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [
    ...(element.type === "button" ? [element.props] : []),
    ...buttons(element.props.children),
  ];
}

test("Escape respects pending operations and the form's explicit-close policy", () => {
  for (const [busy, dismissOnEscape, expected] of [[true, true, 0], [false, false, 0], [false, true, 1]] as const) {
    const { api } = harness();
    let closed = 0;
    let prevented = 0;
    const dialog = api.Modal({ open: true, title: "Guardar", busy, dismissOnEscape, onClose: () => closed++ });
    dialog.props.onCancel({ preventDefault: () => prevented++ });
    assert.equal(prevented, 1);
    assert.equal(closed, expected);
  }
});

test("backdrop closes only outside the dialog and never while busy or editing a form", () => {
  for (const [busy, dismissOnBackdrop, outside, expected] of [
    [false, true, true, 1], [false, true, false, 0], [true, true, true, 0], [false, false, true, 0],
  ] as const) {
    const { api } = harness();
    let closed = 0;
    const dialog = api.Modal({ open: true, title: "Confirmar", busy, dismissOnBackdrop, onClose: () => closed++ });
    const target = { getBoundingClientRect: () => ({ left: 20, right: 200, top: 20, bottom: 200 }) };
    dialog.props.onClick({ target, currentTarget: target, clientX: outside ? 5 : 50, clientY: 50 });
    assert.equal(closed, expected);
    dialog.props.onClick({ target: {}, currentTarget: target, clientX: 5, clientY: 50 });
    assert.equal(closed, expected);
  }
});

test("pending confirmations disable cancel, confirm and close; blocked actions keep cancel available", () => {
  const { api } = harness();
  const pending = api.ConfirmationDialog({ open: true, title: "Eliminar", description: "No se puede deshacer.", confirmLabel: "Eliminar", busy: true, danger: true, onClose() {}, onConfirm() {} });
  const actions = buttons(pending.props.actions);
  assert.equal(actions.length, 2);
  assert.ok(actions.every((button) => button.disabled));
  assert.equal(actions[1]["aria-busy"], true);
  const dialog = api.Modal(pending.props);
  assert.equal(dialog.type, "dialog");
  assert.equal(dialog.props["aria-modal"], "true");
  assert.equal(dialog.props["aria-busy"], true);
  assert.ok(dialog.props["aria-labelledby"]);
  assert.ok(dialog.props["aria-describedby"]);
  assert.ok(buttons(dialog).every((button) => button.disabled));
  const blocked = api.ConfirmationDialog({ ...pending.props, busy: false, blocked: true });
  assert.equal(buttons(blocked.props.actions)[0].disabled, false);
  assert.equal(buttons(blocked.props.actions)[1].disabled, true);
});

test("modal lifecycle restores scrolling and focus, including when the removed entity loses its trigger", () => {
  for (const target of ["trigger", "list", "page"]) {
    const { api, effects } = harness();
    let focused = "";
    class Element {
      isConnected = target === "trigger";
      focus() { focused = "trigger"; }
      closest() { return { isConnected: target !== "page", focus() { focused = "list"; } }; }
    }
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const previousHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
    const body = { style: { overflow: "auto" } };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: new Element(), body, querySelector: () => ({ isConnected: true, focus() { focused = "page"; } }) } });
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Element });
    try {
      let opened = 0;
      let closed = 0;
      const dialog = api.Modal({ open: true, title: "Entidad", onClose() {} });
      dialog.props.ref.current = { showModal() { opened++; }, close() { closed++; } };
      const cleanup = effects[0]();
      assert.equal(opened, 1);
      assert.equal(body.style.overflow, "hidden");
      assert.equal(typeof cleanup, "function");
      if (cleanup) cleanup();
      assert.equal(closed, 1);
      assert.equal(body.style.overflow, "auto");
      assert.equal(focused, target);
    } finally {
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else Reflect.deleteProperty(globalThis, "document");
      if (previousHTMLElement) Object.defineProperty(globalThis, "HTMLElement", previousHTMLElement);
      else Reflect.deleteProperty(globalThis, "HTMLElement");
    }
  }
});
