import { useState } from "react";
import { api } from "../api/client";
import { ErrorNote } from "../components/ui";
import type { DailyCount } from "../types";

function toCSV(rows: DailyCount[]): string {
  const header = "jour,presents,nouveaux,detections,retires";
  const lines = rows.map(
    (r) => `${r.day},${r.present_now},${r.new_waste},${r.total_detections},${r.removed}`,
  );
  return [header, ...lines].join("\n");
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<DailyCount[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setErr(null);
    setLoading(true);
    try {
      const { data } = await api.get<DailyCount[]>(`/api/v1/stats/series?days=${days}`);
      setRows(data);
    } catch {
      setErr("Génération impossible.");
    } finally {
      setLoading(false);
    }
  };

  const totals = rows.reduce(
    (acc, r) => ({
      nouveaux: acc.nouveaux + r.new_waste,
      detections: acc.detections + r.total_detections,
      retires: acc.retires + r.removed,
    }),
    { nouveaux: 0, detections: 0, retires: 0 },
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Rapports</h1>

      <div className="card flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="mb-1 block text-sm text-slate-600">Période (jours)</label>
          <select className="input !w-auto" value={days} onChange={(e) => setDays(+e.target.value)}>
            <option value={7}>7 jours</option>
            <option value={30}>30 jours</option>
            <option value={90}>90 jours</option>
          </select>
        </div>
        <button className="btn-primary" onClick={generate} disabled={loading}>
          {loading ? "Génération…" : "Générer"}
        </button>
        {rows.length > 0 && (
          <>
            <button className="btn-ghost" onClick={() => download(`rapport-${days}j.csv`, toCSV(rows), "text/csv")}>
              Exporter CSV
            </button>
            <button className="btn-ghost" onClick={() => window.print()}>
              Exporter PDF (impression)
            </button>
          </>
        )}
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}

      {rows.length > 0 && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Rapport des {days} derniers jours</h2>
            <span className="text-xs text-slate-400">Fuseau Africa/Abidjan</span>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-warn/10 p-3">
              <div className="text-2xl font-bold text-warn">{totals.nouveaux}</div>
              <div className="text-xs text-slate-500">Nouveaux déchets</div>
            </div>
            <div className="rounded-lg bg-eco/10 p-3">
              <div className="text-2xl font-bold text-eco-dark">{totals.retires}</div>
              <div className="text-xs text-slate-500">Déchets retirés</div>
            </div>
            <div className="rounded-lg bg-ocean/10 p-3">
              <div className="text-2xl font-bold text-ocean-dark">{totals.detections}</div>
              <div className="text-xs text-slate-500">Détections</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Jour</th>
                  <th className="th">Présents</th>
                  <th className="th">Nouveaux</th>
                  <th className="th">Détections</th>
                  <th className="th">Retirés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.day}>
                    <td className="td">{r.day}</td>
                    <td className="td">{r.present_now}</td>
                    <td className="td">{r.new_waste}</td>
                    <td className="td">{r.total_detections}</td>
                    <td className="td">{r.removed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
