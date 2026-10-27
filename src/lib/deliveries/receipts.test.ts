import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DELIVERY_RECEIPT_MAX_BYTES,
  canAttachDeliveryReceipt,
  deliveryReceiptFileProblem,
  deliveryReceiptPath,
} from "./receipts.ts";

test("acepta fotos y PDF de hasta 10 MB", () => {
  assert.equal(deliveryReceiptFileProblem({ type: "image/jpeg", size: 1000 }), null);
  assert.equal(deliveryReceiptFileProblem({ type: "application/pdf", size: DELIVERY_RECEIPT_MAX_BYTES }), null);
  assert.equal(deliveryReceiptFileProblem({ type: "image/heic", size: 5 }), null);
  assert.equal(deliveryReceiptFileProblem({ type: "text/plain", size: 5 }), "type");
  assert.equal(deliveryReceiptFileProblem({ type: "image/png", size: DELIVERY_RECEIPT_MAX_BYTES + 1 }), "size");
  assert.equal(deliveryReceiptFileProblem({ type: "image/png", size: 0 }), "empty");
});

test("ruta {empresa}/{orden}/{id}.{ext}", () => {
  assert.equal(deliveryReceiptPath("c", "o", "f", "application/pdf"), "c/o/f.pdf");
  assert.equal(deliveryReceiptPath("c", "o", "f", "image/jpeg"), "c/o/f.jpg");
});

test("se adjunta en viaje o después de entregar", () => {
  assert.equal(canAttachDeliveryReceipt("confirmed"), true);
  assert.equal(canAttachDeliveryReceipt("delivered"), true);
  assert.equal(canAttachDeliveryReceipt("delivered_with_discrepancy"), true);
  assert.equal(canAttachDeliveryReceipt("draft"), false);
});
