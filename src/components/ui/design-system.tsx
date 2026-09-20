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
  description?: string;
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

export function TableShell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="table-shell" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

const alertStatusDetails: Record<AlertStatus, { label: string; className: string }> = {
  critical: { label: "CRÍTICO", className: "status-critical" },
  caution: { label: "PRECAUCIÓN", className: "status-caution" },
  upcoming: { label: "PRÓXIMO", className: "status-upcoming" },
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

const palletStatusClasses: Record<PalletStatus, string> = {
  in_warehouse: "bg-sky-50 text-sky-700",
  assigned: "bg-violet-50 text-violet-700",
  in_transit: "bg-amber-50 text-amber-700",
  received: "bg-emerald-50 text-emerald-700",
  discrepancy: "bg-red-50 text-red-700",
};

export function PalletStatusBadge({ status }: { status: PalletStatus }) {
  return <span className={`status-badge ${palletStatusClasses[status]}`}>{PALLET_STATUS_LABELS[status]}</span>;
}

const orderStatusClasses: Record<OrderStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  validating: "bg-sky-50 text-sky-700",
  has_discrepancy: "bg-red-50 text-red-700",
  confirmed: "bg-emerald-50 text-emerald-700",
  received: "bg-emerald-50 text-emerald-700",
  received_with_discrepancy: "bg-red-50 text-red-700",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge ${orderStatusClasses[status]}`}>{ORDER_STATUS_LABELS[status]}</span>;
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
}: {
  label: string;
  value: number | string;
  tone?: CompactSummaryTone;
}) {
  return (
    <div className="compact-summary-card">
      <span className={`compact-summary-label compact-tone-${tone}`}>{label}</span>
      <span className="compact-summary-value">{value}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
