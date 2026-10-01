"use client";

import { useId, useRef, useState } from "react";

export function PalletQrButton({ qrCode }: { qrCode: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function showQr() {
    dialogRef.current?.showModal();
    setError(false);
    setLoading(true);
    imageRef.current?.replaceChildren();
    try {
      const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
      // Codifica exactamente el valor persistido que buscan los escáneres.
      const svg = new BrowserQRCodeSvgWriter().write(qrCode, 280, 280);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `Código QR del pallet ${qrCode}`);
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      imageRef.current?.replaceChildren(svg);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="filter-chip whitespace-nowrap" onClick={showQr}>
        VER QR
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-white p-6 text-center text-stone-900 shadow-xl backdrop:bg-black/50"
      >
        <h2 id={titleId} className="text-lg font-bold">QR del pallet</h2>
        <p className="mt-2 text-sm text-stone-500">Escaneá este código para identificar el pallet.</p>
        {loading && <p role="status" className="mt-4 text-sm">Generando imagen QR...</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">No se pudo mostrar el QR. Cerrá e intentá nuevamente.</p>}
        <div ref={imageRef} className="mx-auto mt-4 w-fit bg-white" />
        <p className="mt-3 break-all font-mono text-xs">{qrCode}</p>
        <form method="dialog" className="mt-5">
          <button className="button-secondary">Cerrar</button>
        </form>
      </dialog>
    </>
  );
}
