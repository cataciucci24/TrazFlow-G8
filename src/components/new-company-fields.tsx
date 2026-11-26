import type { ChangeEventHandler } from "react";
import { COMPANY_NAME_MAX_LENGTH } from "@/lib/registration/company";

type Props = {
  companyName: string;
  taxId: string;
  /** Con handlers, los campos son controlados (wizard de /register); sin ellos, envían su valor en el form. */
  onCompanyNameChange?: ChangeEventHandler<HTMLInputElement>;
  onTaxIdChange?: ChangeEventHandler<HTMLInputElement>;
  taxIdInvalid?: boolean;
};

export function NewCompanyFields({ companyName, taxId, onCompanyNameChange, onTaxIdChange, taxIdInvalid }: Props) {
  return (
    <>
      <div>
        <label htmlFor="companyName" className="block text-sm font-semibold text-stone-600">Nombre de la empresa</label>
        <input id="companyName" name={onCompanyNameChange ? undefined : "companyName"} required
          autoComplete="organization" maxLength={COMPANY_NAME_MAX_LENGTH}
          {...(onCompanyNameChange ? { value: companyName, onChange: onCompanyNameChange } : { defaultValue: companyName })}
          className="form-control mt-1" />
      </div>
      <div>
        <label htmlFor="taxId" className="block text-sm font-semibold text-stone-600">CUIT</label>
        <input id="taxId" name={onTaxIdChange ? undefined : "taxId"} required inputMode="numeric" maxLength={20}
          placeholder="30-12345678-9" aria-describedby="taxId-help" aria-invalid={taxIdInvalid || undefined}
          {...(onTaxIdChange ? { value: taxId, onChange: onTaxIdChange } : { defaultValue: taxId })}
          className="form-control mt-1" />
        <p id="taxId-help" className={`mt-1 text-xs ${taxIdInvalid ? "text-red-700" : "text-stone-500"}`}>
          {taxIdInvalid ? "El CUIT no es válido: revisá los 11 dígitos." : "11 dígitos, con o sin guiones."}
        </p>
      </div>
    </>
  );
}
