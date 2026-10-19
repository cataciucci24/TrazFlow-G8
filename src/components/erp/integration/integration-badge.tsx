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
  return <Badge tone={TONES[badge]}>{INTEGRATION_BADGE_LABELS[badge]}{detail ? ` · ${detail}` : ""}</Badge>;
}
