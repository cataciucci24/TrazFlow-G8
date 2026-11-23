/** UTF-8 si el archivo es válido; si no, Windows-1252, que es como guarda Excel en español. */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Excel en español separa con punto y coma: se elige el separador más usado en la primera línea. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find(line => line.trim()) ?? "";
  return firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
}

/** RFC 4180: comillas dobles, comillas escapadas y saltos de línea dentro de un campo. */
export function parseCsv(text: string): { rowNumber: number; cells: string[] }[] {
  const delimiter = detectDelimiter(text);
  const rows: { rowNumber: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = "", quoted = false, closedQuote = false, line = 1, rowNumber = 1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else { if (char === "\n") line++; cell += char; }
    } else if (char === '"') {
      if (cell || closedQuote) throw new SyntaxError("Comillas CSV inválidas.");
      quoted = true;
    }
    else if (char === delimiter) { cells.push(cell); cell = ""; closedQuote = false; }
    else if (char === "\n") {
      cells.push(cell.replace(/\r$/, ""));
      rows.push({ rowNumber, cells });
      cells = []; cell = ""; closedQuote = false; line++; rowNumber = line;
    } else if (closedQuote) {
      if (char !== "\r" || (index + 1 < text.length && text[index + 1] !== "\n"))
        throw new SyntaxError("Texto después de cerrar comillas CSV.");
    } else cell += char;
  }
  if (quoted) throw new SyntaxError("Comillas CSV sin cerrar.");
  if (cell || cells.length || closedQuote) { cells.push(cell.replace(/\r$/, "")); rows.push({ rowNumber, cells }); }
  return rows;
}
