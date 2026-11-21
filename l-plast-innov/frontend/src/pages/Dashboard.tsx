import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { ErrorNote, Spinner, StatCard } from "../components/ui";
import type { DailyCount, DashboardOverview } from "../types";

export default function Dashboard() {
  const [ov, setOv] = useState<DashboardOverview | null>(null);
  const [series, setSeries] = useState<DailyCount[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<DashboardOverview>("/api/v1/stats/overview"),
      api.get<DailyCount[]>("/api/v1/stats/series?days=14"),
    ])
      .then(([o, s]) => {
        setOv(o.data);
        setSeries(s.data);
      })
      .catch(() => setErr("Impossible de charger les statistiques. Le backend est-il démarré ?"));
  }, []);

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!ov) return <Spinner />;

  const catData = Object.entries(ov.waste_by_category).map(([code, n]) => ({
    code,
    n,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Tableau de bord</h1>
        <p className="text-sm text-slate-500">
          Fuseau {ov.timezone} · mis à jour {new Date(ov.as_of).toLocaleString("fr-FR")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Déchets présents" value={ov.present_waste} accent="danger" hint="déchets uniques actuellement sur la plage" />
        <StatCard label="Nouveaux aujourd'hui" value={ov.new_waste_today} accent="warn" />
        <StatCard label="Retirés aujourd'hui" value={ov.removed_today} accent="eco" />
        <StatCard label="Détections (jour)" value={ov.total_detections_today} accent="ocean" hint="événements, un déchet peut compter plusieurs fois" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Zones surveillées" value={ov.zones_total} accent="slate" />
        <StatCard label="Zones en alerte" value={ov.zones_alert} accent="danger" />
        <StatCard label="Caméras actives" value={ov.cameras_active} accent="eco" />
        <StatCard label="Caméras hors ligne" value={ov.cameras_offline} accent="slate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Évolution sur 14 jours
          </h2>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="new_waste" name="Nouveaux" stroke="#ea580c" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="removed" name="Retirés" stroke="#15803d" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="total_detections" name="Détections" stroke="#0369a1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Déchets présents par catégorie
          </h2>
          <div className="h-64">
            {catData.length === 0 ? (
              <p className="p-6 text-sm text-slate-400">Aucun déchet présent actuellement.</p>
            ) : (
              <ResponsiveContainer>
                <BarChart data={catData} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="code" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="n" name="Présents" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
