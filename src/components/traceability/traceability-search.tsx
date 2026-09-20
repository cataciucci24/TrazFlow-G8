import Form from "next/form";

type TraceabilitySearchProps = {
  defaultQr: string;
  palletCodes: string[];
};

/** Búsqueda GET: deja el QR en la URL y no necesita una Server Action. */
export function TraceabilitySearch({ defaultQr, palletCodes }: TraceabilitySearchProps) {
  return (
    <Form
      action="/dashboard/traceability"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-2">
        <label
          htmlFor="traceability-qr"
          className="block text-sm font-semibold tracking-wide text-stone-600"
        >
          Código QR del pallet
        </label>
        <input
          id="traceability-qr"
          name="qr"
          type="text"
          defaultValue={defaultQr}
          maxLength={512}
          autoComplete="off"
          list="existing-pallet-codes"
          placeholder="PAL-001"
          className="form-control"
        />
        <datalist id="existing-pallet-codes">
          {palletCodes.map((code) => <option key={code} value={code} />)}
        </datalist>
      </div>

      <button
        type="submit"
        className="button-primary"
      >
        Buscar
      </button>
    </Form>
  );
}
