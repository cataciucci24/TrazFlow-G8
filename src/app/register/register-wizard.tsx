"use client";

import { InlineAlert } from "@/components/ui/design-system";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { registrationErrorMessage } from "@/components/ui/feedback-messages";
import { signUp } from "@/lib/auth/actions";

type Props = { companies: { id: string; name: string }[]; error?: string };

export function RegisterWizard({ companies, error }: Props) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({ email: "", password: "", companyId: "", role: "" });

  const set = (k: keyof typeof data) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setData((d) => ({ ...d, [k]: e.target.value }));

  return (
    <form className="space-y-6" action={signUp}>
      {error && <InlineAlert variant="danger">{registrationErrorMessage(error)}</InlineAlert>}

      <input type="hidden" name="email" value={data.email} />
      <input type="hidden" name="password" value={data.password} />
      <input type="hidden" name="companyId" value={data.companyId} />
      <input type="hidden" name="role" value={data.role} />

      <RegistrationFields>
      <p className="text-xs font-semibold text-stone-500">Paso {step} de 2</p>

      {step === 1 && (
        <>
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-stone-600">Email</label>
            <input id="email" type="email" autoComplete="email" value={data.email}
              onChange={set("email")} placeholder="nombre@empresa.com" className="form-control mt-1" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-stone-600">Contraseña</label>
            <input id="password" type="password" autoComplete="new-password" value={data.password}
              onChange={set("password")} placeholder="Mínimo 8 caracteres" className="form-control mt-1" />
          </div>
          <button type="button" className="button-primary w-full"
            disabled={!data.email.includes("@") || data.password.length < 8}
            onClick={() => setStep(2)}>
            Siguiente
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <label htmlFor="company" className="block text-sm font-semibold text-stone-600">Empresa</label>
            <select id="company" value={data.companyId} onChange={set("companyId")} className="form-control mt-1">
              <option value="">Elegí tu empresa</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="role" className="block text-sm font-semibold text-stone-600">Rol que solicitás</label>
            <select id="role" value={data.role} onChange={set("role")} className="form-control mt-1">
              <option value="">Elegí un rol</option>
              <option value="warehouse_operator">Operador de depósito</option>
              <option value="distributor_operator">Operador de distribución</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button type="button" className="w-1/3 text-sm font-semibold text-stone-600 underline"
              onClick={() => setStep(1)}>Volver</button>
            <RegistrationSubmit disabled={!data.companyId || !data.role} />
          </div>
        </>
      )}
      </RegistrationFields>
    </form>
  );
}

function RegistrationFields({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <fieldset disabled={pending} aria-busy={pending} className="min-w-0 space-y-6">{children}</fieldset>;
}

function RegistrationSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="button-primary w-2/3" disabled={disabled || pending} aria-busy={pending}>{pending ? "Enviando…" : "Enviar solicitud"}</button>;
}
