import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../theme.dart';
import '../widgets/common.dart';

class StatsScreen extends StatefulWidget {
  const StatsScreen({super.key});
  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  List<DailyCount> _series = [];
  Overview? _ov;
  bool _loading = true;
  String? _error;
  int _days = 14;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final api = ApiService(context.read<AuthService>().token);
      final s = await api.series(days: _days);
      final ov = await api.overview();
      setState(() {
        _series = s;
        _ov = ov;
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _error = "Statistiques indisponibles.";
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Statistiques"),
        actions: [
          PopupMenuButton<int>(
            onSelected: (d) {
              setState(() => _days = d);
              _load();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 7, child: Text("7 jours")),
              PopupMenuItem(value: 14, child: Text("14 jours")),
              PopupMenuItem(value: 30, child: Text("30 jours")),
            ],
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text("$_days j", style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
          ),
        ],
      ),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    const Text("Évolution des nouveaux déchets",
                        style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 12),
                    SizedBox(height: 220, child: _buildChart()),
                    const SizedBox(height: 20),
                    if (_ov != null) ...[
                      const Text("Déchets présents par catégorie",
                          style: TextStyle(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      ..._ov!.wasteByCategory.entries.map((e) => Card(
                            child: ListTile(
                              dense: true,
                              title: Text(e.key),
                              trailing: Text("${e.value}",
                                  style: const TextStyle(fontWeight: FontWeight.bold)),
                            ),
                          )),
                      if (_ov!.wasteByCategory.isEmpty)
                        const Card(
                          child: Padding(
                            padding: EdgeInsets.all(16),
                            child: Text("Aucun déchet présent actuellement."),
                          ),
                        ),
                    ],
                  ],
                ),
    );
  }

  Widget _buildChart() {
    if (_series.isEmpty) return const Center(child: Text("Pas de données."));
    final spots = <FlSpot>[];
    for (var i = 0; i < _series.length; i++) {
      spots.add(FlSpot(i.toDouble(), _series[i].newWaste.toDouble()));
    }
    return LineChart(
      LineChartData(
        gridData: const FlGridData(show: true),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 28)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              interval: (_series.length / 4).ceilToDouble(),
              getTitlesWidget: (v, _) {
                final i = v.toInt();
                if (i < 0 || i >= _series.length) return const SizedBox.shrink();
                return Text(_series[i].day.substring(5),
                    style: const TextStyle(fontSize: 9));
              },
            ),
          ),
        ),
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            color: AppColors.warn,
            barWidth: 3,
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(show: true, color: AppColors.warn.withOpacity(0.1)),
          ),
        ],
      ),
    );
  }
}
