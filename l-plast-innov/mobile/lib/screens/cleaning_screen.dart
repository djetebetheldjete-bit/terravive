import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../theme.dart';
import '../widgets/common.dart';

const _statusLabel = {
  "pending": "En attente",
  "in_progress": "En cours",
  "done": "Effectué",
  "awaiting_verification": "À vérifier",
  "verified": "Vérifié",
  "to_redo": "À reprendre",
};

class CleaningScreen extends StatefulWidget {
  const CleaningScreen({super.key});
  @override
  State<CleaningScreen> createState() => _CleaningScreenState();
}

class _CleaningScreenState extends State<CleaningScreen> {
  List<CleaningOp> _ops = [];
  Map<int, String> _zoneNames = {};
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
      final ops = await api.cleaning();
      final zones = await api.zones();
      setState(() {
        _ops = ops;
        _zoneNames = {for (final z in zones) z.id: z.name};
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _error = "Opérations indisponibles.";
        _loading = false;
      });
    }
  }

  Color _statusColor(String s) {
    if (s == "verified") return AppColors.eco;
    if (s == "to_redo") return AppColors.danger;
    if (s == "in_progress") return AppColors.ocean;
    return AppColors.warn;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Opérations de nettoyage")),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : _ops.isEmpty
                  ? const Center(child: Text("Aucune opération de nettoyage."))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _ops.length,
                        itemBuilder: (_, i) {
                          final o = _ops[i];
                          return Card(
                            child: ListTile(
                              leading: Icon(Icons.cleaning_services, color: _statusColor(o.status)),
                              title: Text(_zoneNames[o.zoneId] ?? "Zone #${o.zoneId}"),
                              subtitle: Text(
                                "Statut : ${_statusLabel[o.status] ?? o.status}"
                                "${o.reportedRemovedCount != null ? " · ${o.reportedRemovedCount} retirés" : ""}",
                              ),
                              trailing: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: _statusColor(o.status).withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(_statusLabel[o.status] ?? o.status,
                                    style: TextStyle(fontSize: 11, color: _statusColor(o.status))),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
