import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config.dart';
import '../services/auth_service.dart';
import '../theme.dart';
import 'login_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _subPreventive = true;
  bool _subCritical = true;
  bool _locationConsent = false;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();

    return Scaffold(
      appBar: AppBar(title: const Text("Profil")),
      body: auth.isLoggedIn ? _loggedIn(auth) : _loggedOut(),
    );
  }

  Widget _loggedOut() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.account_circle, size: 72, color: AppColors.ocean),
            const SizedBox(height: 12),
            const Text("Rejoignez la mobilisation citoyenne",
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
            const SizedBox(height: 6),
            const Text(
              "Connectez-vous pour vous abonner aux alertes de votre plage et suivre les nettoyages.",
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              ),
              child: const Text("Se connecter / Créer un compte"),
            ),
          ],
        ),
      ),
    );
  }

  Widget _loggedIn(AuthService auth) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: ListTile(
            leading: const CircleAvatar(
              backgroundColor: AppColors.ocean,
              child: Icon(Icons.person, color: Colors.white),
            ),
            title: Text(auth.email ?? "Utilisateur"),
            subtitle: Text("Rôle : ${_roleLabel(auth.role)}"),
          ),
        ),
        const SizedBox(height: 12),
        const Text("Préférences d'alertes", style: TextStyle(fontWeight: FontWeight.bold)),
        Card(
          child: Column(
            children: [
              SwitchListTile(
                title: const Text("Alertes préventives (🟠)"),
                value: _subPreventive,
                onChanged: (v) => setState(() => _subPreventive = v),
              ),
              SwitchListTile(
                title: const Text("Alertes critiques (🔴)"),
                value: _subCritical,
                onChanged: (v) => setState(() => _subCritical = v),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        const Text("Confidentialité", style: TextStyle(fontWeight: FontWeight.bold)),
        Card(
          child: SwitchListTile(
            title: const Text("Géolocalisation (facultative)"),
            subtitle: const Text(
                "Utilisée uniquement pour vous proposer les zones proches. Jamais partagée publiquement."),
            value: _locationConsent,
            onChanged: (v) => setState(() => _locationConsent = v),
          ),
        ),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          onPressed: () => auth.logout(),
          icon: const Icon(Icons.logout),
          label: const Text("Se déconnecter"),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _confirmDelete,
          child: const Text("Supprimer mon compte", style: TextStyle(color: AppColors.danger)),
        ),
        const SizedBox(height: 24),
        const Center(
          child: Text("${AppConfig.projectName} · Macro Plastique Balmer",
              style: TextStyle(fontSize: 11, color: Color(0xFF94A3B8))),
        ),
      ],
    );
  }

  void _confirmDelete() {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text("Supprimer le compte"),
        content: const Text(
          "La suppression de votre compte efface vos préférences et vos abonnements. "
          "Procédure conforme à la protection des données personnelles. Confirmer ?",
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text("Annuler")),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () {
              Navigator.pop(context);
              // TODO : appeler l'endpoint de suppression côté backend
              // (DELETE /api/v1/users/me) une fois exposé.
              context.read<AuthService>().logout();
            },
            child: const Text("Supprimer"),
          ),
        ],
      ),
    );
  }

  String _roleLabel(String? r) {
    switch (r) {
      case "admin":
        return "Administrateur";
      case "cleaner":
        return "Responsable nettoyage";
      default:
        return "Visiteur";
    }
  }
}
