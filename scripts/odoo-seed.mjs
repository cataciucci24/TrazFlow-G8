#!/usr/bin/env node
/**
 * Seed idempotente de Odoo 19 para probar el adaptador de TrazFlow (TRZ-113). Usa solo la API JSON-RPC.
 *
 *   ODOO_URL=http://localhost:8069 ODOO_DB=trazflow ODOO_USER=admin ODOO_PASSWORD=admin node scripts/odoo-seed.mjs
 *
 * Instala Inventario (stock) y Fechas de vencimiento (product_expiry) si faltan, activa Lotes y números de serie y
 * deja: 2 depósitos, 5 productos con seguimiento por lote (4 en "Units" y 1 en "kg"), 2–3 lotes por producto con
 * vencimiento y stock en los dos depósitos. Busca cada registro por su clave (código del depósito, default_code,
 * lote + producto) y fija cantidades absolutas, así que correrlo de nuevo no duplica nada. Ver docs/odoo-deploy.md.
 */

const URL_BASE = (process.env.ODOO_URL ?? "http://localhost:8069").replace(/\/+$/, "");
const DB = process.env.ODOO_DB ?? "trazflow";
const USER = process.env.ODOO_USER ?? "admin";
const PASSWORD = process.env.ODOO_PASSWORD ?? "admin";

const WAREHOUSES = [
  // El depósito que crea Odoo al instalar Inventario (código WH) pasa a ser el Central.
  { code: "WH", name: "Depósito Central" },
  { code: "NOR", name: "Depósito Norte" },
];

/** Vencimientos en fecha argentina: se guardan a las 03:00 UTC (00:00 en -03:00). */
const PRODUCTS = [
  {
    code: "ACE-500", name: "Aceite de girasol 500 ml", uom: "product_uom_unit",
    lots: [
      { name: "L-2026-0915", expires: "2027-03-31", stock: { WH: 120, NOR: 30 } },
      { name: "L-2026-0921", expires: "2027-04-15", stock: { WH: 80 } },
    ],
  },
  {
    code: "ARR-1KG", name: "Arroz largo fino 1 kg", uom: "product_uom_unit",
    lots: [
      { name: "ARR-2026-10A", expires: "2027-10-01", stock: { WH: 200 } },
      { name: "ARR-2026-10B", expires: "2027-11-15", stock: { NOR: 60 } },
    ],
  },
  {
    code: "YER-500", name: "Yerba mate 500 g", uom: "product_uom_unit",
    lots: [
      { name: "YER-2026-08", expires: "2028-02-28", stock: { WH: 150 } },
      { name: "YER-2026-09", expires: "2028-03-31", stock: { WH: 40, NOR: 45 } },
      { name: "YER-2026-10", expires: "2028-04-30", stock: { NOR: 90 } },
    ],
  },
  {
    code: "LEC-1L", name: "Leche entera 1 L", uom: "product_uom_unit",
    lots: [
      { name: "LEC-2026-1101", expires: "2026-12-20", stock: { WH: 300 } },
      { name: "LEC-2026-1115", expires: "2027-01-05", stock: { NOR: 120 } },
    ],
  },
  {
    code: "QUE-CREM", name: "Queso cremoso (horma)", uom: "product_uom_kgm",
    lots: [
      { name: "QUE-2026-1020", expires: "2027-01-20", stock: { WH: 356.5 } },
      { name: "QUE-2026-1105", expires: "2027-02-05", stock: { WH: 80, NOR: 42.25 } },
    ],
  },
];

let requestId = 0;
let uid = 0;

async function rpc(service, method, args) {
  const response = await fetch(`${URL_BASE}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: ++requestId }),
  });
  if (!response.ok) throw new Error(`Odoo respondió ${response.status} en ${service}.${method}`);
  const body = await response.json();
  if (body.error) throw new Error(`${service}.${method}: ${body.error.data?.message ?? body.error.message}`);
  return body.result;
}

function execute(model, method, args = [], kwargs = {}) {
  return rpc("object", "execute_kw", [DB, uid, PASSWORD, model, method, args, kwargs]);
}

async function searchOne(model, domain, fields = ["id"], context = {}) {
  const [row] = await execute(model, "search_read", [domain], { fields, limit: 1, context });
  return row ?? null;
}

async function xmlId(module, name) {
  const row = await searchOne("ir.model.data", [["module", "=", module], ["name", "=", name]], ["res_id"]);
  if (!row) throw new Error(`No existe ${module}.${name}`);
  return row.res_id;
}

async function ensureModules(names) {
  const modules = await execute("ir.module.module", "search_read", [[["name", "in", names]]], { fields: ["name", "state"] });
  const missing = modules.filter((addon) => addon.state !== "installed");
  for (const addon of missing) {
    console.log(`Instalando ${addon.name}…`);
    await execute("ir.module.module", "button_immediate_install", [[addon.id]]);
  }
}

async function ensureLotSettings() {
  const settings = await execute("res.config.settings", "create", [{ group_stock_production_lot: true, module_product_expiry: true }]);
  await execute("res.config.settings", "execute", [[settings]]);
}

async function ensureWarehouse({ code, name }) {
  const existing = await searchOne("stock.warehouse", [["code", "=", code]], ["id", "name", "lot_stock_id"], { active_test: false });
  if (existing) {
    if (existing.name !== name) await execute("stock.warehouse", "write", [[existing.id], { name }]);
    return { id: existing.id, stockLocationId: existing.lot_stock_id[0] };
  }
  const id = await execute("stock.warehouse", "create", [{ code, name }]);
  const created = await searchOne("stock.warehouse", [["id", "=", id]], ["lot_stock_id"]);
  return { id, stockLocationId: created.lot_stock_id[0] };
}

async function ensureProduct({ code, name, uom }) {
  const values = {
    name,
    default_code: code,
    type: "consu",
    is_storable: true,
    tracking: "lot",
    use_expiration_date: true,
    uom_id: await xmlId("uom", uom),
  };
  const existing = await searchOne("product.product", [["default_code", "=", code]], ["id"], { active_test: false });
  if (existing) {
    await execute("product.product", "write", [[existing.id], { ...values, active: true }]);
    return existing.id;
  }
  return execute("product.product", "create", [values]);
}

async function ensureLot(productId, { name, expires }) {
  const expiration_date = `${expires} 03:00:00`;
  const existing = await searchOne("stock.lot", [["name", "=", name], ["product_id", "=", productId]], ["id", "expiration_date"]);
  if (existing) {
    if (existing.expiration_date !== expiration_date) await execute("stock.lot", "write", [[existing.id], { expiration_date }]);
    return existing.id;
  }
  return execute("stock.lot", "create", [{ name, product_id: productId, expiration_date }]);
}

/** Ajuste de inventario a una cantidad absoluta en la ubicación de stock del depósito. */
async function ensureQuantity(productId, lotId, locationId, quantity) {
  const context = { inventory_mode: true };
  const existing = await searchOne(
    "stock.quant",
    [["product_id", "=", productId], ["lot_id", "=", lotId], ["location_id", "=", locationId]],
    ["id", "quantity"],
  );
  if (existing && existing.quantity === quantity) return false;
  const quantId = existing
    ? (await execute("stock.quant", "write", [[existing.id], { inventory_quantity: quantity }], { context }), existing.id)
    : await execute("stock.quant", "create", [{ product_id: productId, lot_id: lotId, location_id: locationId, inventory_quantity: quantity }], { context });
  await execute("stock.quant", "action_apply_inventory", [[quantId]], { context });
  return true;
}

async function main() {
  uid = await rpc("common", "authenticate", [DB, USER, PASSWORD, {}]);
  if (!uid) throw new Error(`Odoo no acepta ${USER} en la base ${DB}.`);

  await ensureModules(["stock", "product_expiry"]);
  await ensureLotSettings();

  const warehouses = {};
  for (const warehouse of WAREHOUSES) warehouses[warehouse.code] = await ensureWarehouse(warehouse);

  let adjusted = 0;
  let lots = 0;
  for (const product of PRODUCTS) {
    const productId = await ensureProduct(product);
    for (const lot of product.lots) {
      const lotId = await ensureLot(productId, lot);
      lots += 1;
      for (const [code, quantity] of Object.entries(lot.stock)) {
        if (await ensureQuantity(productId, lotId, warehouses[code].stockLocationId, quantity)) adjusted += 1;
      }
    }
  }

  console.log(`Odoo listo: ${WAREHOUSES.length} depósitos, ${PRODUCTS.length} productos, ${lots} lotes, ${adjusted} saldos ajustados.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
