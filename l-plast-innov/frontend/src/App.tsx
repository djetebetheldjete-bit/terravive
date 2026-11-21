import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { isAuthenticated } from "./api/client";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import MapPage from "./pages/MapPage";
import Zones from "./pages/Zones";
import Cameras from "./pages/Cameras";
import Alerts from "./pages/Alerts";
import Cleaning from "./pages/Cleaning";
import Users from "./pages/Users";
import Reports from "./pages/Reports";

function Protected({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/carte" element={<Protected><MapPage /></Protected>} />
      <Route path="/zones" element={<Protected><Zones /></Protected>} />
      <Route path="/cameras" element={<Protected><Cameras /></Protected>} />
      <Route path="/alertes" element={<Protected><Alerts /></Protected>} />
      <Route path="/nettoyage" element={<Protected><Cleaning /></Protected>} />
      <Route path="/utilisateurs" element={<Protected><Users /></Protected>} />
      <Route path="/rapports" element={<Protected><Reports /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
