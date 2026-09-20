"use client";

import { useEffect, useRef, useState } from "react";
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
        controlsRef.current = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result, _error, controls) => {
            if (!result || readLockedRef.current) return;

            readLockedRef.current = true;
            controls.stop();
            onScan(result.getText());
          },
        );
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="surface w-full max-w-md space-y-4 p-5 shadow-xl">
        <div>
          <h3 id="qr-scanner-title" className="font-semibold text-slate-950">
            Escanear pallet
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Apuntá la cámara al código QR adherido al pallet.
          </p>
        </div>

        {cameraError ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700"
          >
            {cameraError} Revisá los permisos del navegador e intentá nuevamente.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-square w-full object-cover"
            />
          </div>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            controlsRef.current?.stop();
            onCancel();
          }}
          className="button-secondary w-full disabled:opacity-60"
        >
          {disabled ? "Validando..." : "Cancelar"}
        </button>
      </div>
    </div>
  );
}
