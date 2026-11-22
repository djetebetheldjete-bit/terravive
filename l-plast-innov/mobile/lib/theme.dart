import 'package:flutter/material.dart';

/// Identité visuelle : vert (environnement), bleu (océan), orange (préventif),
/// rouge (critique), blanc.
class AppColors {
  static const ocean = Color(0xFF0369A1);
  static const oceanLight = Color(0xFF0EA5E9);
  static const eco = Color(0xFF15803D);
  static const ecoLight = Color(0xFF22C55E);
  static const warn = Color(0xFFEA580C); // alerte préventive
  static const danger = Color(0xFFDC2626); // alerte critique
  static const bg = Color(0xFFF8FAFC);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.ocean,
    primary: AppColors.ocean,
    secondary: AppColors.eco,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.bg,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: Color(0xFF1E293B),
      elevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardTheme(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
    ),
  );
}

/// Couleur associée au statut d'une zone.
Color zoneColor(String status) {
  switch (status) {
    case "clean":
      return AppColors.eco;
    case "monitored":
      return AppColors.warn;
    case "alert":
      return AppColors.danger;
    default:
      return Colors.grey;
  }
}

String zoneLabel(String status) {
  switch (status) {
    case "clean":
      return "Propre";
    case "monitored":
      return "En surveillance";
    case "alert":
      return "En alerte";
    default:
      return "Désactivée";
  }
}
