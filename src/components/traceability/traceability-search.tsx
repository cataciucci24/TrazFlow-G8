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
          className="block text-sm font-semibold tracking-wide text-white"
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
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 outline-none transition-all focus:border-red-500 focus:ring-2 focus:ring-red-950/20"
        />
      </div>

      <button
        type="submit"
        className="rounded-xl bg-[#3d0c11] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-[#2b080c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-950 active:scale-[0.99]"
      >
        Buscar
      </button>
    </Form>
  );
}
