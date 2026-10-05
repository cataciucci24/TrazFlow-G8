export type AccessRequestStatus = "pending" | "approved" | "rejected";

export type RequestedRole = "warehouse_operator" | "distributor_operator";

export type AccessRequest = {
  id: string;
  companyId: string;
  requestedRole: RequestedRole;
  status: AccessRequestStatus;
  createdAt: string;
};
