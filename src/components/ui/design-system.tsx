import type { ReactNode } from "react";
import { PALLET_STATUS_LABELS } from "@/lib/pallets/labels";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import type { OrderStatus, PalletStatus } from "@/lib/types";

export type AlertStatus = "critical" | "caution" | "upcoming";
export type AlertType = "expiration" | "stock";
export type CompactSummaryTone = "neutral" | "brand" | "sky" | "violet" | "amber" | "green" | "red";

type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
};

export function PageHeader({ title, description, eyebrow, action }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

type SectionHeaderProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
};

export function SectionHeader({ title, description, action, id }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div className="min-w-0">
        <h2 id={id} className="section-title">{title}</h2>
        {description ? <p className="section-description">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`surface ${className}`}>{children}</div>;
}

export function TableShell({ children, label, mobileLayout = "table", className = "" }: {
  children: ReactNode;
  label: string;
  mobileLayout?: "table" | "rows";
  className?: string;
}) {
  return (
    <div className="table-container">
      {mobileLayout === "table" ? <p className="table-scroll-hint">Deslizá horizontalmente para ver todas las columnas.</p> : null}
      <div className={`table-shell ${mobileLayout === "rows" ? "table-shell-rows" : ""} ${className}`} role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}

const alertStatusDetails: Record<AlertStatus, { label: string; className: string }> = {
  critical: { label: "Crítico", className: "status-critical" },
  caution: { label: "Precaución", className: "status-caution" },
  upcoming: { label: "Próximo", className: "status-upcoming" },
};

export function StatusBadge({ status }: { status: AlertStatus }) {
  const detail = alertStatusDetails[status];
  return <span className={`status-badge ${detail.className}`}>{detail.label}</span>;
}

export function AlertTypeBadge({ type }: { type: AlertType }) {
  return (
    <span className={`type-badge ${type === "expiration" ? "type-expiration" : "type-stock"}`}>
      {type === "expiration" ? "VENCIMIENTO" : "STOCK"}
    </span>
  );
}

export type BadgeTone = "neutral" | "info" | "assigned" | "warning" | "success" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`status-badge badge-${tone}`}>{children}</span>;
}

export function FilterPanel({ label, children, onClear }: { label: string; children: ReactNode; onClear?: () => void }) {
  return (
    <section aria-label={label} className="filter-panel">
      <div className="filter-grid">{children}</div>
      {onClear ? <button type="button" onClick={onClear} className="button-ghost mt-3">Limpiar filtros</button> : null}
    </section>
  );
}

const palletStatusClasses: Record<PalletStatus, BadgeTone> = {
  in_warehouse: "info",
  assigned: "assigned",
  in_transit: "warning",
  received: "success",
  discrepancy: "danger",
};

export function PalletStatusBadge({ status }: { status: PalletStatus }) {
  return <Badge tone={palletStatusClasses[status]}>{PALLET_STATUS_LABELS[status]}</Badge>;
}

const orderStatusClasses: Record<OrderStatus, BadgeTone> = {
  draft: "neutral",
  validating: "info",
  has_discrepancy: "danger",
  confirmed: "warning",
  received: "success",
  received_with_discrepancy: "danger",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={orderStatusClasses[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function SummaryCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number | string;
  detail?: string;
  tone?: AlertStatus;
}) {
  return (
    <div className={`summary-card ${tone ? `summary-${tone}` : ""}`}>
      <p className="summary-label">{label}</p>
      <p className="summary-value">{value}</p>
      {detail ? <p className="summary-detail">{detail}</p> : null}
    </div>
  );
}

export function CompactSummaryCard({
  label,
  value,
  tone = "neutral",
  onClick,
  pressed,
}: {
  label: string;
  value: number | string;
  tone?: CompactSummaryTone;
  /** Con onClick la tarjeta se vuelve un botón de filtro; `pressed` marca el filtro activo. */
  onClick?: () => void;
  pressed?: boolean;
}) {
  const content = (
    <>
      <span className="compact-summary-label">{label}</span>
      <span className="compact-summary-value">{value}</span>
    </>
  );
  if (!onClick) return <div className={`compact-summary-card compact-tone-${tone}`}>{content}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed ?? false} className={`compact-summary-card compact-tone-${tone} compact-summary-button`}>
      {content}
    </button>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}

export function InlineAlert({ variant = "info", children, className = "", id, announce = true }: {
  variant?: "danger" | "success" | "warning" | "info";
  children: ReactNode;
  className?: string;
  id?: string;
  announce?: boolean;
}) {
  return <div id={id} role={announce ? variant === "danger" ? "alert" : "status" : undefined} aria-atomic="true" className={`feedback feedback-${variant} ${className}`}>{children}</div>;
}

export function LoadingState({ label = "Cargando…", skeleton = false }: { label?: string; skeleton?: boolean }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-atomic="true" className={skeleton ? "space-y-6" : "flex items-center gap-3 text-sm text-[var(--muted)]"}>
      <span>{label}</span>
      {skeleton ? (
        <div aria-hidden="true" className="space-y-6 animate-pulse motion-reduce:animate-none">
          <div className="space-y-3"><div className="h-8 w-2/3 max-w-sm rounded-lg bg-stone-200" /><div className="h-4 w-5/6 max-w-lg rounded-lg bg-stone-200" /></div>
          <div className="surface space-y-4 p-5">{[0, 1, 2].map((row) => <div key={row} className="space-y-2"><div className="h-5 w-1/2 rounded bg-stone-200" /><div className="h-4 w-full rounded bg-stone-100" /></div>)}</div>
        </div>
      ) : <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-[var(--brand-border)] border-t-[var(--brand)] motion-reduce:animate-none" />}
    </div>
  );
}
