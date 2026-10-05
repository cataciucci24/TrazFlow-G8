import type { RequestedRole } from "@/lib/access-requests/types";

export type PendingAccessRequest = {
  requestId: string;
  userId: string;
  email: string | null;
  companyId: string;
  companyName: string;
  requestedRole: RequestedRole;
  status: "pending";
  createdAt: string;
};
