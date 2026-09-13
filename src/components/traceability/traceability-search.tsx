import Form from "next/form";

type TraceabilitySearchProps = {
  defaultQr: string;
};

/** Búsqueda GET: deja el QR en la URL y no necesita una Server Action. */
export function TraceabilitySearch({ defaultQr }: TraceabilitySearchProps) {
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
          placeholder="PAL-001"
          className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-slate-950 placeholder-stone-400 outline-none transition-all focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
        />
      </div>

      <button
        type="submit"
        className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-amber-600"
      >
        Buscar
      </button>
    </Form>
  );
}
