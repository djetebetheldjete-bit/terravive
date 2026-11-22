import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'services/auth_service.dart';
import 'theme.dart';
import 'screens/home_screen.dart';
import 'screens/map_screen.dart';
import 'screens/stats_screen.dart';
import 'screens/alerts_screen.dart';
import 'screens/cleaning_screen.dart';
import 'screens/profile_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final auth = AuthService();
  await auth.loadSession();
  // Pour activer les push : await NotificationsService.init();
  runApp(
    ChangeNotifierProvider.value(value: auth, child: const MacroPlastiqueApp()),
  );
}

class MacroPlastiqueApp extends StatelessWidget {
  const MacroPlastiqueApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "Macro Plastique Balmer",
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const RootShell(),
    );
  }
}

/// Coquille principale avec barre de navigation inférieure (6 onglets).
class RootShell extends StatefulWidget {
  const RootShell({super.key});
  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  int _index = 0;

  final _screens = const [
    HomeScreen(),
    MapScreen(),
    StatsScreen(),
    AlertsScreen(),
    CleaningScreen(),
    ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: _screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: "Accueil"),
          NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: "Carte"),
          NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart), label: "Stats"),
          NavigationDestination(icon: Icon(Icons.notifications_outlined), selectedIcon: Icon(Icons.notifications), label: "Alertes"),
          NavigationDestination(icon: Icon(Icons.cleaning_services_outlined), selectedIcon: Icon(Icons.cleaning_services), label: "Nettoyage"),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: "Profil"),
        ],
      ),
    );
  }
}
