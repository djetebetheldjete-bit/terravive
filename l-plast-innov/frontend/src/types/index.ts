// Types partagés, alignés sur les schémas Pydantic du backend.

export type ZoneStatus = "clean" | "monitored" | "alert" | "disabled";
export type CameraStatus = "active" | "offline" | "maintenance" | "disabled";
export type AlertLevel = "preventive" | "critical";
export type AlertStatus = "open" | "acknowledged" | "in_cleaning" | "resolved";
export type CleaningStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "awaiting_verification"
  | "verified"
  | "to_redo";

export interface Threshold {
  preventive: number;
  critical: number;
}

export interface Zone {
  id: number;
  code: string;
  name: string;
  description: string | null;
  area_m2: number | null;
  geojson: string | null;
  center_lat: number | null;
  center_lon: number | null;
  status: ZoneStatus;
  present_waste_count: number;
  is_simulated: boolean;
  threshold: Threshold | null;
}

export interface Camera {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: CameraStatus;
  lat: number | null;
  lon: number | null;
  zone_id: number | null;
  last_seen_at: string | null;
  is_simulated: boolean;
}

export interface Alert {
  id: number;
  zone_id: number;
  level: AlertLevel;
  status: AlertStatus;
  waste_count_at_trigger: number;
  threshold_value: number;
  message: string | null;
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  is_simulated: boolean;
}

export interface CleaningOp {
  id: number;
  zone_id: number;
  responsible_user_id: number | null;
  status: CleaningStatus;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  reported_removed_count: number | null;
  notes: string | null;
  is_simulated: boolean;
}

export interface DashboardOverview {
  as_of: string;
  timezone: string;
  present_waste: number;
  new_waste_today: number;
  removed_today: number;
  total_detections_today: number;
  zones_total: number;
  zones_monitored: number;
  zones_alert: number;
  cameras_active: number;
  cameras_offline: number;
  alerts_open: number;
  cleaning_operations: number;
  waste_by_category: Record<string, number>;
}

export interface DailyCount {
  day: string;
  timezone: string;
  present_now: number;
  new_waste: number;
  total_detections: number;
  removed: number;
}

export interface UserOut {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
  role_name: string;
  location_consent: boolean;
}

export interface WasteCategory {
  id: number;
  code: string;
  label: string;
  is_plastic: boolean;
  description: string | null;
}
