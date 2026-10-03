"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
};

/** Native modal semantics provide focus containment and make the background inert. */
export function Modal({
  open, onClose, title, description, children, actions, busy = false,
  dismissOnBackdrop = true, dismissOnEscape = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = trigger?.closest<HTMLElement>('[role="region"][tabindex]');
    const pageFallback = document.querySelector<HTMLElement>('main[tabindex="-1"]');
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
      else if (fallback?.isConnected) fallback.focus();
      else if (pageFallback?.isConnected) pageFallback.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && dismissOnEscape) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy || !dismissOnBackdrop) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(640px,calc(100vw-2rem))] max-w-none overflow-y-auto overscroll-contain rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-0 text-left text-[var(--foreground)] shadow-xl backdrop:bg-stone-950/40"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="section-title break-words">{title}</h2>
              {description ? <div id={descriptionId} className="section-description break-words">{description}</div> : null}
            </div>
            <button type="button" autoFocus disabled={busy} onClick={onClose} aria-label="Cerrar diálogo" className="button-ghost button-icon">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          {children ? <div className="mt-5">{children}</div> : null}
          {actions ? <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-[var(--border)] pt-4">{actions}</div> : null}
          {busy ? <p role="status" className="mt-4 text-sm text-[var(--muted)]">Procesando… Esperá a que termine la operación.</p> : null}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmationDialog({
  open, onClose, onConfirm, title, description, confirmLabel, busy = false,
  danger = false, blocked = false, error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  blocked?: boolean;
  error?: string | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} busy={busy}
      actions={<>
        <button type="button" disabled={busy} onClick={onClose} className="button-secondary">Cancelar</button>
        <button type="button" disabled={busy || blocked} aria-busy={busy} onClick={onConfirm} className={danger ? "button-danger" : "button-primary"}>
          {busy ? "Procesando…" : confirmLabel}
        </button>
      </>}>
      {error ? <p role="alert" className="feedback feedback-danger">{error}</p> : null}
    </Modal>
  );
}
