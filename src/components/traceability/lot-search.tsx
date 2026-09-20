import Form from "next/form";

type LotSearchProps = {
  defaultLot: string;
  lotNumbers: string[];
};

/** Búsqueda GET: deja el lote en la URL y no necesita una Server Action. */
export function LotSearch({ defaultLot, lotNumbers }: LotSearchProps) {
  return (
    <Form
      action="/dashboard/traceability"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="view" value="lotes" />
      <div className="flex-1 space-y-2">
        <label
          htmlFor="traceability-lote"
          className="block text-sm font-semibold tracking-wide text-stone-600"
        >
          Número de lote
        </label>
        <input
          id="traceability-lote"
          name="lote"
          type="text"
          defaultValue={defaultLot}
          maxLength={512}
          autoComplete="off"
          list="existing-lot-numbers"
          placeholder="LOTE-0001"
          className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-slate-950 placeholder-stone-400 outline-none transition-all focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
        />
        <datalist id="existing-lot-numbers">
          {lotNumbers.map((number) => <option key={number} value={number} />)}
        </datalist>
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
