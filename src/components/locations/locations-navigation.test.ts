import { describe, expect, it } from "vitest";
import { activeSectionFromPositions } from "./locations-navigation";

describe("sección activa al desplazarse", () => {
  const sections = [{ id: "crear", top: -400 }, { id: "generar", top: 80 }, { id: "consultar", top: 500 }, { id: "disponibles", top: 900 }];
  it("utiliza el borde inferior real de la barra fija", () => {
    expect(activeSectionFromPositions(sections, 90, false)).toBe("generar");
    expect(activeSectionFromPositions(sections, 60, false)).toBe("crear");
  });
  it("selecciona la última sección al llegar al final, aunque no llegue a la barra", () => {
    expect(activeSectionFromPositions(sections, 90, true)).toBe("disponibles");
  });
});
