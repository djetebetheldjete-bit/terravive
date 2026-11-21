import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ErrorNote, Spinner } from "../components/ui";
import type { UserOut } from "../types";

const ROLES = ["visitor", "cleaner", "admin"];
const ROLE_LABEL: Record<string, string> = {
  visitor: "Visiteur",
  cleaner: "Responsable nettoyage",
  admin: "Administrateur",
};

export default function Users() {
  const [users, setUsers] = useState<UserOut[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    api
      .get<UserOut[]>("/api/v1/users")
      .then((r) => setUsers(r.data))
      .catch((e) =>
        setErr(e?.response?.status === 403 ? "Réservé aux administrateurs." : "Chargement impossible."),
      );

  useEffect(() => {
    load();
  }, []);

  const changeRole = async (id: number, role_name: string) => {
    await api.put(`/api/v1/users/${id}/role`, { role_name });
    await load();
  };

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (users.length === 0) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Utilisateurs</h1>
      <div className="card overflow-x-auto p-0">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">E-mail</th>
              <th className="th">Nom</th>
              <th className="th">Rôle</th>
              <th className="th">Actif</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td">{u.email}</td>
                <td className="td">{u.full_name ?? "—"}</td>
                <td className="td">
                  <select
                    className="input !w-auto !py-1"
                    value={u.role_name}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </td>
                <td className="td">{u.is_active ? "✅" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
