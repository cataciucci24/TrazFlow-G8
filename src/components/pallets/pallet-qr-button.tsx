"use client";

import { InlineAlert, LoadingState } from "@/components/ui/design-system";

import { useEffect, useRef, useState } from "react";

import { Modal } from "@/components/ui/modal";

export function PalletQrButton({ qrCode }: { qrCode: string }) {
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
      <button type="button" className="button-secondary whitespace-nowrap" onClick={showQr}>
        VER QR
      </button>
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
