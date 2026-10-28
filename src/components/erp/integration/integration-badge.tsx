import { Badge, type BadgeTone } from "@/components/ui/design-system";
import { INTEGRATION_BADGE_LABELS, type IntegrationBadge } from "@/lib/erp-integration/types";

const TONES: Record<IntegrationBadge, BadgeTone> = {
  healthy: "success",
  syncing: "info",
  pending: "assigned",
  failed: "danger",
  stale: "warning",
};

export function IntegrationBadgeView({ badge, detail }: { badge: IntegrationBadge; detail?: string }) {
  const label = INTEGRATION_BADGE_LABELS[badge];
  return <Badge tone={TONES[badge]}>{label}{detail && detail !== label ? ` · ${detail}` : ""}</Badge>;
}
