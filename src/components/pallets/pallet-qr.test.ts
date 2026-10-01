import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { BrowserQRCodeSvgWriter } = require("@zxing/browser");
const { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, QRCodeReader } = require("@zxing/library");

// DOM mínimo para rasterizar el SVG y verificarlo con el lector del escáner.
class SvgElement {
  attrs: Record<string, string> = {};
  children: SvgElement[] = [];
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  appendChild(child: SvgElement) { this.children.push(child); }
}

test("el QR visible se decodifica al valor exacto del pallet nuevo o histórico", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElementNS: () => new SvgElement() },
  });
  try {
    for (const value of [`PAL-${randomUUID()}`, "PAL-0001"]) {
      const svg: SvgElement = new BrowserQRCodeSvgWriter().write(value, 280, 280);
      const pixels = new Uint8ClampedArray(280 * 280).fill(255);
      for (const rect of svg.children) {
        const { x, y, width, height } = rect.attrs;
        for (let row = Number(y); row < Number(y) + Number(height); row++) {
          for (let col = Number(x); col < Number(x) + Number(width); col++) {
            pixels[row * 280 + col] = 0;
          }
        }
      }
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, 280, 280)));
      assert.equal(new QRCodeReader().decode(bitmap).getText(), value);
    }
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
