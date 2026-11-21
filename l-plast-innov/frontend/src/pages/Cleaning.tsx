import { useEffect, useState } from "react";
import { api } from "../api/client";
import { DemoBadge, ErrorNote, Spinner } from "../components/ui";
import type { CleaningOp, Zone } from "../types";

const STATUS_LABEL: Record<string, string> = {
  pending: "En attente",
  in_progress: "En cours",
  done: "Effectué",
  awaiting_verification: "À vérifier",
  verified: "Vérifié",
  to_redo: "À reprendre",
};

export default function Cleaning() {
  const [ops, setOps] = useState<CleaningOp[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [newZone, setNewZone] = useState<number | "">("");

  const load = () =>
    Promise.all([api.get<CleaningOp[]>("/api/v1/cleaning"), api.get<Zone[]>("/api/v1/zones")])
      .then(([o, z]) => {
        setOps(o.data);
        setZones(z.data);
      })
      .catch(() => setErr("Chargement impossible."));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!newZone) return;
    await api.post("/api/v1/cleaning", { zone_id: newZone, notes: "Créée depuis l'administration" });
    setNewZone("");
    await load();
  };

  const setStatus = async (id: number, status: string) => {
    await api.patch(`/api/v1/cleaning/${id}/status`, { status });
    await load();
  };

  const verify = async (id: number, confirmed: boolean) => {
    await api.post(`/api/v1/cleaning/${id}/verify`, { confirmed });
    await load();
  };

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (zones.length === 0) return <Spinner />;

  const zoneName = (id: number) => zones.find((z) => z.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Opérations de nettoyage</h1>

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm text-slate-600">Nouvelle intervention — zone</label>
          <select className="input !w-auto" value={newZone} onChange={(e) => setNewZone(e.target.value ? +e.target.value : "")}>
            <option value="">Choisir une zone…</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name} ({z.present_waste_count} présents)</option>
            ))}
          </select>
        </div>
        <button className="btn-eco" onClick={create} disabled={!newZone}>Créer l'intervention</button>
      </div>

      {ops.length === 0 ? (
        <div className="card text-sm text-slate-500">Aucune opération enregistrée.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">#</th>
                <th className="th">Zone</th>
                <th className="th">Statut</th>
                <th className="th">Retirés</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ops.map((o) => (
                <tr key={o.id}>
                  <td className="td">{o.id}</td>
                  <td className="td"><span className="flex items-center gap-2">{zoneName(o.zone_id)} <DemoBadge show={o.is_simulated} /></span></td>
                  <td className="td">{STATUS_LABEL[o.status] ?? o.status}</td>
                  <td className="td">{o.reported_removed_count ?? "—"}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-2">
                      {o.status === "pending" && (
                        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setStatus(o.id, "in_progress")}>Démarrer</button>
                      )}
                      {(o.status === "in_progress" || o.status === "done" || o.status === "to_redo") && (
                        <>
                          <button className="btn-eco !py-1 !px-2 text-xs" onClick={() => verify(o.id, true)} title="Confirme le nettoyage et retire les déchets du stock présent">
                            Vérifier ✓
                          </button>
                          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => verify(o.id, false)}>À reprendre</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Une zone n'est jamais déclarée propre automatiquement : la vérification confirme le nettoyage
        et retire les déchets du stock « présents » (ils restent dans l'historique).
      </p>
    </div>
  );
}
