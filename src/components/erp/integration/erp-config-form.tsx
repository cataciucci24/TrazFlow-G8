"use client";

import { useRef, useState, useTransition } from "react";

import { InlineAlert } from "@/components/ui/design-system";
import { useFeedback } from "@/components/ui/feedback";
import { MOCK_DISPATCH_STATUSES, MOCK_SCENARIOS } from "@/lib/erp/mock-scenarios";
import { saveErpConfig, testErpConnection } from "@/lib/erp-integration/actions";
import {
  ERP_CONFIG_PROVIDER_LABELS,
  ERP_CONFIG_PROVIDERS,
  type ErpConfigActionState,
  type ErpConfigProvider,
  type ErpConfigView,
} from "@/lib/erp-integration/types";

const IDLE: ErpConfigActionState = { status: "idle", message: null };
const ALERT = { success: "success", warning: "warning", error: "danger" } as const;

function masked(hint: string | null) {
  return hint ? `••••${hint}` : null;
}

/**
 * Configuración del ERP de la empresa (TRZ-112). Solo logística. Las credenciales se escriben pero nunca se
 * muestran: de las guardadas se ven solo las últimas 4 letras. Si se cambia el proveedor o la URL hay que volver
 * a ingresarlas (así una URL nueva nunca recibe la credencial guardada).
 */
export function ErpConfigForm({ view }: { view: ErpConfigView }) {
  const notify = useFeedback();
  const formRef = useRef<HTMLFormElement>(null);
  const [provider, setProvider] = useState<ErpConfigProvider>(view.provider);
  const [baseUrl, setBaseUrl] = useState(view.baseUrl ?? "");
  const [state, setState] = useState(IDLE);
  const [pending, setPending] = useState<"test" | "save" | null>(null);
  const [, startTransition] = useTransition();

  const providers = ERP_CONFIG_PROVIDERS.filter((option) => option !== "mock" || view.allowMock || view.provider === "mock");
  const sameTarget = provider === view.provider && baseUrl.trim().replace(/\/+$/, "") === (view.baseUrl ?? "");
  const keyHint = sameTarget ? masked(view.apiKeyHint) : null;
  const secretHint = sameTarget ? masked(view.apiSecretHint) : null;
  const changesProvider = view.provider !== "none" && provider !== view.provider;

  function run(kind: "test" | "save") {
    if (pending || !formRef.current) return;
    const data = new FormData(formRef.current);
    setPending(kind);
    startTransition(async () => {
      try {
        const next = await (kind === "test" ? testErpConnection(data) : saveErpConfig(data));
        setState(next);
        if (kind === "save" && next.status === "success" && next.message) {
          notify(next.message);
          formRef.current?.querySelectorAll<HTMLInputElement>("input[type=password]").forEach((input) => { input.value = ""; });
        }
      } catch {
        setState({ status: "error", message: kind === "test" ? "No se pudo probar la conexión. Intentá nuevamente." : "No se pudo guardar. Intentá nuevamente." });
      } finally {
        setPending(null);
      }
    });
  }

  return (
    <section className="surface space-y-4 p-4 sm:p-5" aria-labelledby="erp-config-title">
      <div>
        <h2 id="erp-config-title" className="text-base font-semibold text-slate-950">Configuración del ERP</h2>
        <p className="text-sm text-stone-600">
          El ERP de tu empresa. Solo lo ven y lo cambian los responsables de logística. Las credenciales se guardan cifradas y nunca se muestran.
        </p>
      </div>

      {view.usesServerVariables ? (
        <InlineAlert variant="info" className="text-sm">
          Hoy tu empresa usa el ERP configurado en el servidor. Si guardás una configuración acá, pasa a usar esta.
        </InlineAlert>
      ) : null}

      <form ref={formRef} className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); run("save"); }}>
        <label className="form-label sm:col-span-2">
          Proveedor
          <select name="provider" className="form-control mt-2" value={provider}
            onChange={(event) => setProvider(event.target.value as ErpConfigProvider)}>
            {providers.map((option) => <option key={option} value={option}>{ERP_CONFIG_PROVIDER_LABELS[option]}</option>)}
          </select>
        </label>

        {changesProvider ? (
          <InlineAlert variant="warning" className="text-sm sm:col-span-2">
            Cambiar de ERP no borra lo que ya se sincronizó. Los productos, lotes y órdenes del ERP anterior quedan en TrazFlow.
          </InlineAlert>
        ) : null}

        {provider === "erpnext" || provider === "odoo" ? (
          <>
            <label className="form-label sm:col-span-2">
              URL del ERP
              <input name="baseUrl" type="url" required className="form-control mt-2" placeholder="https://erp.miempresa.com"
                value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoComplete="off" />
            </label>
            {provider === "odoo" ? (
              <>
                <label className="form-label">
                  Base de datos de Odoo
                  <input name="odooDatabase" required className="form-control mt-2" defaultValue={view.odooDatabase ?? ""} autoComplete="off" />
                </label>
                <label className="form-label">
                  Usuario de Odoo
                  <input name="odooUsername" required className="form-control mt-2" defaultValue={view.odooUsername ?? ""} autoComplete="off" />
                </label>
              </>
            ) : null}
            <label className="form-label">
              API key
              <input name="apiKey" type="password" className="form-control mt-2" autoComplete="new-password"
                placeholder={keyHint ? `${keyHint} (vacío = conservar)` : "Obligatoria"} required={!keyHint} />
            </label>
            {provider === "erpnext" ? (
              <label className="form-label">
                API secret
                <input name="apiSecret" type="password" className="form-control mt-2" autoComplete="new-password"
                  placeholder={secretHint ? `${secretHint} (vacío = conservar)` : "Obligatorio"} required={!secretHint} />
              </label>
            ) : null}
            {provider === "erpnext" ? (
              <label className="form-label">
                Grupo de productos para la importación (opcional)
                <input name="itemGroup" className="form-control mt-2" defaultValue={view.itemGroup ?? ""} autoComplete="off" />
              </label>
            ) : null}
            <label className="form-label">
              Tiempo de espera, en segundos (opcional)
              <input name="timeoutSeconds" type="number" min={1} max={60} step={1} className="form-control mt-2"
                defaultValue={view.timeoutSeconds ?? ""} placeholder="10" />
            </label>
            {!sameTarget && (view.apiKeyHint || view.apiSecretHint) ? (
              <p className="text-xs text-stone-500 sm:col-span-2">Cambiaste el proveedor o la URL: ingresá las credenciales de nuevo.</p>
            ) : null}
          </>
        ) : null}

        {provider === "mock" ? (
          <>
            <label className="form-label">
              Escenario simulado
              <select name="mockScenario" className="form-control mt-2" defaultValue={view.mockScenario ?? "ok"}>
                {MOCK_SCENARIOS.map((scenario) => <option key={scenario} value={scenario}>{scenario}</option>)}
              </select>
            </label>
            <label className="form-label">
              Estado del remito simulado
              <select name="mockDispatchStatus" className="form-control mt-2" defaultValue={view.mockDispatchStatus ?? "confirmed"}>
                {MOCK_DISPATCH_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
          </>
        ) : null}

        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {provider !== "none" ? (
            <button type="button" className="button-secondary" onClick={() => run("test")} disabled={pending !== null} aria-busy={pending === "test"}>
              {pending === "test" ? "Probando…" : "Probar conexión"}
            </button>
          ) : null}
          <button type="submit" className="button-primary" disabled={pending !== null} aria-busy={pending === "save"}>
            {pending === "save" ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      </form>

      {state.status !== "idle" && state.message ? (
        <InlineAlert variant={ALERT[state.status]} className="text-sm">
          {state.message}
          {state.errors?.length ? <ul className="mt-1 list-disc pl-5">{state.errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
        </InlineAlert>
      ) : null}
    </section>
  );
}
