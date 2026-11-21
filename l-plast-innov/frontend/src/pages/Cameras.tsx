import { useEffect, useState } from "react";
import { api } from "../api/client";
import { CameraBadge, DemoBadge, ErrorNote, Spinner } from "../components/ui";
import type { Camera } from "../types";

export default function Cameras() {
  const [cams, setCams] = useState<Camera[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Camera[]>("/api/v1/cameras")
      .then((r) => setCams(r.data))
      .catch(() => setErr("Chargement impossible."));
  }, []);

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (cams.length === 0) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Caméras (CamSCA)</h1>
      <div className="card overflow-x-auto p-0">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Code</th>
              <th className="th">Nom</th>
              <th className="th">État</th>
              <th className="th">Zone</th>
              <th className="th">Dernière transmission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cams.map((c) => (
              <tr key={c.id}>
                <td className="td font-mono">{c.code}</td>
                <td className="td">
                  <span className="flex items-center gap-2">{c.name} <DemoBadge show={c.is_simulated} /></span>
                </td>
                <td className="td"><CameraBadge status={c.status} /></td>
                <td className="td">{c.zone_id ?? "—"}</td>
                <td className="td text-slate-500">
                  {c.last_seen_at ? new Date(c.last_seen_at).toLocaleString("fr-FR") : "jamais"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
