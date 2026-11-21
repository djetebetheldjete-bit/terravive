import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { currentRole, logout } from "../api/client";

const NAV = [
  { to: "/", label: "Tableau de bord", icon: "📊" },
  { to: "/carte", label: "Carte", icon: "🗺️" },
  { to: "/zones", label: "Zones", icon: "📍" },
  { to: "/cameras", label: "Caméras", icon: "📷" },
  { to: "/alertes", label: "Alertes", icon: "🚨" },
  { to: "/nettoyage", label: "Nettoyage", icon: "🧹" },
  { to: "/utilisateurs", label: "Utilisateurs", icon: "👥", adminOnly: true },
  { to: "/rapports", label: "Rapports", icon: "📄" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const role = currentRole();
  const [open, setOpen] = useState(false);

  const items = NAV.filter((n) => !n.adminOnly || role === "admin");

  const doLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen lg:flex">
      {/* Barre latérale */}
      <aside
        className={`${
          open ? "block" : "hidden"
        } border-r border-slate-200 bg-white lg:block lg:w-64 lg:shrink-0`}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-eco to-ocean text-white">
            ♻️
          </div>
          <div>
            <div className="text-sm font-bold leading-tight text-slate-800">L-PLAST-INNOV</div>
            <div className="text-[11px] text-slate-400">Plage de Balmer</div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-ocean/10 text-ocean-dark" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <span>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <button
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            ☰
          </button>
          <div className="text-sm text-slate-500">
            Rôle : <span className="font-semibold text-slate-700">{role ?? "—"}</span>
          </div>
          <button className="btn-ghost" onClick={doLogout}>
            Déconnexion
          </button>
        </header>
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
