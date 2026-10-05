"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { InlineAlert } from "@/components/ui/design-system";

const FeedbackContext = createContext<((message: string) => void) | null>(null);

type Notice = { id: number; message: string };

function SuccessNotice({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(notice.id), 8000);
    return () => window.clearTimeout(timer);
  }, [notice.id, onDismiss, paused]);

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <InlineAlert variant="success" announce={false} className="flex items-start gap-3 shadow-lg">
        <p className="min-w-0 flex-1">{notice.message}</p>
        <button type="button" aria-label="Cerrar notificación" onClick={() => onDismiss(notice.id)} className="button-ghost button-icon">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </InlineAlert>
    </div>
  );
}

/** Lives in the shared dashboard layout, so deleting a row cannot remove its feedback. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [announcement, setAnnouncement] = useState<Notice | null>(null);
  const nextId = useRef(0);
  const notify = useCallback((message: string) => {
    const id = nextId.current++;
    setNotices((current) => [...current.slice(-2), { id, message }]);
    setAnnouncement({ id, message });
  }, []);
  const dismiss = useCallback((id: number) => setNotices((current) => current.filter((notice) => notice.id !== id)), []);
  return (
    <FeedbackContext.Provider value={notify}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement ? <span key={announcement.id}>{announcement.message}</span> : null}</div>
      <section aria-label="Notificaciones de acciones" className="pointer-events-none fixed right-4 bottom-4 left-4 z-40 grid gap-2 sm:left-auto sm:w-96">
        {notices.map((notice) => <div key={notice.id} className="pointer-events-auto"><SuccessNotice notice={notice} onDismiss={dismiss} /></div>)}
      </section>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const notify = useContext(FeedbackContext);
  if (!notify) throw new Error("useFeedback requires FeedbackProvider");
  return notify;
}

export function CreatedOrderNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <InlineAlert variant="success" className="flex flex-wrap items-center justify-between gap-3">
    <p>Orden de despacho creada correctamente.</p>
    <button type="button" onClick={() => setDismissed(true)} className="button-ghost" aria-label="Cerrar confirmación de creación">Cerrar</button>
  </InlineAlert>;
}
