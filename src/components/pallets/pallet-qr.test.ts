import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { locationQr } from "../../lib/locations/rules.ts";

const require = createRequire(import.meta.url);
const { BrowserQRCodeSvgWriter } = require("@zxing/browser");
const { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, QRCodeReader, DecodeHintType } = require("@zxing/library");

// DOM mínimo para rasterizar el SVG y verificarlo con el lector del escáner.
class SvgElement {
  attrs: Record<string, string> = {};
  children: SvgElement[] = [];
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  appendChild(child: SvgElement) { this.children.push(child); }
}

test("el SVG QR generado conserva el código de pallet o ubicación en ambos tamaños", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElementNS: () => new SvgElement() },
  });
  try {
    // Fixed payloads include the detector failures that made this test flaky.
    const values = [
      "PAL-0001",
      "PAL-43fc61dc-3737-41df-ae95-0579597726e4", // ChecksumException at 260 and 280 px.
      "PAL-2f2407a4-4a5f-4027-a5b9-d5135c82ef6c", // NotFoundException.
      locationQr("7b7212a9-9f9d-4fff-97a6-ad0d398bcc7b"), // FormatException.
      locationQr("00000000-0000-4000-8000-000000000000"),
    ];
    // This image is one isolated, axis-aligned QR. Test its actual payload and
    // checksum without the camera detector's heuristic search for finder points.
    // Do not apply PURE_BARCODE to the scanner: real camera frames need detection.
    const hints = new Map([[DecodeHintType.PURE_BARCODE, true]]);
    for (const value of values) {
      for (const size of [260, 280]) {
        const svg: SvgElement = new BrowserQRCodeSvgWriter().write(value, size, size);
        const pixels = new Uint8ClampedArray(size * size).fill(255);
        for (const rect of svg.children) {
          const { x, y, width, height } = rect.attrs;
          for (let row = Number(y); row < Number(y) + Number(height); row++) {
            for (let col = Number(x); col < Number(x) + Number(width); col++) {
              pixels[row * size + col] = 0;
            }
          }
        }
        const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, size, size)));
        assert.equal(new QRCodeReader().decode(bitmap, hints).getText(), value, `${value} at ${size}px`);
      }
    }
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
