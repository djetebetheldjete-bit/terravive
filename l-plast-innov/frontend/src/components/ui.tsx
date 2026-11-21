import type { ReactNode } from "react";
import type { AlertLevel, AlertStatus, CameraStatus, ZoneStatus } from "../types";

export function StatCard({
  label,
  value,
  accent = "ocean",
  hint,
}: {
  label: string;
  value: ReactNode;
  accent?: "ocean" | "eco" | "warn" | "danger" | "slate";
  hint?: string;
}) {
  const ring: Record<string, string> = {
    ocean: "border-l-ocean",
    eco: "border-l-eco",
    warn: "border-l-warn",
    danger: "border-l-danger",
    slate: "border-l-slate-400",
  };
  return (
    <div className={`card border-l-4 ${ring[accent]}`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-slate-800">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function ZoneBadge({ status }: { status: ZoneStatus }) {
  const map: Record<ZoneStatus, [string, string]> = {
    clean: ["bg-eco/10 text-eco-dark", "Propre"],
    monitored: ["bg-warn/10 text-warn", "En surveillance"],
    alert: ["bg-danger/10 text-danger", "En alerte"],
    disabled: ["bg-slate-100 text-slate-500", "Désactivée"],
  };
  const [cls, label] = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function AlertBadge({ level }: { level: AlertLevel }) {
  return level === "critical" ? (
    <span className="badge bg-danger/10 text-danger">🔴 Critique</span>
  ) : (
    <span className="badge bg-warn/10 text-warn">🟠 Préventive</span>
  );
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const map: Record<AlertStatus, [string, string]> = {
    open: ["bg-danger/10 text-danger", "Ouverte"],
    acknowledged: ["bg-warn/10 text-warn", "Prise en compte"],
    in_cleaning: ["bg-ocean/10 text-ocean-dark", "Nettoyage en cours"],
    resolved: ["bg-eco/10 text-eco-dark", "Clôturée"],
  };
  const [cls, label] = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function CameraBadge({ status }: { status: CameraStatus }) {
  const map: Record<CameraStatus, [string, string]> = {
    active: ["bg-eco/10 text-eco-dark", "En ligne"],
    offline: ["bg-slate-200 text-slate-600", "Hors ligne"],
    maintenance: ["bg-warn/10 text-warn", "Maintenance"],
    disabled: ["bg-slate-100 text-slate-500", "Désactivée"],
  };
  const [cls, label] = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function DemoBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="badge bg-purple-100 text-purple-700" title="Donnée de démonstration / simulation">
      DEMO
    </span>
  );
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-slate-500">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-ocean border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{children}</div>
  );
}
