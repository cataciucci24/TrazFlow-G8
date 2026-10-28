"use client";

/** A single trigger: a desktop tile and a thumb-reachable mobile action. */
export function ScanButton({ disabled, busy = false, onClick, label, busyLabel, accessibleLabel }: {
  disabled: boolean;
  busy?: boolean;
  onClick: () => void;
  label: string;
  busyLabel: string;
  accessibleLabel?: string;
}) {
  return <div className="scan-action">
    <button type="button" disabled={disabled} aria-busy={busy} aria-label={accessibleLabel}
      onClick={onClick} className="scanner-trigger group">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="scan-icon" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" />
      </svg>
      <span>{busy ? busyLabel : label}</span>
      <span className="scan-hint">Se abrirá la cámara del dispositivo</span>
    </button>
  </div>;
}
