"""
Datos de prueba para el ERPNext de la demo (VM de Oracle). Replica src/lib/erp/fixtures.ts para que la
sincronización con ERPNext se vea igual que con el mock y encaje con lo que ya hay en la nube:
- Abreviatura de la empresa SRV (los depósitos de la nube están vinculados a "Depósito Central - SRV" y
  "Depósito Norte - SRV"). Se elige en el Setup Wizard; el script solo la verifica.
- Mismos productos, lotes y stock.
- Órdenes de venta nuevas con la numeración de ERPNext (no se reusan SAL-ORD-2026-00012..15, que la nube ya
  tiene y en parte entregó).

Idempotente: lo que ya existe no se vuelve a crear. Se corre dentro del contenedor backend (ver
docs/erpnext-deploy.md).
"""

import frappe

ABBR = "SRV"
TAG = "TrazFlow demo"

WAREHOUSES = ["Depósito Central", "Depósito Norte"]

UOMS = {"Caja": 1, "Kg": 0, "Unidad": 1}  # nombre: must_be_whole_number

ITEMS = [
    ("ACE-500", "Aceite de girasol 500 ml", "Caja", False),
    ("ARR-1KG", "Arroz largo fino 1 kg", "Caja", False),
    ("QSO-HORMA", "Queso en horma", "Kg", False),
    ("SAL-FINA", "Sal fina 500 g", "Unidad", True),  # inactivo, como en el mock
]

BATCHES = [
    ("L-2026-0915", "ACE-500", "2026-09-15", "2027-03-31"),
    ("L-2026-0921", "ACE-500", "2026-09-21", "2027-04-15"),
    ("ARR-2026-08", "ARR-1KG", "2026-08-01", "2027-08-01"),
    ("ARR-2026-10", "ARR-1KG", "2026-10-01", "2027-10-01"),
    ("QSO-2026-1003", "QSO-HORMA", "2026-10-03", "2026-12-03"),
]

# (item, lote, depósito, cantidad)
STOCK = [
    ("ACE-500", "L-2026-0915", "Depósito Central", 120),
    ("ACE-500", "L-2026-0921", "Depósito Central", 80),
    ("ARR-1KG", "ARR-2026-08", "Depósito Central", 200),
    ("ARR-1KG", "ARR-2026-10", "Depósito Central", 150),
    ("QSO-HORMA", "QSO-2026-1003", "Depósito Central", 356.5),
    ("ACE-500", "L-2026-0921", "Depósito Norte", 30),
]

# id (= customer.externalId en la nube) y nombre visible, como en el mock.
CUSTOMERS = [("CUST-NORTE", "Distribuidora Norte"), ("CUST-SUR", "Almacén del Sur")]

# Las mismas órdenes pendientes del mock. po_no las identifica para no duplicarlas.
ORDERS = [
    ("TRZ-DEMO-1", "CUST-NORTE", "2026-11-03", [("ACE-500", 65), ("ARR-1KG", 40)]),
    ("TRZ-DEMO-2", "CUST-SUR", "2026-11-04", [("QSO-HORMA", 48.25)]),
    ("TRZ-DEMO-3", "CUST-NORTE", "2026-11-04", [("ARR-1KG", 200)]),  # saldo exacto de ARR-2026-08
    ("TRZ-DEMO-4", "CUST-SUR", "2026-11-04", [("ARR-1KG", 150)]),  # saldo exacto de ARR-2026-10
]

RATE = 1000  # precio y valuación fijos: la demo no usa importes


def log(message):
    print(f"[seed] {message}")


def child_of_root(doctype, parent_field, name):
    """Crea (si falta) un nodo hoja con `name` bajo la raíz del árbol."""
    if frappe.db.exists(doctype, name):
        return name
    root = frappe.get_all(doctype, filters={"is_group": 1, parent_field: ["is", "not set"]}, pluck="name")[0]
    frappe.get_doc({"doctype": doctype, doctype.lower().replace(" ", "_") + "_name": name, parent_field: root, "is_group": 0}).insert()
    log(f"{doctype} {name}")
    return name


def company():
    companies = frappe.get_all("Company", fields=["name", "abbr"])
    if len(companies) != 1:
        frappe.throw(f"Se esperaba una sola empresa y hay {len(companies)}")
    name, abbr = companies[0].name, companies[0].abbr
    if abbr != ABBR:
        # ERPNext v16 no permite cambiar la abreviatura: hay que recrear el sitio y elegir SRV en el wizard.
        frappe.throw(f"La empresa {name} tiene abreviatura {abbr}; tiene que ser {ABBR}")
    # El plan de cuentas de Argentina no trae cuenta de inventario y el inventario perpetuo la exige en cada
    # depósito. La demo no usa contabilidad: se desactiva.
    if frappe.db.get_value("Company", name, "enable_perpetual_inventory"):
        frappe.db.set_value("Company", name, "enable_perpetual_inventory", 0)
        log(f"inventario perpetuo desactivado en {name}")
    return name


def run():
    log(f"zona horaria: {frappe.db.get_single_value('System Settings', 'time_zone')}")
    comp = company()

    # En v16 los lotes vienen apagados: sin esto un Item no puede tener has_batch_no.
    if not frappe.db.get_single_value("Stock Settings", "enable_serial_and_batch_no_for_item"):
        frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
        log("lotes activados en Stock Settings")

    root_wh = frappe.get_all("Warehouse", filters={"company": comp, "is_group": 1, "parent_warehouse": ["is", "not set"]}, pluck="name")[0]
    for wh in WAREHOUSES:
        if not frappe.db.exists("Warehouse", f"{wh} - {ABBR}"):
            frappe.get_doc({"doctype": "Warehouse", "warehouse_name": wh, "company": comp, "parent_warehouse": root_wh, "is_group": 0}).insert()
            log(f"depósito {wh} - {ABBR}")

    # Los depósitos que crea el wizard ("Sucursales - SRV", etc.) no se usan y se borran: TrazFlow importa también
    # los deshabilitados (como inactivos) y la sincronización nunca borra. Solo si están vacíos.
    central = f"{WAREHOUSES[0]} - {ABBR}"
    keep = {f"{wh} - {ABBR}" for wh in WAREHOUSES}
    if frappe.db.get_value("Company", comp, "default_warehouse") not in keep:
        frappe.db.set_value("Company", comp, "default_warehouse", central)
        log(f"depósito por defecto de {comp}: {central}")
    for wh in frappe.get_all("Warehouse", filters={"company": comp, "is_group": 0}, pluck="name"):
        if wh not in keep and not frappe.db.exists("Stock Ledger Entry", {"warehouse": wh}):
            frappe.delete_doc("Warehouse", wh)
            log(f"depósito {wh} borrado")

    for uom, whole in UOMS.items():
        if not frappe.db.exists("UOM", uom):
            frappe.get_doc({"doctype": "UOM", "uom_name": uom, "must_be_whole_number": whole}).insert()
            log(f"UOM {uom}")

    item_group = child_of_root("Item Group", "parent_item_group", TAG)
    for code, name, uom, disabled in ITEMS:
        if not frappe.db.exists("Item", code):
            frappe.get_doc({
                "doctype": "Item", "item_code": code, "item_name": name, "item_group": item_group,
                "stock_uom": uom, "is_stock_item": 1, "has_batch_no": 1, "has_expiry_date": 1,
                "valuation_rate": RATE, "disabled": 0,
            }).insert()
            log(f"producto {code}")

    for batch_id, item, mfg, exp in BATCHES:
        if not frappe.db.exists("Batch", batch_id):
            frappe.get_doc({"doctype": "Batch", "batch_id": batch_id, "item": item, "manufacturing_date": mfg, "expiry_date": exp}).insert()
            log(f"lote {batch_id}")

    if not frappe.db.exists("Stock Entry", {"remarks": TAG, "docstatus": 1}):
        entry = frappe.get_doc({
            "doctype": "Stock Entry", "stock_entry_type": "Material Receipt", "company": comp, "remarks": TAG,
            "items": [
                {"item_code": item, "qty": qty, "t_warehouse": f"{wh} - {ABBR}", "batch_no": batch,
                 "use_serial_batch_fields": 1, "basic_rate": RATE, "allow_zero_valuation_rate": 0}
                for item, batch, wh, qty in STOCK
            ],
        })
        entry.insert()
        entry.submit()
        log(f"stock inicial {entry.name}")

    # SAL-FINA se deshabilita al final: un producto deshabilitado no admite movimientos.
    for code, _, _, disabled in ITEMS:
        if disabled and not frappe.db.get_value("Item", code, "disabled"):
            frappe.db.set_value("Item", code, "disabled", 1)
            log(f"producto {code} deshabilitado")

    customer_group = child_of_root("Customer Group", "parent_customer_group", TAG)
    territory = child_of_root("Territory", "parent_territory", TAG)
    for customer_id, customer_name in CUSTOMERS:
        if frappe.db.exists("Customer", customer_id):
            continue
        if frappe.db.exists("Customer", customer_name):
            # Versión anterior del script: el cliente quedó con el nombre como id. Se renombra (sus órdenes también).
            frappe.rename_doc("Customer", customer_name, customer_id, force=True)
            log(f"cliente {customer_name} renombrado a {customer_id}")
            continue
        frappe.get_doc({"doctype": "Customer", "customer_name": customer_name, "customer_type": "Company",
                        "customer_group": customer_group, "territory": territory}).insert(set_name=customer_id)
        log(f"cliente {customer_id} ({customer_name})")

    for po_no, customer, delivery, lines in ORDERS:
        if frappe.db.exists("Sales Order", {"po_no": po_no, "docstatus": ["<", 2]}):
            continue
        order = frappe.get_doc({
            "doctype": "Sales Order", "company": comp, "customer": customer, "po_no": po_no,
            "transaction_date": frappe.utils.today(), "delivery_date": delivery,
            "set_warehouse": f"Depósito Central - {ABBR}",
            "items": [{"item_code": item, "qty": qty, "rate": RATE, "delivery_date": delivery,
                       "warehouse": f"Depósito Central - {ABBR}"} for item, qty in lines],
        })
        order.insert()
        order.submit()
        log(f"orden {order.name} ({po_no}, {customer})")

    frappe.db.commit()
    log("listo")


if __name__ == "__main__":
    import sys

    frappe.init(site=sys.argv[1], sites_path=".")
    frappe.connect()
    try:
        frappe.set_user("Administrator")
        run()
    except Exception:
        frappe.db.rollback()
        raise
    finally:
        frappe.destroy()
