import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polygon, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import { api } from "../api/client";
import { DemoBadge, ErrorNote, Spinner, ZoneBadge } from "../components/ui";
import type { Camera, Zone } from "../types";

// Correctif des icônes Leaflet par défaut (chemins cassés avec les bundlers).
const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const COLOR: Record<string, string> = {
  clean: "#15803d",
  monitored: "#ea580c",
  alert: "#dc2626",
  disabled: "#94a3b8",
};

function zonePolygon(z: Zone): [number, number][] | null {
  if (!z.geojson) return null;
  try {
    const g = JSON.parse(z.geojson);
    const ring = g?.coordinates?.[0];
    if (!ring) return null;
    // GeoJSON = [lon, lat] → Leaflet attend [lat, lon].
    return ring.map((c: [number, number]) => [c[1], c[0]]);
  } catch {
    return null;
  }
}

export default function MapPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<Zone[]>("/api/v1/zones"), api.get<Camera[]>("/api/v1/cameras")])
      .then(([z, c]) => {
        setZones(z.data);
        setCameras(c.data);
      })
      .catch(() => setErr("Impossible de charger la carte."));
  }, []);

  const center = useMemo<[number, number]>(() => {
    const withCoords = zones.filter((z) => z.center_lat && z.center_lon);
    if (withCoords.length === 0) return [4.748, -6.638]; // San Pedro (DEMO)
    const lat = withCoords.reduce((s, z) => s + (z.center_lat ?? 0), 0) / withCoords.length;
    const lon = withCoords.reduce((s, z) => s + (z.center_lon ?? 0), 0) / withCoords.length;
    return [lat, lon];
  }, [zones]);

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (zones.length === 0) return <Spinner label="Chargement de la carte…" />;

  const anyDemo = zones.some((z) => z.is_simulated);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Carte des zones</h1>
          <p className="text-sm text-slate-500">Couleur = niveau de pollution de la zone.</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full" style={{ background: COLOR.clean }} /> Propre</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full" style={{ background: COLOR.monitored }} /> Surveillance</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full" style={{ background: COLOR.alert }} /> Alerte</span>
        </div>
      </div>

      {anyDemo && (
        <div className="rounded-lg bg-purple-50 px-4 py-2 text-xs text-purple-700">
          ⚠️ Les coordonnées affichées sont des données de DÉMONSTRATION proches de San Pedro —
          elles ne constituent pas un relevé GPS officiel de la plage de Balmer.
        </div>
      )}

      <div className="card h-[70vh] p-2">
        <MapContainer center={center} zoom={16} scrollWheelZoom>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {zones.map((z) => {
            const poly = zonePolygon(z);
            const color = COLOR[z.status] ?? COLOR.disabled;
            return poly ? (
              <Polygon key={z.id} positions={poly} pathOptions={{ color, fillOpacity: 0.25 }}>
                <Popup>
                  <ZonePopup z={z} />
                </Popup>
              </Polygon>
            ) : null;
          })}
          {cameras
            .filter((c) => c.lat && c.lon)
            .map((c) => (
              <Marker key={c.id} position={[c.lat!, c.lon!]} icon={icon}>
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold">📷 {c.name}</div>
                    <div>Code : {c.code}</div>
                    <div>État : {c.status}</div>
                  </div>
                </Popup>
              </Marker>
            ))}
        </MapContainer>
      </div>
    </div>
  );
}

function ZonePopup({ z }: { z: Zone }) {
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        {z.name} <DemoBadge show={z.is_simulated} />
      </div>
      <div className="mb-1"><ZoneBadge status={z.status} /></div>
      <div>Déchets présents : <b>{z.present_waste_count}</b></div>
      {z.threshold && (
        <div className="text-xs text-slate-500">
          Seuils : préventif {z.threshold.preventive} / critique {z.threshold.critical}
        </div>
      )}
    </div>
  );
}
