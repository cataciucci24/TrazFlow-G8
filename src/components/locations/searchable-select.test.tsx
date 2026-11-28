import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { filterOptions, SearchableSelect } from "./searchable-select";
import { LocationsNavigation } from "./locations-navigation";

describe("buscador de ubicaciones", () => {
  const options = [
    { value: "1", label: "DEP-01 · Depósito Central", search: "Pasillo A" },
    { value: "2", label: "PAL-02 · Semillas", search: "SKU-42" },
  ];
  it("busca sin distinguir acentos ni mayúsculas en todos los campos", () => {
    expect(filterOptions(options, "deposito central").map((item) => item.value)).toEqual(["1"]);
    expect(filterOptions(options, "sku-42").map((item) => item.value)).toEqual(["2"]);
    expect(filterOptions(options, "pasillo A").map((item) => item.value)).toEqual(["1"]);
    expect(filterOptions(options, "inexistente")).toEqual([]);
  });
  it("conserva el valor seleccionado y el campo enviado por el formulario", () => {
    const markup = renderToStaticMarkup(<SearchableSelect label="Pallet" placeholder="Elegir" options={options} value="2" name="palletId" onChange={() => {}} />);
    expect(markup).toContain('name="palletId" value="2"');
    expect(markup).toContain("PAL-02 · Semillas");
  });
  it("muestra solo las secciones del rol", () => {
    const manager = renderToStaticMarkup(<LocationsNavigation canGenerate canMove={false} />);
    const operator = renderToStaticMarkup(<LocationsNavigation canGenerate={false} canMove />);
    expect(manager).toContain("Generar ubicaciones");
    expect(manager).toContain("Consultar pallet");
    expect(operator).not.toContain("Generar ubicaciones");
    expect(operator).toContain("Asignar o cambiar ubicación");
  });
});
