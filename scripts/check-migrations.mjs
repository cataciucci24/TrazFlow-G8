import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = process.argv[2] ?? fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const files = readdirSync(directory).filter(name => name.endsWith(".sql"));
const versions = new Map();
const errors = [];
for (const name of files) {
  const version = /^(\d+)_.+\.sql$/.exec(name)?.[1];
  if (!version) { errors.push(`Nombre inválido: ${name}`); continue; }
  if (versions.has(version)) errors.push(`Versión duplicada ${version}: ${versions.get(version)} y ${name}`);
  else versions.set(version, name);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`Migraciones: ${files.length} archivos, versiones únicas.`);
