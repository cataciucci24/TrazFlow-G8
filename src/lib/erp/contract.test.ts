import { test } from "vitest";
import { runErpClientContract } from "./contract-suite";
import { MockErpClient } from "./mock-client";
import { CONTRACT_SECRETS, makeErpNextContractClient } from "../../../tests/helpers/erpnext-contract";

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
test.todo("contrato ERP: odoo — pendiente de TRZ-113; registrar su fábrica y capacidades cuando exista el adaptador");
