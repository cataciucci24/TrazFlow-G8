"use client";

import { useEffect, useRef } from "react";

/** QR del remito: abre la orden (su detalle y trazabilidad) en TrazFlow. La URL usa el dominio actual. */
export function DispatchNoteQr({ path, label }: { path: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    async function render() {
      const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
      if (!active) return;
      const svg = new BrowserQRCodeSvgWriter().write(`${window.location.origin}${path}`, 220, 220);
      // El SVG viene con ancho y alto fijos: que ocupe el contenedor, así se adapta a cualquier pantalla y zoom.
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("viewBox", svg.getAttribute("viewBox") ?? "0 0 220 220");
      svg.setAttribute("class", "block h-full w-full");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", label);
      ref.current?.replaceChildren(svg);
    }
    void render();
    return () => { active = false; };
  }, [path, label]);
  return <div ref={ref} className="aspect-square w-24 shrink-0 overflow-hidden sm:w-28" />;
}

export function PrintDispatchNoteButton() {
  return <button type="button" className="button-primary no-print" onClick={() => window.print()}>Imprimir o guardar PDF</button>;
}
