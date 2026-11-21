import { useEffect, useState } from "react";
import { api, currentRole } from "../api/client";
import { DemoBadge, ErrorNote, Spinner, ZoneBadge } from "../components/ui";
import type { Zone } from "../types";

export default function Zones() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Zone | null>(null);
  const role = currentRole();

  const load = () =>
    api
      .get<Zone[]>("/api/v1/zones")
      .then((r) => setZones(r.data))
      .catch(() => setErr("Chargement impossible."));

  useEffect(() => {
    load();
  }, []);

  const surge = async (code: string) => {
    await api.post("/api/v1/simulation/surge", { zone_code: code, count: 12 });
    await load();
  };

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (zones.length === 0) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Zones de surveillance</h1>

      <div className="card overflow-x-auto p-0">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Code</th>
              <th className="th">Nom</th>
              <th className="th">État</th>
              <th className="th">Présents</th>
              <th className="th">Seuils (prév. / crit.)</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {zones.map((z) => (
              <tr key={z.id}>
                <td className="td font-mono">{z.code}</td>
                <td className="td">
                  <span className="flex items-center gap-2">{z.name} <DemoBadge show={z.is_simulated} /></span>
                </td>
                <td className="td"><ZoneBadge status={z.status} /></td>
                <td className="td font-semibold">{z.present_waste_count}</td>
                <td className="td">
                  {z.threshold ? `${z.threshold.preventive} / ${z.threshold.critical}` : "—"}
                </td>
                <td className="td">
                  <div className="flex gap-2">
                    {role === "admin" && (
                      <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEdit(z)}>
                        Seuils
                      </button>
                    )}
                    <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => surge(z.code)} title="Injecter 12 déchets de démonstration">
                      + Simuler
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && <ThresholdModal zone={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ThresholdModal({ zone, onClose, onSaved }: { zone: Zone; onClose: () => void; onSaved: () => void }) {
  const [prev, setPrev] = useState(zone.threshold?.preventive ?? 10);
  const [crit, setCrit] = useState(zone.threshold?.critical ?? 20);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    try {
      await api.put(`/api/v1/zones/${zone.code}/threshold`, { preventive: prev, critical: crit });
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Erreur à l'enregistrement.");
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm card space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Seuils — {zone.name}</h2>
        <div>
          <label className="mb-1 block text-sm text-slate-600">Seuil préventif (orange)</label>
          <input className="input" type="number" min={1} value={prev} onChange={(e) => setPrev(+e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600">Seuil critique (rouge)</label>
          <input className="input" type="number" min={1} value={crit} onChange={(e) => setCrit(+e.target.value)} />
        </div>
        {err && <ErrorNote>{err}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={save}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
