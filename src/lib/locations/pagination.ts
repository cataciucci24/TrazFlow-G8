const PAGE_SIZE = 500;

/** Lee todas las páginas de una consulta ordenada de forma determinista. */
export async function readLocationPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  message: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new Error(message, { cause: error });
    rows.push(...data as T[]);
    if (data.length < PAGE_SIZE) return rows;
  }
}
