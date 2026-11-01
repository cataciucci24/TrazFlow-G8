import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanChange } from "./change.ts";
const valid = () => {
 const form = new FormData();
 for (const [key,value] of Object.entries({targetCode:"growth",expectedCode:"starter",assignedAt:"2026-10-01T00:00:00.000001+00:00",requestId:"10000000-0000-4000-8000-000000000001",confirmed:"on"})) form.set(key,value);
 return form;
};
test("conserva versión exacta e identificador; no acepta empresa", () => {
 const form=valid(); form.set("companyId","otra empresa");
 assert.deepEqual(parsePlanChange(form),{p_target_code:"growth",p_expected_code:"starter",p_expected_assigned_at:"2026-10-01T00:00:00.000001+00:00",p_request_id:"10000000-0000-4000-8000-000000000001",p_confirmed:true});
});
test("rechaza ausencia de confirmación y campos inválidos", () => {
 for(const [key,value] of [["confirmed",""],["targetCode"," "],["expectedCode",""],["assignedAt","bad"],["requestId","bad"]]) {
  const form=valid(); form.set(key,value); assert.equal(parsePlanChange(form),null);
 }
});
