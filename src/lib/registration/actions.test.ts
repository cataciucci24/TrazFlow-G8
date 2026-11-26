import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type * as Actions from "./actions";
import * as company from "./company.ts";
import * as cuit from "./cuit.ts";
import * as name from "./name.ts";
import * as options from "./options.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");

type Options = { profile?: boolean; rpcError?: { code: string } | null; plans?: string[]; metadataError?: boolean };

function harness({ profile = false, rpcError = null, plans = ["starter", "growth"], metadataError = false }: Options = {}) {
  const rpcCalls: unknown[][] = [], metadata: unknown[] = [];
  const compiled = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "module", "exports", source)((module: string) => {
    if (module === "./company") return company;
    if (module === "./cuit") return cuit;
    if (module === "./name") return name;
    if (module === "./options") return options;
    if (module === "./queries") return { getRegistrationCompanies: async () => [], hasRegistrationRequest: async () => false };
    if (module === "./signup-plans") return { getSignupPlans: async () => plans.map((code) => ({ code })) };
    if (module === "@/lib/auth/session") return {
      requireUser: async () => ({ id: "user-1", user_metadata: {} }), getUserProfile: async () => (profile ? { id: "user-1" } : null),
    };
    if (module === "@/lib/supabase/server") return { createClient: async () => ({
      auth: { updateUser: async (value: unknown) => { metadata.push(value); return { error: metadataError ? { message: "x" } : null }; } },
      rpc: async (...args: unknown[]) => { rpcCalls.push(args); return { data: "company-id", error: rpcError }; },
    }) };
    if (module === "next/cache") return { revalidatePath: () => undefined };
    if (module === "next/navigation") return { redirect: (url: string) => { throw new Error(`redirect:${url}`); } };
    throw new Error(module);
  }, compiled, compiled.exports);
  return { api: compiled.exports as typeof Actions, rpcCalls, metadata };
}

function form(values: Record<string, string> = {}) {
  const f = new FormData();
  for (const [key, value] of Object.entries({ name: " Ana Pérez ", companyName: " Nueva SA ", taxId: "30712345671", planCode: "growth", ...values })) {
    f.set(key, value);
  }
  return f;
}

test("da de alta la empresa con datos normalizados y sin mandar company_id ni rol", async () => {
  const h = harness();
  await assert.rejects(h.api.createCompanyRegistration(form()), /redirect:\/dashboard$/);
  assert.deepEqual(h.rpcCalls, [["create_company_with_manager", { p_company_name: "Nueva SA", p_tax_id: "30-71234567-1", p_plan_code: "growth" }]]);
  assert.equal((h.metadata[0] as { data: { name: string } }).data.name, "Ana Pérez");
});

test("valida en el servidor antes de llamar la RPC y conserva lo ingresado", async () => {
  const cases: [Record<string, string>, string][] = [
    [{ name: "  " }, "invalid-name"],
    [{ companyName: "X" }, "invalid-company-name"],
    [{ taxId: "30-71234567-8" }, "invalid-cuit"],
    [{ planCode: "enterprise" }, "invalid-plan"],
  ];
  for (const [values, error] of cases) {
    const h = harness({ plans: ["starter", "growth"] });
    await assert.rejects(h.api.createCompanyRegistration(form(values)), new RegExp(`redirect:/complete-registration\\?mode=new&error=${error}$`));
    assert.equal(h.rpcCalls.length, 0, error);
    assert.equal(h.metadata.length, 1, "guarda lo ingresado para prellenar el formulario");
  }
});

test("errores de la RPC se muestran con mensajes conocidos", async () => {
  for (const [code, error] of [["P4108", "duplicate-cuit"], ["P4105", "pending-request"], ["P4101", "email-unconfirmed"], ["XX000", "company-failed"]]) {
    const h = harness({ rpcError: { code } });
    await assert.rejects(h.api.createCompanyRegistration(form()), new RegExp(`error=${error}$`));
  }
});

test("si ya tiene perfil va al dashboard sin crear otra empresa", async () => {
  const withProfile = harness({ profile: true });
  await assert.rejects(withProfile.api.createCompanyRegistration(form()), /redirect:\/dashboard$/);
  assert.equal(withProfile.rpcCalls.length, 0);
  // Doble envío: la segunda llamada encuentra el perfil que creó la primera.
  const doubleSubmit = harness({ rpcError: { code: "P4104" } });
  await assert.rejects(doubleSubmit.api.createCompanyRegistration(form()), /redirect:\/dashboard$/);
});

test("una falla al guardar los datos no crea la empresa", async () => {
  const h = harness({ metadataError: true });
  await assert.rejects(h.api.createCompanyRegistration(form()), /error=company-failed$/);
  assert.equal(h.rpcCalls.length, 0);
});
