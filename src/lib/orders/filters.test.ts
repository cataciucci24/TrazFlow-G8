import { expect, test } from "vitest";
import { applyOrderFilters, readOrderFilters } from "./filters";

const id = "10000000-0000-4000-8000-000000000001";
test("normaliza UUID en mayúsculas para conservar la selección de distribuidora", () => {
  expect(readOrderFilters({ distributor: "ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB" }).distributor)
    .toBe("abcdefab-cdef-abcd-efab-cdefabcdefab");
});

test("un filtro inválido no borra el otro filtro válido", () => {
  expect(readOrderFilters({ status: "constructor", distributor: id })).toEqual({ status: "", distributor: id });
  expect(readOrderFilters({ status: "draft", distributor: "eq.otra-empresa" })).toEqual({ status: "draft", distributor: "" });
});
test.each(["draft", "validating", "has_discrepancy", "confirmed", "delivered", "delivered_with_discrepancy"])("acepta el estado %s", status => {
  expect(readOrderFilters({ status, distributor: id })).toEqual({ status, distributor: id });
});
test.each([{}, { status: "__proto__", distributor: "otra-empresa" }, { status: ["draft", "confirmed"], distributor: [id] }])("ignora filtros inválidos o ambiguos: %j", params => {
  expect(readOrderFilters(params)).toEqual({ status: "", distributor: "" });
});
test("combina filtros con AND sin quitar el alcance de empresa de la consulta", () => {
  const calls: string[][] = [];
  const query = { eq(column: string, value: string) { calls.push([column, value]); return this; } };
  applyOrderFilters(query.eq("company_id", "mi-empresa"), { status: "confirmed", distributor: id });
  expect(calls).toEqual([["company_id", "mi-empresa"], ["status", "confirmed"], ["distributor_id", id]]);
  calls.length = 0;
  applyOrderFilters(query, { status: "", distributor: "" });
  expect(calls).toEqual([]);
});
