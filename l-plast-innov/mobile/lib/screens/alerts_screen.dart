import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../theme.dart';
import '../widgets/common.dart';

class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});
  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  List<Alert> _alerts = [];
  bool _loading = true;
  String? _error;
  bool _openOnly = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final api = ApiService(context.read<AuthService>().token);
      final a = await api.alerts(openOnly: _openOnly);
      setState(() {
        _alerts = a;
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _error = "Alertes indisponibles.";
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat("dd/MM/yyyy HH:mm");
    return Scaffold(
      appBar: AppBar(
        title: const Text("Alertes"),
        actions: [
          Row(
            children: [
              const Text("En cours", style: TextStyle(fontSize: 12)),
              Switch(
                value: _openOnly,
                onChanged: (v) {
                  setState(() => _openOnly = v);
                  _load();
                },
              ),
            ],
          ),
        ],
      ),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : _alerts.isEmpty
                  ? const Center(child: Text("Aucune alerte."))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _alerts.length,
                        itemBuilder: (_, i) {
                          final a = _alerts[i];
                          final critical = a.level == "critical";
                          return Card(
                            child: ListTile(
                              leading: CircleAvatar(
                                backgroundColor:
                                    (critical ? AppColors.danger : AppColors.warn).withOpacity(0.15),
                                child: Text(critical ? "🔴" : "🟠"),
                              ),
                              title: Row(
                                children: [
                                  Expanded(
                                    child: Text(critical ? "Alerte critique" : "Alerte préventive",
                                        style: const TextStyle(fontWeight: FontWeight.bold)),
                                  ),
                                  DemoChip(show: a.isSimulated),
                                ],
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(a.message ?? "Zone #${a.zoneId}"),
                                  const SizedBox(height: 2),
                                  Text(
                                    "${fmt.format(a.triggeredAt.toLocal())} · statut : ${a.status}",
                                    style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
