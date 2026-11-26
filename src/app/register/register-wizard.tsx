"use client";

import { InlineAlert } from "@/components/ui/design-system";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { registrationErrorMessage } from "@/components/ui/feedback-messages";
import { signUp } from "@/lib/auth/actions";
import { RegistrationFields as RegistrationOptions } from "@/components/registration-fields";
import { NAME_MAX_LENGTH, normalizeName } from "@/lib/registration/name";
import { NewCompanyFields } from "@/components/new-company-fields";
import { normalizeCompanyName, type RegistrationMode } from "@/lib/registration/company";
import { normalizeCuit } from "@/lib/registration/cuit";

type Props = { companies: { id: string; name: string }[]; error?: string };

export function RegisterWizard({ companies, error }: Props) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<RegistrationMode>("join");
  const [data, setData] = useState({ name: "", email: "", password: "", companyId: "", role: "", companyName: "", taxId: "" });

  const set = (k: keyof typeof data) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setData((d) => ({ ...d, [k]: e.target.value }));
  const taxIdInvalid = data.taxId.trim() !== "" && normalizeCuit(data.taxId) === null;
  const ready = mode === "new"
    ? normalizeCompanyName(data.companyName) !== null && normalizeCuit(data.taxId) !== null
    : Boolean(data.companyId && data.role);

  return (
    <form className="space-y-6" action={signUp}>
      {error && <InlineAlert variant="danger">{registrationErrorMessage(error)}</InlineAlert>}

      <input type="hidden" name="email" value={data.email} />
      <input type="hidden" name="name" value={data.name} />
      <input type="hidden" name="password" value={data.password} />
      <input type="hidden" name="companyId" value={data.companyId} />
      <input type="hidden" name="role" value={data.role} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="companyName" value={data.companyName} />
      <input type="hidden" name="taxId" value={data.taxId} />

      <RegistrationFields>
      <p className="text-xs font-semibold text-stone-500">Paso {step} de 2</p>

      {step === 1 && (
        <>
          <div>
            <label htmlFor="name" className="block text-sm font-semibold text-stone-600">Nombre completo</label>
            <input id="name" autoComplete="name" required maxLength={NAME_MAX_LENGTH} value={data.name}
              onChange={set("name")} className="form-control mt-1" />
          </div>
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
            disabled={!normalizeName(data.name) || !data.email.includes("@") || data.password.length < 8}
            onClick={() => setStep(2)}>
            Siguiente
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-stone-600">¿Cómo querés usar TrazFlow?</legend>
            <ModeOption mode="join" current={mode} onSelect={setMode} title="Sumarme a una empresa"
              description="Tu empresa ya usa TrazFlow: su responsable logístico aprueba tu acceso." />
            <ModeOption mode="new" current={mode} onSelect={setMode} title="Dar de alta mi empresa"
              description="Tu empresa todavía no usa TrazFlow: vas a ser su responsable logístico." />
          </fieldset>
          {mode === "join" ? (
            <RegistrationOptions companies={companies} companyId={data.companyId} role={data.role}
              onCompanyChange={set("companyId")} onRoleChange={set("role")} />
          ) : (
            <NewCompanyFields companyName={data.companyName} taxId={data.taxId} taxIdInvalid={taxIdInvalid}
              onCompanyNameChange={set("companyName")} onTaxIdChange={set("taxId")} />
          )}
          <p className="text-sm text-stone-500">{mode === "join"
            ? "Primero confirmarás tu email. Después de iniciar sesión podrás enviar la solicitud."
            : "Primero confirmarás tu email. Después de iniciar sesión vas a elegir el plan y crear la empresa."}</p>
          <div className="flex gap-3">
            <button type="button" className="w-1/3 text-sm font-semibold text-stone-600 underline"
              onClick={() => setStep(1)}>Volver</button>
            <RegistrationSubmit disabled={!ready} />
          </div>
        </>
      )}
      </RegistrationFields>
    </form>
  );
}

function ModeOption({ mode, current, onSelect, title, description }: {
  mode: RegistrationMode; current: RegistrationMode; onSelect: (mode: RegistrationMode) => void;
  title: string; description: string;
}) {
  return (
    <label className="surface flex cursor-pointer gap-3 p-4 has-[:checked]:border-sky-600 has-[:checked]:ring-1 has-[:checked]:ring-sky-600">
      <input type="radio" name="registrationMode" value={mode} checked={current === mode}
        onChange={() => onSelect(mode)} className="mt-1" />
      <span className="min-w-0">
        <span className="block font-semibold text-stone-950">{title}</span>
        <span className="mt-1 block text-sm text-stone-600">{description}</span>
      </span>
    </label>
  );
}

function RegistrationFields({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <fieldset disabled={pending} aria-busy={pending} className="min-w-0 space-y-6">{children}</fieldset>;
}

function RegistrationSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="button-primary w-2/3" disabled={disabled || pending} aria-busy={pending}>{pending ? "Creando cuenta…" : "Crear cuenta"}</button>;
}
