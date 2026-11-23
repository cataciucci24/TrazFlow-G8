// Solo Supabase local en Docker; no recibe URLs ni credenciales de la nube.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const project = /^project_id\s*=\s*"([A-Za-z0-9_.-]+)"/m.exec(config)?.[1];
if (!project) throw new Error("No se pudo identificar el proyecto Supabase local.");
const container = `supabase_db_${project}`;
let passed = 0;
let failed = 0;
for (const name of readdirSync(join(root, "supabase/tests")).filter(name => name.endsWith(".sql")).sort()) {
  if (/_cloud_state_(checks|fixture)\.sql$/.test(name)) {
    console.log(`EXCLUIDO ${name}: requiere la réplica histórica indicada en su encabezado.`);
    continue;
  }
  const sql = readFileSync(join(root, "supabase/tests", name), "utf8");
  if (!/^\s*rollback\s*;/im.test(sql)) throw new Error(`${name}: falta rollback; no se ejecutará automáticamente.`);
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-o", "/dev/null"], { input: sql, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 0) { passed++; console.log(`OK ${name}`); }
  else { failed++; console.error(`FALLÓ ${name}\n${result.stderr}`); }
}
console.log(`SQL local: ${passed} aprobadas, ${failed} fallidas.`);
if (failed) process.exitCode = 1;
