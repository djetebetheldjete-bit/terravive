/// Configuration de l'application mobile.
class AppConfig {
  /// URL de base de l'API L-PLAST-INNOV.
  ///
  /// - Émulateur Android : http://10.0.2.2:8000
  /// - Appareil physique : http://ADRESSE-IP-DU-SERVEUR:8000
  /// - Production : https://api.l-plast-innov.ci
  ///
  /// Surchargable au lancement :
  ///   flutter run --dart-define=API_BASE=http://10.0.2.2:8000
  static const String apiBase = String.fromEnvironment(
    "API_BASE",
    defaultValue: "http://10.0.2.2:8000",
  );

  static const String appName = "Macro Plastique Balmer";
  static const String projectName = "L-PLAST-INNOV";
}
