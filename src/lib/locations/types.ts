export type WarehouseLocation = {
  id: string;
  company_id: string;
  warehouse_code: string;
  code: string;
  aisle: string;
  rack: string;
  level: string;
  position: string;
};
export type LocationEvent = {
  id: string;
  event_type: "location_assigned" | "location_changed";
  created_at: string;
  user_id: string;
  details: { previous_location: string | null; new_location: string; user_name: string };
};
export type LocationActionState = { error: string | null; success: string | null };
