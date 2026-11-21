import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@l-plast-innov.ci");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError("E-mail ou mot de passe incorrect.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ocean/10 via-slate-50 to-eco/10 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-eco to-ocean text-2xl text-white">
            ♻️
          </div>
          <h1 className="text-2xl font-bold text-slate-800">L-PLAST-INNOV</h1>
          <p className="text-sm text-slate-500">
            Surveillance des déchets plastiques — Plage de Balmer
          </p>
        </div>
        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">E-mail</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">Mot de passe</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
          <p className="text-center text-xs text-slate-400">
            Démo : admin@l-plast-innov.ci / mot de passe défini dans le .env du backend
          </p>
        </form>
      </div>
    </div>
  );
}
