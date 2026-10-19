"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { locationQr } from "@/lib/locations/rules";
import type { WarehouseLocation } from "@/lib/locations/types";

export function LocationQr({ location }: { location: WarehouseLocation }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    import("@zxing/browser").then(({ BrowserQRCodeSvgWriter }) => {
      if (!active) return;
      const svg = new BrowserQRCodeSvgWriter().write(locationQr(location.id), 260, 260);
      svg.setAttribute("aria-label", `QR de ubicación ${location.code}`);
      svg.setAttribute("role", "img");
      ref.current?.replaceChildren(svg);
      setReady(true);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [open, location.id, location.code]);
  function print() {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    const popup = window.open("", "_blank", "width=600,height=650");
    if (!popup) { setError(true); return; }
    popup.opener = null;
    const doc = popup.document;
    doc.title = `Ubicación ${location.code}`;
    for (const value of [location.warehouse_code, location.code]) {
      const heading = doc.createElement("h1"); heading.textContent = value; doc.body.append(heading);
    }
    doc.body.append(doc.importNode(svg, true));
    const text = doc.createElement("p");
    text.textContent = `Pasillo ${location.aisle} / Estantería ${location.rack} / Nivel ${location.level} / Posición ${location.position}`;
    doc.body.append(text);
    popup.focus(); popup.print();
  }
  return <><button className="button-secondary button-sm" onClick={() => { setError(false); setReady(false); setOpen(true); }}>QR / Imprimir</button>
    <Modal open={open} onClose={() => setOpen(false)} title={`Ubicación ${location.code}`} description={location.warehouse_code}
      actions={<button className="button-primary" disabled={!ready || error} onClick={print}>Imprimir etiqueta</button>}>
      {error && <p role="alert">No se pudo generar o imprimir el QR. Permití ventanas emergentes e intentá nuevamente.</p>}
      <div ref={ref} className="mx-auto w-fit bg-white" />
      <p className="mt-3 text-sm">Pasillo {location.aisle} / Estantería {location.rack} / Nivel {location.level} / Posición {location.position}</p>
    </Modal></>;
}
