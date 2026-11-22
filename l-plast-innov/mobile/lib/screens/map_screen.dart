import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../theme.dart';
import '../widgets/common.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});
  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  List<Zone> _zones = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final api = ApiService(context.read<AuthService>().token);
      final z = await api.zones();
      setState(() {
        _zones = z;
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _error = "Chargement de la carte impossible.";
        _loading = false;
      });
    }
  }

  List<LatLng> _polygon(Zone z) {
    if (z.geojson == null) return [];
    try {
      final g = jsonDecode(z.geojson!);
      final ring = (g["coordinates"][0] as List);
      return ring.map<LatLng>((c) => LatLng(c[1].toDouble(), c[0].toDouble())).toList();
    } catch (_) {
      return [];
    }
  }

  LatLng get _center {
    final withCoords = _zones.where((z) => z.centerLat != null).toList();
    if (withCoords.isEmpty) return const LatLng(4.748, -6.638); // San Pedro (DEMO)
    final lat = withCoords.map((z) => z.centerLat!).reduce((a, b) => a + b) / withCoords.length;
    final lon = withCoords.map((z) => z.centerLon!).reduce((a, b) => a + b) / withCoords.length;
    return LatLng(lat, lon);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Carte des zones")),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : Column(
                  children: [
                    if (_zones.any((z) => z.isSimulated))
                      Container(
                        width: double.infinity,
                        color: const Color(0xFFF3E8FF),
                        padding: const EdgeInsets.all(8),
                        child: const Text(
                          "⚠️ Coordonnées de DÉMONSTRATION (non officielles).",
                          style: TextStyle(fontSize: 12, color: Color(0xFF7E22CE)),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    Expanded(
                      child: FlutterMap(
                        options: MapOptions(initialCenter: _center, initialZoom: 16),
                        children: [
                          TileLayer(
                            urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                            userAgentPackageName: "ci.lplastinnov.balmer",
                          ),
                          PolygonLayer(
                            polygons: _zones.map((z) {
                              final c = zoneColor(z.status);
                              return Polygon(
                                points: _polygon(z),
                                color: c.withOpacity(0.25),
                                borderColor: c,
                                borderStrokeWidth: 2,
                              );
                            }).where((p) => p.points.isNotEmpty).toList(),
                          ),
                          MarkerLayer(
                            markers: _zones
                                .where((z) => z.centerLat != null)
                                .map((z) => Marker(
                                      point: LatLng(z.centerLat!, z.centerLon!),
                                      width: 90,
                                      height: 44,
                                      child: _ZoneMarker(zone: z),
                                    ))
                                .toList(),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _ZoneMarker extends StatelessWidget {
  final Zone zone;
  const _ZoneMarker({required this.zone});
  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: zoneColor(zone.status),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text("${zone.code} · ${zone.presentWasteCount}",
              style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
        ),
        Icon(Icons.place, color: zoneColor(zone.status), size: 20),
      ],
    );
  }
}
