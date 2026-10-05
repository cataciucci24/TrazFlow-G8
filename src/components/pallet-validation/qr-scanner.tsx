"use client";

import { InlineAlert, LoadingState } from "@/components/ui/design-system";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { IScannerControls } from "@zxing/browser";

type QrScannerProps = {
  disabled: boolean;
  onCancel: () => void;
  onScan: (value: string) => void;
};

export function QrScanner({ disabled, onCancel, onScan }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readLockedRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function startScanner() {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (!active || !videoRef.current) return;

        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 250,
        });
        const scannerControls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result, _error, controls) => {
            if (!active || !result || readLockedRef.current) return;

            readLockedRef.current = true;
            controls.stop();
            onScan(result.getText());
          },
        );
        if (!active) scannerControls.stop();
        else { controlsRef.current = scannerControls; setCameraReady(true); }
      } catch {
        if (active) setCameraError("No se pudo acceder a la cámara.");
      }
    }

    void startScanner();

    return () => {
      active = false;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [onScan]);

  function closeScanner() {
    controlsRef.current?.stop();
    onCancel();
  }

  return (
    <Modal open onClose={closeScanner} title="Escanear pallet"
      description="Apuntá la cámara al código QR adherido al pallet."
      busy={disabled}
      actions={<button type="button" disabled={disabled} onClick={closeScanner} className="button-secondary">
        {disabled ? "Validando..." : "Cancelar"}
      </button>}>
        {cameraError ? (
          <InlineAlert variant="danger">{cameraError} Revisá los permisos del navegador e intentá nuevamente.</InlineAlert>
        ) : (
          <div className="space-y-3">
            {!cameraReady && <LoadingState label="Iniciando cámara…" />}
            <div className="overflow-hidden rounded-md bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-square w-full object-cover"
            />
            </div>
          </div>
        )}

    </Modal>
  );
}
