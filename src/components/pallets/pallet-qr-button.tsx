"use client";

import { useEffect, useRef, useState } from "react";

import { InlineAlert, LoadingState } from "@/components/ui/design-system";
import { Modal } from "@/components/ui/modal";
import { palletLabelContent } from "@/lib/pallet-labels/selection";
import type { Pallet } from "@/lib/types";

/** Botón que muestra el QR y descarga la misma información que contiene la etiqueta impresa. */
export function PalletQrButton({ pallet, variant = "default" }: { pallet: Pallet; variant?: "default" | "compact" | "icon" }) {
  const { qrCode } = pallet;
  const [open, setOpen] = useState(false);
  const showQr = () => setOpen(true);

  return <>
    {variant === "icon" ? (
      <button type="button" className="button-secondary button-icon" onClick={showQr} aria-label={`Ver QR del pallet ${qrCode}`} title="Ver QR">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
          <rect x="3.5" y="3.5" width="6" height="6" rx="1" /><rect x="14.5" y="3.5" width="6" height="6" rx="1" /><rect x="3.5" y="14.5" width="6" height="6" rx="1" />
          <path d="M14.5 14.5h2.5v2.5h-2.5zM18 18h2.5v2.5H18zM14.5 20.5H17M20.5 14.5V17" strokeLinecap="round" />
        </svg>
      </button>
    ) : <button type="button" className={`button-secondary whitespace-nowrap${variant === "compact" ? " button-sm" : ""}`} onClick={showQr}>QR</button>}
    <PalletQrDialog pallet={pallet} open={open} onClose={() => setOpen(false)} />
  </>;
}

/**
 * Diálogo del QR del pallet, separado del botón para poder abrirlo también desde el menú "⋯" de la fila. Se monta
 * de nuevo en cada apertura: arranca generando la imagen.
 */
export function PalletQrDialog({ pallet, open, onClose }: { pallet: Pallet; open: boolean; onClose: () => void }) {
  return open ? <PalletQrModal pallet={pallet} onClose={onClose} /> : null;
}

function PalletQrModal({ pallet, onClose }: { pallet: Pallet; onClose: () => void }) {
  const { qrCode } = pallet;
  const imageRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  function downloadLabel() {
    const source = imageRef.current?.querySelector("svg");
    if (!source) {
      setError(true);
      return;
    }

    const namespace = "http://www.w3.org/2000/svg";
    const label = document.createElementNS(namespace, "svg");
    const content = palletLabelContent(pallet);
    label.setAttribute("xmlns", namespace);
    label.setAttribute("viewBox", "0 0 760 440");
    label.setAttribute("width", "760");
    label.setAttribute("height", "440");

    const background = document.createElementNS(namespace, "rect");
    background.setAttribute("width", "760");
    background.setAttribute("height", "440");
    background.setAttribute("rx", "16");
    background.setAttribute("fill", "white");
    background.setAttribute("stroke", "#1f2937");
    background.setAttribute("stroke-width", "3");
    label.append(background);

    const qr = source.cloneNode(true) as SVGSVGElement;
    qr.setAttribute("x", "34");
    qr.setAttribute("y", "34");
    qr.setAttribute("width", "330");
    qr.setAttribute("height", "330");
    qr.setAttribute("viewBox", qr.getAttribute("viewBox") ?? "0 0 280 280");
    qr.removeAttribute("style");
    label.append(qr);

    const text = (value: string, x: number, y: number, size: number, weight = "400", color = "#111827") => {
      const node = document.createElementNS(namespace, "text");
      node.setAttribute("x", String(x));
      node.setAttribute("y", String(y));
      node.setAttribute("font-family", "Arial, sans-serif");
      node.setAttribute("font-size", String(size));
      node.setAttribute("font-weight", weight);
      node.setAttribute("fill", color);
      node.textContent = value;
      label.append(node);
    };
    const field = (name: string, value: string, y: number) => {
      text(name.toUpperCase(), 400, y, 16, "700", "#4b5563");
      text(value, 400, y + 32, 22, "600");
    };
    text(content.readableCode, 34, 402, 25, "700");
    field("Producto", content.product, 72);
    field("Lote", content.batch, 164);
    field("Cantidad", `${content.quantity ?? "—"} ${content.unit}`, 256);

    const contents = new XMLSerializer().serializeToString(label);
    const url = URL.createObjectURL(new Blob([contents], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    const safeCode = qrCode.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "pallet";
    link.href = url;
    link.download = `etiqueta-${safeCode}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    let active = true;
    async function generateQr() {
      try {
        const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
        if (!active) return;
        const svg = new BrowserQRCodeSvgWriter().write(qrCode, 280, 280);
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", `Código QR del pallet ${qrCode}`);
        svg.style.maxWidth = "100%";
        svg.style.height = "auto";
        imageRef.current?.replaceChildren(svg);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    }
    void generateQr();
    return () => { active = false; };
  }, [qrCode]);

  return (
    <Modal open onClose={onClose} title="QR del pallet" description="Escaneá este código o descargá la etiqueta completa del pallet."
      actions={<><button type="button" onClick={onClose} className="button-secondary">Cerrar</button><button type="button" onClick={downloadLabel} disabled={loading || error} className="button-primary">Descargar etiqueta</button></>}>
      {loading && <LoadingState label="Generando imagen QR…" />}
      {error && <InlineAlert variant="danger">No se pudo mostrar el QR. Cerrá e intentá nuevamente.</InlineAlert>}
      <div ref={imageRef} className="mx-auto mt-4 w-fit bg-white" />
      <p className="mt-3 break-all font-mono text-xs">{qrCode}</p>
    </Modal>
  );
}
