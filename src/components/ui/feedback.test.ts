import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type * as FeedbackModule from "./feedback";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// Exercise notification state and timers without adding a DOM/test dependency.
function harness() {
  const states: unknown[] = [];
  let cursor = 0;
  const refs: { current: number }[] = [];
  let refCursor = 0;
  const effects: (() => void | (() => void))[] = [];
  const hooks = {
    createContext: () => ({ Provider: "provider" }),
    useContext: () => null,
    useCallback: (callback: unknown) => callback,
    useRef: (initial: number) => refs[refCursor++] ?? (refs[refCursor - 1] = { current: initial }),
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (update: unknown) => { states[index] = typeof update === "function" ? update(states[index]) : update; }];
    },
    useEffect: (effect: () => void | (() => void)) => effects.push(effect),
  };
  const code = ts.transpileModule(readFileSync(new URL("./feedback.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText + "\nmodule.exports.TestNotice = SuccessNotice;";
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => name === "react" ? hooks : name.includes("design-system") ? { InlineAlert: "alert" } : require(name), compiledModule, compiledModule.exports,
  );
  const api = compiledModule.exports as typeof FeedbackModule & { TestNotice: (props: { notice: { id: number; message: string }; onDismiss: (id: number) => void }) => React.JSX.Element };
  function render<T>(component: () => T) { cursor = 0; refCursor = 0; effects.length = 0; return component(); }
  return { api, render, effects };
}

test("las notificaciones persisten aunque cambie el contenido, con un máximo de tres", () => {
  const { api, render } = harness();
  let tree = render(() => api.FeedbackProvider({ children: "fila original" }));
  const notify = tree.props.value;
  for (const message of ["uno", "dos", "tres", "cuatro"]) notify(message);
  tree = render(() => api.FeedbackProvider({ children: null }));
  const wrappers = tree.props.children[2].props.children;
  assert.deepEqual(wrappers.map((wrapper: { props: { children: { props: { notice: { message: string } } } } }) => wrapper.props.children.props.notice.message), ["dos", "tres", "cuatro"]);
  const notice = wrappers[2].props.children;
  notice.props.onDismiss(notice.props.notice.id);
  tree = render(() => api.FeedbackProvider({ children: null }));
  assert.equal(tree.props.children[2].props.children.length, 2);
  // Dismissal must not announce an older message again.
  assert.equal(tree.props.children[1].props.role, "status");
  assert.equal(tree.props.children[1].props.children.props.children, "cuatro");
});

test("el autocierre espera ocho segundos y se pausa mientras hay foco", () => {
  const provider = harness();
  let tree = provider.render(() => provider.api.FeedbackProvider({ children: null }));
  tree.props.value("Pallet eliminado");
  tree = provider.render(() => provider.api.FeedbackProvider({ children: null }));
  const notice = tree.props.children[2].props.children[0].props.children;
  const child = harness();
  let closed = 0;
  let delay = 0;
  let cancelled = 0;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: (_callback: () => void, milliseconds: number) => { delay = milliseconds; return 1; },
    clearTimeout: () => cancelled++,
  } });
  try {
    let item = child.render(() => child.api.TestNotice({ ...notice.props, onDismiss: () => closed++ }));
    const cleanup = child.effects[0]();
    assert.equal(delay, 8000);
    item.props.onFocus();
    if (cleanup) cleanup();
    item = child.render(() => child.api.TestNotice({ ...notice.props, onDismiss: () => closed++ }));
    assert.equal(child.effects[0](), undefined);
    assert.equal(cancelled, 1);
    const close = item.props.children.props.children[1];
    assert.equal(close.props["aria-label"], "Cerrar notificación");
    close.props.onClick();
    assert.equal(closed, 1);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
