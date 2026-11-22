# Macro Plastique Balmer — application mobile (Flutter)

Application citoyenne d'information, d'alertes et de mobilisation contre les
déchets plastiques de la plage de Balmer. Se connecte à l'API L-PLAST-INNOV.

## ⚠️ À lire avant de lancer

Ce dossier contient le **code source** de l'application (`lib/`), son `pubspec.yaml`
et sa configuration. Les dossiers de plateforme (`android/`, `ios/`, …) ne sont
**pas** versionnés : ils se régénèrent avec Flutter. Le code n'a **pas pu être
compilé dans l'environnement cloud de développement** (le SDK Flutter n'y est pas
installé) ; il doit être lancé sur une machine équipée de Flutter.

## Lancer l'application

Prérequis : [Flutter SDK](https://docs.flutter.dev/get-started/install) (3.3+).

```bash
cd mobile
flutter create .            # régénère android/ ios/ (garde lib/ et pubspec.yaml)
flutter pub get
# Backend accessible : émulateur Android => http://10.0.2.2:8000
flutter run --dart-define=API_BASE=http://10.0.2.2:8000
```

## Écrans (6 onglets)

1. **Accueil** — état de la plage, nombre de déchets, alertes, accès rapide.
2. **Carte** — zones colorées par niveau de pollution (OpenStreetMap).
3. **Statistiques** — évolution (graphique) et répartition par catégorie.
4. **Alertes** — liste filtrable, date/heure, zone, gravité, statut.
5. **Nettoyage** — opérations et leurs statuts.
6. **Profil** — compte, rôles, abonnements, géolocalisation facultative,
   suppression de compte.

## Rôles

Visiteur / Responsable du nettoyage / Administrateur. Les droits sont appliqués
**côté serveur** : l'app n'expose pas les actions d'administration à un visiteur.

## Notifications push (Firebase Cloud Messaging)

Non activées par défaut (voir `lib/services/notifications_service.dart`). Pour
les activer :

```bash
dart pub global activate flutterfire_cli
flutterfire configure          # génère lib/firebase_options.dart
# décommenter firebase_core / firebase_messaging dans pubspec.yaml
flutter pub get
```

En l'absence de FCM configuré, l'app fonctionne en notifications **in-app**
(écran Alertes), sans prétendre envoyer des push.

## Identité visuelle

Vert (environnement), bleu (océan), orange (préventif), rouge (critique), blanc.
Interface en français.
