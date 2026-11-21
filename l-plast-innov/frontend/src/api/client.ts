import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE || "";

export const api = axios.create({ baseURL });

// Injecte le jeton JWT dans chaque requête.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("lplast_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Déconnexion automatique si le jeton est invalide/expiré.
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("lplast_token");
      localStorage.removeItem("lplast_role");
      if (!location.pathname.includes("/login")) {
        location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export async function login(email: string, password: string) {
  // OAuth2 password flow : champ "username".
  const form = new URLSearchParams();
  form.set("username", email);
  form.set("password", password);
  const { data } = await api.post("/api/v1/auth/login", form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  localStorage.setItem("lplast_token", data.access_token);
  localStorage.setItem("lplast_role", data.role);
  return data;
}

export function logout() {
  localStorage.removeItem("lplast_token");
  localStorage.removeItem("lplast_role");
}

export function currentRole(): string | null {
  return localStorage.getItem("lplast_role");
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem("lplast_token");
}
