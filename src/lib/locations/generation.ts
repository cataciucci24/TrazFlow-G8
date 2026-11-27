export const MAX_GENERATED_LOCATIONS = 2000;

/** Readable codes where possible; deterministic bounded codes for long inputs. */
export function generatedLocationCode(warehouseCode: string, coordinates: readonly string[]): string {
  const readable = `G-${warehouseCode}-${coordinates.join("-")}`;
  if (readable.length <= 40) return readable;
  function hash(seed: number): string {
    let value = seed;
    for (let index = 0; index < readable.length; index++) value = Math.imul(value ^ readable.charCodeAt(index), 16777619);
    return (value >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }
  return `G-${warehouseCode.slice(0, 18)}-${hash(2166136261)}${hash(2246822519)}`;
}

/** Expand a single range without allocating an unbounded array. */
export function expandLocationRange(startInput: string, endInput: string): string[] | null {
  const start = startInput.trim().toUpperCase();
  const end = endInput.trim().toUpperCase();
  if (/^[A-Z]$/.test(start) && /^[A-Z]$/.test(end)) {
    const first = start.charCodeAt(0);
    const last = end.charCodeAt(0);
    if (last < first) return null;
    return Array.from({ length: last - first + 1 }, (_, index) => String.fromCharCode(first + index));
  }
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) return null;
  if (start.length > 40 || end.length > 40) return null;
  const first = Number(start);
  const last = Number(end);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first || last - first + 1 > MAX_GENERATED_LOCATIONS) return null;
  const width = Math.max(start.length, end.length);
  return Array.from({ length: last - first + 1 }, (_, index) => String(first + index).padStart(width, "0"));
}

export function locationCombinations(ranges: readonly string[][]): string[][] | null {
  if (ranges.length < 1 || ranges.length > 4 || ranges.some((range) => range.length === 0)) return null;
  let count = 1;
  for (const range of ranges) {
    count *= range.length;
    if (count > MAX_GENERATED_LOCATIONS) return null;
  }
  return ranges.reduce<string[][]>((rows, values) => rows.flatMap((row) => values.map((value) => [...row, value])), [[]]);
}
