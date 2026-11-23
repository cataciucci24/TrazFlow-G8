import { runErpClientContract } from "./contract-suite";
import { MockErpClient } from "./mock-client";
import { CONTRACT_SECRETS, makeErpNextContractClient } from "../../../tests/helpers/erpnext-contract";
import { makeOdooContractClient, ODOO_CONTRACT_KEY } from "../../../tests/helpers/odoo-contract";

runErpClientContract("mock", () => new MockErpClient(), {
  errors: {
    "401": () => new MockErpClient({ scenario: "unauthorized" }),
    "403": "el mock solo simula unauthorized con HTTP 401",
    timeout: () => new MockErpClient({ scenario: "timeout" }),
    network: "el mock en memoria no simula fallos de transporte",
  },
});
runErpClientContract("erpnext", makeErpNextContractClient, {
  errors: Object.fromEntries((["401", "403", "timeout", "network"] as const).map(failure => [failure, () => makeErpNextContractClient(failure)])),
  secrets: CONTRACT_SECRETS,
});
runErpClientContract("odoo", makeOdooContractClient, {
  supports: {
    dispatch: "el adaptador actual es de solo lectura",
    stockEntry: "el adaptador actual es de solo lectura",
    palletScan: "el adaptador actual es de solo lectura",
    deliveryNotReady: "no implementa entrega ni despacho; devuelve config",
  },
  errors: Object.fromEntries((["401", "403", "timeout", "network"] as const).map(failure => [failure, () => makeOdooContractClient(failure)])),
  secrets: [ODOO_CONTRACT_KEY],
});
