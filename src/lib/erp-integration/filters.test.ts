import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIntegrationsHref, EMPTY_FILTERS, isValidDay, parseIntegrationFilters, toActivityRpcArgs, totalPages } from "./filters.ts";

const ID = "6f1c2a52-1d5e-4b55-9a0e-2a5a8c1f0b11";

test("sin parámetros no hay filtros y la página es 1", () => {
  const { filters, problems } = parseIntegrationFilters({});
  assert.deepEqual(filters, EMPTY_FILTERS);
  assert.deepEqual(problems, []);
});

test("lee estado, tipo, rango, búsqueda, páginas y evento", () => {
  const { filters, problems } = parseIntegrationFilters({
    status: "failed", kind: "dispatch_confirmed", from: "2026-10-01", to: "2026-10-15", q: "  SAL-ORD-12 ",
    page: "3", upage: "2", event: `dispatch_confirmed:${ID.toUpperCase()}`,
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(filters, {
    kind: "dispatch_confirmed", status: "failed", from: "2026-10-01", to: "2026-10-15", search: "SAL-ORD-12",
    page: 3, unreportedPage: 2, event: { kind: "dispatch_confirmed", id: ID },
  });
});

test("descarta valores inválidos y los informa", () => {
  const { filters, problems } = parseIntegrationFilters({
    status: "borrador", kind: "otro", from: "2026-02-30", to: "ayer", page: "-1", upage: "x", event: "sync:no-es-uuid",
  });
  assert.deepEqual(filters, EMPTY_FILTERS);
  assert.equal(problems.length, 5);
});

test("un rango invertido se ignora", () => {
  const { filters, problems } = parseIntegrationFilters({ from: "2026-10-15", to: "2026-10-01" });
  assert.equal(filters.from, null);
  assert.equal(filters.to, null);
  assert.match(problems[0], /posterior/);
});

test("la búsqueda se recorta a 100 caracteres y la página tiene tope", () => {
  const { filters, problems } = parseIntegrationFilters({ q: "x".repeat(150), page: "999999" });
  assert.equal(filters.search?.length, 100);
  assert.equal(filters.page, 10_000);
  assert.equal(problems.length, 1);
});

test("si un parámetro viene repetido se usa el primero", () => {
  assert.equal(parseIntegrationFilters({ status: ["sent", "failed"] }).filters.status, "sent");
});

test("valida fechas reales", () => {
  assert.equal(isValidDay("2026-10-19"), true);
  assert.equal(isValidDay("2028-02-29"), true);
  assert.equal(isValidDay("2026-02-29"), false);
  assert.equal(isValidDay("19/10/2026"), false);
});

test("el rango es por día de Argentina y el fin es exclusivo (día siguiente)", () => {
  const { filters } = parseIntegrationFilters({ from: "2026-10-01", to: "2026-10-31", page: "2" });
  assert.deepEqual(toActivityRpcArgs(filters, 20), {
    p_kind: null, p_status: null,
    p_from: "2026-10-01T00:00:00-03:00", p_to: "2026-11-01T00:00:00-03:00",
    p_search: null, p_limit: 20, p_offset: 20,
  });
});

test("los links conservan los filtros y omiten los valores por defecto", () => {
  const { filters } = parseIntegrationFilters({ status: "failed", q: "PAL 1", page: "2" });
  assert.equal(buildIntegrationsHref(EMPTY_FILTERS), "/dashboard/integrations");
  assert.equal(buildIntegrationsHref(filters), "/dashboard/integrations?status=failed&q=PAL+1&page=2");
  assert.equal(buildIntegrationsHref(filters, { page: 1 }), "/dashboard/integrations?status=failed&q=PAL+1");
  assert.equal(
    buildIntegrationsHref(filters, { event: { kind: "sync", id: ID } }),
    `/dashboard/integrations?status=failed&q=PAL+1&page=2&event=sync%3A${ID}`,
  );
  // El link de un evento se vuelve a leer igual.
  const href = new URL(buildIntegrationsHref(filters, { event: { kind: "sync", id: ID } }), "http://x");
  assert.deepEqual(parseIntegrationFilters(Object.fromEntries(href.searchParams)).filters.event, { kind: "sync", id: ID });
});

test("cantidad de páginas", () => {
  assert.equal(totalPages(0, 20), 1);
  assert.equal(totalPages(20, 20), 1);
  assert.equal(totalPages(21, 20), 2);
});
