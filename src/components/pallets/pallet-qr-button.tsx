"use client";

import { InlineAlert, LoadingState } from "@/components/ui/design-system";

import { useEffect, useRef, useState } from "react";

import { Modal } from "@/components/ui/modal";

/**
 * `compact`: botón bajo con texto, para filas de tablas.
 * `icon`: botón cuadrado solo con el símbolo QR, para encabezados.
 */
export function PalletQrButton({ qrCode, variant = "default" }: { qrCode: string; variant?: "default" | "compact" | "icon" }) {
  const [open, setOpen] = useState(false);
  const imageRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  function showQr() {
    setError(false);
    setLoading(true);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    let active = true;
    async function generateQr() {
      try {
        const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
        if (!active) return;
        // Codifica exactamente el valor persistido que buscan los escáneres.
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
  }, [open, qrCode]);

  return (
    <>
      {variant === "icon" ? (
        <button type="button" className="button-secondary button-icon" onClick={showQr} aria-label={`Ver QR del pallet ${qrCode}`} title="Ver QR">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
            <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
            <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
            <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
            <path d="M14.5 14.5h2.5v2.5h-2.5zM18 18h2.5v2.5H18zM14.5 20.5H17M20.5 14.5V17" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <button type="button" className={`button-secondary whitespace-nowrap${variant === "compact" ? " button-sm" : ""}`} onClick={showQr}>
          QR
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="QR del pallet"
        description="Escaneá este código para identificar el pallet."
        actions={<button type="button" onClick={() => setOpen(false)} className="button-secondary">Cerrar</button>}>
        {loading && <LoadingState label="Generando imagen QR…" />}
        {error && <InlineAlert variant="danger">No se pudo mostrar el QR. Cerrá e intentá nuevamente.</InlineAlert>}
        <div ref={imageRef} className="mx-auto mt-4 w-fit bg-white" />
        <p className="mt-3 break-all font-mono text-xs">{qrCode}</p>
      </Modal>
    </>
  );
}
