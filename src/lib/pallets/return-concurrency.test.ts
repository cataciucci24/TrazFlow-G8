import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "vitest";

test.skipIf(process.env.TRAZFLOW_SQL_INTEGRATION !== "1")("reingreso espera depósito antes de tomar saldos ERP frente a un armado concurrente", async () => {
  const project = /^project_id\s*=\s*"([A-Za-z0-9_.-]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
  assert.ok(project);
  const args = ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"];
  const sql = (input: string) => {
    const result = spawnSync("docker", args, { input, encoding: "utf8", timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const company = "11400000-0000-0000-0000-000000000001";
  const manager = "11400000-0000-0000-0000-000000000011";
  const batch = "11400000-0000-0000-0000-000000000031";
  const otherBatch = "11400000-0000-0000-0000-000000000032";
  const pallet = "11400000-0000-0000-0000-000000000041";
  const sessions: ReturnType<typeof session>[] = [];
  function session() {
    const child = spawn("docker", args, { stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { stderr += error.message; });
    return {
      child,
      send: (input: string) => child.stdin.write(input + "\n"),
      async waitFor(marker: string) {
        const deadline = Date.now() + 20_000;
        while (!stdout.includes(marker)) {
          assert.equal(child.exitCode, null, stderr || stdout);
          assert.ok(Date.now() < deadline, `Timeout ${marker}: ${stderr} ${stdout}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(stderr, "");
      },
    };
  }
  try {
    sql(`begin;
      insert into public.companies(id,name) values ('${company}','TRZ111 concurrency');
      insert into auth.users(id,email) values ('${manager}','trz111-concurrency@test.local');
      insert into public.users(id,company_id,name,email,role) values ('${manager}','${company}','Logística','trz111-concurrency@test.local','logistics_manager');
      insert into public.warehouses(company_id,code,name) values ('${company}','DEP-01','Central');
      insert into public.products(id,company_id,sku,name,unit_of_measure,source_system,external_id) values
        ('11400000-0000-0000-0000-000000000021','${company}','LOCK','Lock','cajas','erp','LOCK');
      insert into public.batches(id,product_id,batch_number,quantity,source_system,external_id) values
        ('${batch}','11400000-0000-0000-0000-000000000021','LOCK-1',100,'erp','LOCK-1'),
        ('${otherBatch}','11400000-0000-0000-0000-000000000021','LOCK-2',100,'erp','LOCK-2');
      insert into public.erp_stock_balances(company_id,batch_id,external_warehouse_id,warehouse_code,quantity) values
        ('${company}','${batch}','WH','DEP-01',100),('${company}','${otherBatch}','WH','DEP-01',100);
      insert into public.erp_warehouse_mappings(company_id,external_warehouse_id,warehouse_code) values ('${company}','WH','DEP-01');
      insert into public.pallets(id,company_id,batch_id,quantity,status,warehouse_code) values
        ('${pallet}','${company}','${batch}',2,'delivered','DEP-01');
      commit;`);
    const build = session(); sessions.push(build);
    build.send(`begin; set local statement_timeout='15s';
      select id from public.warehouses where company_id='${company}' and code='DEP-01' for update;
      select 'WAREHOUSE_LOCKED';`);
    await build.waitFor("WAREHOUSE_LOCKED");
    const returning = session(); sessions.push(returning);
    returning.send(`begin; set local application_name='trz111-return-lock-test'; set local statement_timeout='15s';
      set local role authenticated; select set_config('request.jwt.claim.sub','${manager}',true);
      select outcome from public.return_pallet_to_warehouse((select qr_code from public.pallets where id='${pallet}'),'Retorno concurrente');
      commit; select 'RETURN_DONE';`);
    const deadline = Date.now() + 15_000;
    while (sql("select exists(select 1 from pg_stat_activity where application_name='trz111-return-lock-test' and wait_event_type='Lock');") !== "t") {
      assert.ok(Date.now() < deadline, "El reingreso no llegó a esperar el depósito");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Regresión determinista: con el orden anterior este NOWAIT falla porque
    // el retorno ya tomó el saldo y espera nuestro depósito (ciclo de locks).
    build.send(`select batch_id from public.erp_stock_balances where company_id='${company}' order by batch_id for update nowait;
      set local role authenticated; select set_config('request.jwt.claim.sub','${manager}',true);
      select * from public.create_pallet_with_items('[{"batch_id":"${batch}","quantity":3},{"batch_id":"${otherBatch}","quantity":1}]','DEP-01');
      commit; select 'BUILD_DONE';`);
    await build.waitFor("BUILD_DONE");
    await returning.waitFor("RETURN_DONE");
    assert.equal(sql(`select status from public.pallets where id='${pallet}';`), "in_warehouse");
    assert.equal(sql(`select count(*) from public.pallets where company_id='${company}';`), "2");
    assert.equal(sql(`select count(*) from public.traceability_events where pallet_id='${pallet}' and event_type='pallet_returned';`), "1");
  } finally {
    for (const { child } of sessions) { child.stdin.end("rollback;\n\\q\n"); }
    // Solo fixtures propios, en el contenedor local; no borra datos ajenos.
    sql(`begin;
      -- Solo limpieza de fixtures locales: los triggers de inmutabilidad también protegen al superusuario.
      set local session_replication_role=replica;
      delete from public.movements where pallet_id in (select id from public.pallets where company_id='${company}');
      delete from public.traceability_events where company_id='${company}';
      set local session_replication_role=origin;
      delete from public.pallets where company_id='${company}';
      delete from public.erp_stock_balances where company_id='${company}';
      delete from public.erp_warehouse_mappings where company_id='${company}';
      delete from public.warehouses where company_id='${company}';
      delete from public.users where id='${manager}';
      delete from auth.users where id='${manager}';
      delete from public.companies where id='${company}'; commit;`);
  }
}, 90_000);
