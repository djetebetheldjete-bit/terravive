import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../theme.dart';
import '../widgets/common.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Overview? _ov;
  List<Alert> _alerts = [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ApiService(context.read<AuthService>().token);
      final ov = await api.overview();
      final al = await api.alerts(openOnly: true);
      setState(() {
        _ov = ov;
        _alerts = al;
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _error = "Impossible de contacter le serveur (${AppConfig.apiBase}).";
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(
          children: [
            const Text("♻️ ", style: TextStyle(fontSize: 20)),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text("Macro Plastique Balmer",
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                Text(AppConfig.projectName,
                    style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8))),
              ],
            ),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const LoadingView()
            : _error != null
                ? ListView(children: [
                    const SizedBox(height: 120),
                    ErrorView(message: _error!, onRetry: _load),
                  ])
                : _buildContent(),
      ),
    );
  }

  Widget _buildContent() {
    final ov = _ov!;
    final beachOk = ov.zonesAlert == 0;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: beachOk ? AppColors.eco : AppColors.danger,
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Row(
              children: [
                Icon(beachOk ? Icons.check_circle : Icons.warning_amber_rounded,
                    color: Colors.white, size: 36),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        beachOk ? "Plage sous surveillance, aucune alerte" : "${ov.zonesAlert} zone(s) en alerte",
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 4),
                      Text("${ov.presentWaste} déchets actuellement détectés",
                          style: const TextStyle(color: Colors.white70)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.5,
          children: [
            StatCard(label: "Déchets présents", value: "${ov.presentWaste}", color: AppColors.danger, icon: Icons.delete_outline),
            StatCard(label: "Nouveaux aujourd'hui", value: "${ov.newWasteToday}", color: AppColors.warn, icon: Icons.add_circle_outline),
            StatCard(label: "Retirés aujourd'hui", value: "${ov.removedToday}", color: AppColors.eco, icon: Icons.recycling),
            StatCard(label: "Zones en alerte", value: "${ov.zonesAlert}", color: AppColors.ocean, icon: Icons.location_on_outlined),
          ],
        ),
        const SizedBox(height: 16),
        const Text("Alertes importantes",
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        if (_alerts.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text("Aucune alerte en cours. Merci de préserver la plage 🌊"),
            ),
          )
        else
          ..._alerts.take(5).map((a) => Card(
                child: ListTile(
                  leading: Text(a.level == "critical" ? "🔴" : "🟠", style: const TextStyle(fontSize: 22)),
                  title: Text(a.message ?? "Alerte zone #${a.zoneId}"),
                  subtitle: Text("${a.wasteCountAtTrigger} déchets · seuil ${a.thresholdValue}"),
                  trailing: DemoChip(show: a.isSimulated),
                ),
              )),
      ],
    );
  }
}
