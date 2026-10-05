import type { ChangeEventHandler } from "react";
import { requestedRoles, type RegistrationCompany } from "@/lib/registration/options";

type Props = {
  companies: RegistrationCompany[];
  companyId: string;
  role: string;
  onCompanyChange?: ChangeEventHandler<HTMLSelectElement>;
  onRoleChange?: ChangeEventHandler<HTMLSelectElement>;
};

export function RegistrationFields({ companies, companyId, role, onCompanyChange, onRoleChange }: Props) {
  return (
    <>
      <div>
        <label htmlFor="company" className="block text-sm font-semibold text-stone-600">Empresa</label>
        <select id="company" name={onCompanyChange ? undefined : "companyId"} required
          {...(onCompanyChange ? { value: companyId, onChange: onCompanyChange } : { defaultValue: companyId })}
          className="form-control mt-1">
          <option value="">Elegí tu empresa</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="role" className="block text-sm font-semibold text-stone-600">Rol que solicitás</label>
        <select id="role" name={onRoleChange ? undefined : "role"} required
          {...(onRoleChange ? { value: role, onChange: onRoleChange } : { defaultValue: role })}
          className="form-control mt-1">
          <option value="">Elegí un rol</option>
          {Object.entries(requestedRoles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </>
  );
}
