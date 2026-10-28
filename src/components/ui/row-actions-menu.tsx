"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";

/**
 * Una opción del menú de una fila. Con `href` es un link; con `onSelect`, una acción (por ejemplo abrir un
 * diálogo). Con `disabledReason` se muestra deshabilitada y con el motivo, en lugar de ocultarse.
 */
export type RowAction = {
  label: string;
  href?: string;
  onSelect?: () => void;
  disabledReason?: string;
  danger?: boolean;
};

type Rect = { top: number; bottom: number; left: number; right: number };
type Size = { width: number; height: number };

const GAP = 4;
const MARGIN = 8;

/**
 * Dónde va el menú (posición fija, en px del viewport): debajo del botón y hacia el espacio disponible. Si no entra
 * abajo y sí arriba, se abre hacia arriba. Nunca queda a menos de MARGIN de un borde de la pantalla.
 */
export function menuPosition(trigger: Rect, menu: Size, viewport: Size): { top: number; left: number } {
  const maxLeft = Math.max(MARGIN, viewport.width - menu.width - MARGIN);
  const preferredLeft = (trigger.left + trigger.right) / 2 <= viewport.width / 2
    ? trigger.left
    : trigger.right - menu.width;
  const left = Math.min(Math.max(preferredLeft, MARGIN), maxLeft);
  const below = trigger.bottom + GAP;
  const above = trigger.top - GAP - menu.height;
  const fitsBelow = below + menu.height <= viewport.height - MARGIN;
  const top = fitsBelow || above < MARGIN
    ? Math.max(MARGIN, Math.min(below, viewport.height - MARGIN - menu.height))
    : above;
  return { top, left };
}

/** Índice de la opción que recibe el foco con esa tecla (las flechas dan la vuelta), o null si la tecla no mueve. */
export function nextMenuIndex(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown": return (current + 1 + count) % count;
    case "ArrowUp": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
}

/** Texto visible y nombre accesible de una opción: "Eliminar — tiene historial de trazabilidad". */
export function rowActionLabel(action: RowAction): string {
  return action.disabledReason ? `${action.label} — ${action.disabledReason}` : action.label;
}

/**
 * Botón "⋯" al final de una fila que abre un menú con todas sus acciones (patrón "menu button" de WAI-ARIA).
 *
 * - Enter, Espacio o flecha abajo abren y enfocan la primera opción; flecha arriba, la última.
 * - Flechas, Inicio y Fin recorren las opciones. Escape cierra y devuelve el foco al botón; Tab cierra y sigue.
 * - Un clic afuera cierra.
 * - El menú se dibuja en document.body con posición fija: así no lo corta el scroll horizontal de TableShell
 *   ni queda detrás de otras filas, también en mobile. Sigue al botón si la página se desplaza.
 * - Al elegir una acción el foco vuelve al botón antes de ejecutarla: si abre un Modal, al cerrarlo el foco
 *   vuelve al "⋯" de esa fila.
 */
export function RowActionsMenu({ label, actions }: {
  /** Nombre accesible del botón, por ejemplo "Acciones del pallet PAL-…". */
  label: string;
  actions: RowAction[];
}) {
  const [open, setOpen] = useState(false);
  // Opción que recibe el foco al abrir: 0 = primera, -1 = última.
  const [initialFocus, setInitialFocus] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const triggerId = useId();

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function openMenu(focus: number) {
    setInitialFocus(focus);
    setOpen(true);
  }

  // Posición y foco antes de pintar: el menú arranca oculto hasta saber dónde va.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      if (!menu || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const { top, left } = menuPosition(rect, { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight });
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.visibility = "visible";
    };
    place();
    const list = menuItems(menuRef.current);
    list[initialFocus < 0 ? list.length - 1 : initialFocus]?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, initialFocus]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowDown" ? 0 : -1);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      // El foco vuelve al botón y el Tab sigue desde ahí, hacia el siguiente elemento de la página.
      close(true);
      return;
    }
    const list = menuItems(menuRef.current);
    const current = list.indexOf(document.activeElement as HTMLElement);
    const next = nextMenuIndex(current, event.key, list.length);
    if (next !== null) {
      event.preventDefault();
      list[next]?.focus();
      return;
    }
    // Los links se activan con Enter de forma nativa; Espacio también, como en las demás opciones.
    if (event.key === " " && document.activeElement instanceof HTMLAnchorElement) {
      event.preventDefault();
      document.activeElement.click();
    }
  }

  function select(action: RowAction, event: MouseEvent) {
    if (action.disabledReason) {
      event.preventDefault();
      return;
    }
    close(true);
    action.onSelect?.();
  }

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-labelledby={triggerId}
      onKeyDown={onMenuKeyDown}
      className="row-actions-menu"
      style={{ position: "fixed", top: 0, left: 0, visibility: "hidden" }}
    >
      {actions.map((action) => {
        const text = rowActionLabel(action);
        const className = `row-actions-item${action.danger ? " row-actions-item-danger" : ""}`;
        return action.href && !action.disabledReason ? (
          <Link key={action.label} href={action.href} role="menuitem" tabIndex={-1} className={className} onClick={(event) => select(action, event)}>
            {text}
          </Link>
        ) : (
          <button key={action.label} type="button" role="menuitem" tabIndex={-1} aria-disabled={action.disabledReason ? true : undefined}
            className={className} onClick={(event) => select(action, event)}>
            {action.disabledReason ? <>{action.label} <span className="row-actions-reason">— {action.disabledReason}</span></> : text}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu(0))}
        onKeyDown={onTriggerKeyDown}
        className="button-secondary button-sm row-actions-trigger"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
        </svg>
        <span className="md:hidden">Acciones</span>
      </button>
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </>
  );
}
