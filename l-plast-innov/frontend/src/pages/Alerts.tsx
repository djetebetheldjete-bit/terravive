import { useEffect, useState } from "react";
import { api } from "../api/client";
import { AlertBadge, AlertStatusBadge, DemoBadge, ErrorNote } from "../components/ui";
import type { Alert } from "../types";

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [level, setLevel] = useState<string>("");

  const load = () => {
    const params = new URLSearchParams();
    if (openOnly) params.set("open_only", "true");
    if (level) params.set("level", level);
    return api
      .get<Alert[]>(`/api/v1/alerts?${params.toString()}`)
      .then((r) => setAlerts(r.data))
      .catch(() => setErr("Chargement impossible."));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOnly, level]);

  const ack = async (id: number) => {
    await api.post(`/api/v1/alerts/${id}/acknowledge`);
    await load();
  };

  if (err) return <ErrorNote>{err}</ErrorNote>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Alertes</h1>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Non traitées seulement
          </label>
          <select className="input !w-auto !py-1" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Tous niveaux</option>
            <option value="preventive">Préventive</option>
            <option value="critical">Critique</option>
          </select>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="card text-sm text-slate-500">Aucune alerte.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Niveau</th>
                <th className="th">Zone</th>
                <th className="th">Déchets / seuil</th>
                <th className="th">Déclenchée</th>
                <th className="th">Statut</th>
                <th className="th">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="td"><span className="flex items-center gap-2"><AlertBadge level={a.level} /><DemoBadge show={a.is_simulated} /></span></td>
                  <td className="td">#{a.zone_id}</td>
                  <td className="td">{a.waste_count_at_trigger} / {a.threshold_value}</td>
                  <td className="td text-slate-500">{new Date(a.triggered_at).toLocaleString("fr-FR")}</td>
                  <td className="td"><AlertStatusBadge status={a.status} /></td>
                  <td className="td">
                    {a.status === "open" && (
                      <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => ack(a.id)}>
                        Prendre en compte
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
