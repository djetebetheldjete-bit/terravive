/// Service de notifications push (Firebase Cloud Messaging).
///
/// ⚠️ Volontairement non branché par défaut : l'intégration FCM nécessite une
/// configuration Firebase propre au projet (fichiers google-services.json /
/// GoogleService-Info.plist générés par `flutterfire configure`). Tant que ce
/// n'est pas fait, l'app fonctionne en notifications « in-app » (via l'écran
/// Alertes), sans prétendre envoyer des push qui ne partiraient pas.
///
/// Étapes pour activer les push :
/// 1. Créer un projet Firebase et y ajouter les applications Android/iOS.
/// 2. `dart pub global activate flutterfire_cli && flutterfire configure`.
/// 3. Décommenter firebase_core / firebase_messaging dans pubspec.yaml.
/// 4. Décommenter le code ci-dessous et appeler `NotificationsService.init()`
///    depuis main().
/// 5. Transmettre le jeton d'appareil au backend
///    (POST /api/v1/notifications/subscribe — à exposer côté serveur).
class NotificationsService {
  static Future<void> init() async {
    // import 'package:firebase_core/firebase_core.dart';
    // import 'package:firebase_messaging/firebase_messaging.dart';
    //
    // await Firebase.initializeApp();
    // final messaging = FirebaseMessaging.instance;
    // await messaging.requestPermission();
    // final deviceToken = await messaging.getToken();
    // // Envoyer deviceToken au backend pour l'abonnement aux alertes.
    // FirebaseMessaging.onMessage.listen((message) {
    //   // Afficher une notification locale / mettre à jour l'écran Alertes.
    // });
  }
}
