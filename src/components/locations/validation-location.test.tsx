import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ValidationLocation } from "./validation-location";

describe("ubicación en validación de carga", () => {
  const layouts = { EST: [{ label: "Pasillo" }, { label: "Estantería" }, { label: "Nivel" }, { label: "Posición" }], PISO: [{ label: "Sector" }, { label: "Hilera" }, { label: "Posición" }] };
  it("muestra la referencia y las cuatro etiquetas de un depósito de estanterías", () => {
    const html = renderToStaticMarkup(<ValidationLocation layouts={layouts} location={{ warehouseCode: "EST", code: "E01", aisle: "A", rack: "01", level: "02", position: "03" }} />);
    expect(html).toContain("EST / E01");
    expect(html).toContain("Pasillo A / Estantería 01 / Nivel 02 / Posición 03");
  });
  it("usa las etiquetas del depósito de piso sin mostrar coordenadas NULL", () => {
    const html = renderToStaticMarkup(<ValidationLocation layouts={layouts} location={{ warehouseCode: "PISO", code: "P01", aisle: "B", rack: "02", level: "03", position: null }} />);
    expect(html).toContain("PISO / P01");
    expect(html).toContain("Sector B / Hilera 02 / Posición 03");
    expect(html).not.toContain("null");
  });
  it("conserva la referencia si falta el layout y muestra Sin ubicación cuando corresponde", () => {
    const missingLayout = renderToStaticMarkup(<ValidationLocation layouts={{}} location={{ warehouseCode: "OTRO", code: "A1", aisle: "A", rack: null, level: null, position: null }} />);
    expect(missingLayout).toContain("OTRO / A1");
    expect(missingLayout).not.toContain("Pasillo");
    expect(renderToStaticMarkup(<ValidationLocation layouts={layouts} location={null} />)).toContain("Sin ubicación");
  });
});
