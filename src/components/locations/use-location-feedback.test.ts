import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { useLocationFeedback } from "./use-location-feedback";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function harness() {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const effects: (() => () => void)[] = [];
  let stateIndex = 0, refIndex = 0, writes = 0;
  const hooks = {
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => () => void) => effects.push(effect),
    useRef: (value: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (update: unknown) => { writes++; states[index] = typeof update === "function" ? update(states[index]) : update; }];
    },
  };
  const compiled = { exports: {} as { useLocationFeedback: typeof useLocationFeedback } };
  const code = ts.transpileModule(readFileSync(new URL("./use-location-feedback.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "module", "exports", code)((name: string) => name === "react" ? hooks : require(name), compiled, compiled.exports);
  const render = () => { stateIndex = 0; refIndex = 0; return compiled.exports.useLocationFeedback(); };
  let api = render();
  const unmount = effects[0]();
  return { get api() { api = render(); return api; }, unmount, get writes() { return writes; } };
}

function withClock(run: (clock: { advance: (ms: number) => void; pending: () => number }) => void) {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let now = 0, nextId = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++nextId; timers.set(id, { due: now + delay, callback }); return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  try {
    run({ pending: () => timers.size, advance: (ms) => {
      now += ms;
      for (const [id, timer] of timers) if (timer.due <= now) { timers.delete(id); timer.callback(); }
    } });
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
}

test("el éxito dura cuatro segundos y un mensaje idéntico reinicia el plazo", () => withClock((clock) => {
  const h = harness();
  h.api.show({ success: "Movimiento registrado", error: null });
  clock.advance(3999);
  assert.equal(h.api.state.success, "Movimiento registrado");
  h.api.show({ success: "Movimiento registrado", error: null });
  assert.equal(clock.pending(), 1);
  h.api.clearError(); // Editing must not hide a success early.
  clock.advance(1);
  assert.equal(h.api.state.success, "Movimiento registrado");
  clock.advance(3999);
  assert.equal(h.api.state.success, null);
  h.unmount();
}));

test("los errores persisten y se limpian al corregir o iniciar otra operación", () => withClock((clock) => {
  const h = harness();
  h.api.show({ success: "Guardado", error: null });
  h.api.show({ success: null, error: "La ubicación cambió" });
  assert.equal(clock.pending(), 0);
  clock.advance(10000);
  assert.equal(h.api.state.error, "La ubicación cambió");
  h.api.clearError();
  assert.equal(h.api.state.error, null);
  h.api.show({ success: null, error: "Otro error" });
  h.api.clear();
  assert.deepEqual(h.api.state, { success: null, error: null });
  h.unmount();
}));

test("desmontar cancela el timer y una respuesta tardía no actualiza el estado", () => withClock((clock) => {
  const h = harness();
  h.api.show({ success: "Guardado", error: null });
  h.unmount();
  assert.equal(clock.pending(), 0);
  const writes = h.writes;
  clock.advance(10000);
  h.api.show({ success: "Respuesta tardía", error: null });
  h.api.clear();
  h.api.clearError();
  assert.equal(h.writes, writes);
}));
