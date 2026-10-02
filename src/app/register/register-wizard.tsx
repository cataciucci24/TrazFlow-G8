"use client";

import { useState } from "react";
import { signUp } from "@/lib/auth/actions";
import { RegistrationFields } from "@/components/registration-fields";
import { NAME_MAX_LENGTH, normalizeName } from "@/lib/registration/name";

type Props = { companies: { id: string; name: string }[]; error?: string };

export function RegisterWizard({ companies, error }: Props) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({ name: "", email: "", password: "", companyId: "", role: "" });

  const set = (k: keyof typeof data) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setData((d) => ({ ...d, [k]: e.target.value }));

  return (
    <form className="space-y-6" action={signUp}>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <input type="hidden" name="email" value={data.email} />
      <input type="hidden" name="name" value={data.name} />
      <input type="hidden" name="password" value={data.password} />
      <input type="hidden" name="companyId" value={data.companyId} />
      <input type="hidden" name="role" value={data.role} />

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
          <RegistrationFields companies={companies} companyId={data.companyId} role={data.role}
            onCompanyChange={set("companyId")} onRoleChange={set("role")} />
          <p className="text-sm text-stone-500">Primero confirmarás tu email. Después de iniciar sesión podrás enviar la solicitud.</p>
          <div className="flex gap-3">
            <button type="button" className="w-1/3 text-sm font-semibold text-stone-600 underline"
              onClick={() => setStep(1)}>Volver</button>
            <button type="submit" className="button-primary w-2/3"
              disabled={!data.companyId || !data.role}>Crear cuenta</button>
          </div>
        </>
      )}
    </form>
  );
}
