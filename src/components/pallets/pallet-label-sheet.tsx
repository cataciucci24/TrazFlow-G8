"use client";

import { useEffect, useRef, useState } from "react";

import type { Pallet } from "@/lib/types";
import { palletLabelContent } from "@/lib/pallet-labels/selection";

type LabelSize = "standard" | "compact";

export function PalletLabelSheet({ pallets }: { pallets: Pallet[] }) {
  const [size, setSize] = useState<LabelSize>("standard");
  return <>
    <div className="no-print surface flex flex-wrap items-end gap-3 p-4">
      <label className="form-label">Tamaño de etiqueta
        <select className="form-control mt-2" value={size} onChange={(event) => setSize(event.target.value as LabelSize)}>
          <option value="standard">Estándar A4 · 2 columnas</option>
          <option value="compact">Compacta A4 · 3 columnas</option>
        </select>
      </label>
      <button type="button" className="button-primary" onClick={() => window.print()}>Imprimir {pallets.length} etiqueta{pallets.length === 1 ? "" : "s"}</button>
    </div>
    <div className={`label-sheet label-sheet-${size}`} data-label-size={size}>
      {pallets.map((pallet) => <PalletLabel key={pallet.id} pallet={pallet} />)}
    </div>
  </>;
}

function PalletLabel({ pallet }: { pallet: Pallet }) {
  const qrRef = useRef<HTMLDivElement>(null);
  const content = palletLabelContent(pallet);
  useEffect(() => {
    let active = true;
    async function renderQr() {
      const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
      if (!active) return;
      const svg = new BrowserQRCodeSvgWriter().write(content.qrValue, 320, 320);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `Código QR del pallet ${content.readableCode}`);
      qrRef.current?.replaceChildren(svg);
    }
    void renderQr();
    return () => { active = false; };
  }, [content.qrValue, content.readableCode]);

  return <article className="pallet-label">
    <div ref={qrRef} className="pallet-label-qr" />
    <p className="pallet-label-code">{content.readableCode}</p>
    <dl className="pallet-label-data">
      <div><dt>Producto</dt><dd>{content.product}</dd></div>
      <div><dt>Lote</dt><dd>{content.batch}</dd></div>
      <div><dt>Cantidad</dt><dd>{content.quantity ?? "—"} {content.unit}</dd></div>
    </dl>
  </article>;
}
