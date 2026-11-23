"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { Modal } from "@/components/ui/modal";
import { InlineAlert } from "@/components/ui/design-system";
import { returnPalletToWarehouse } from "@/lib/pallets/return-actions";

export function ReturnPalletForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });
  const [pending, startTransition] = useTransition();
  return <>
    <button className="button-secondary" type="button" onClick={() => { setState({ error: null, success: null }); setCode(""); setReason(""); setOpen(true); }}>Reingresar pallet</button>
    <Modal open={open} onClose={() => { if (!pending) setOpen(false); }} title="Reingresar pallet a depósito" busy={pending}
      description="Registrá el pallet completo que vuelve al depósito original. Para reenviarlo, creá una nueva orden de despacho.">
      <form className="grid gap-4" onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        startTransition(async () => {
          try {
            const result = await returnPalletToWarehouse(code, reason);
            setState(result);
            if (result.success) { setCode(""); setReason(""); router.refresh(); }
          } catch { setState({ error: "No se pudo registrar el reingreso. Intentá nuevamente.", success: null }); }
        });
      }}>
        {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
        {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}
        <label className="form-label">QR del pallet<input className="form-control mt-2" required maxLength={512} value={code} disabled={pending} onChange={(event) => setCode(event.target.value)} /></label>
        <button className="button-secondary" type="button" disabled={pending} onClick={() => setScanner(true)}>Escanear QR</button>
        <label className="form-label">Motivo del reingreso<textarea className="form-control mt-2" required maxLength={1000} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="button-primary" disabled={pending || !code.trim() || !reason.trim()}>{pending ? "Registrando…" : "Confirmar reingreso"}</button>
      </form>
    </Modal>
    {scanner && <QrScanner disabled={pending} onCancel={() => setScanner(false)} onScan={(value) => { setCode(value.trim()); setScanner(false); }} />}
  </>;
}
