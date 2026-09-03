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
      <div className="flex-1 space-y-1">
        <label
          htmlFor="traceability-qr"
          className="block text-sm font-medium text-gray-700"
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
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        />
      </div>

      <button
        type="submit"
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
      >
        Buscar
      </button>
    </Form>
  );
}
