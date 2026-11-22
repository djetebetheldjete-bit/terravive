import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import '../theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  bool _registerMode = false;
  bool _loading = false;
  String? _message;

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _message = null;
    });
    final auth = context.read<AuthService>();
    try {
      if (_registerMode) {
        final ok = await auth.register(_email.text.trim(), _password.text, _name.text.trim());
        if (!ok) {
          setState(() => _message = "Inscription impossible (e-mail déjà utilisé ?).");
        } else {
          final logged = await auth.login(_email.text.trim(), _password.text);
          if (logged && mounted) Navigator.pop(context);
        }
      } else {
        final ok = await auth.login(_email.text.trim(), _password.text);
        if (!ok) {
          setState(() => _message = "E-mail ou mot de passe incorrect.");
        } else if (mounted) {
          Navigator.pop(context);
        }
      }
    } catch (_) {
      setState(() => _message = "Serveur injoignable.");
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_registerMode ? "Créer un compte" : "Connexion")),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const SizedBox(height: 10),
          const Center(child: Text("♻️", style: TextStyle(fontSize: 48))),
          const SizedBox(height: 16),
          if (_registerMode)
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: "Nom complet (facultatif)", border: OutlineInputBorder()),
            ),
          if (_registerMode) const SizedBox(height: 12),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: "E-mail", border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _password,
            obscureText: true,
            decoration: const InputDecoration(labelText: "Mot de passe", border: OutlineInputBorder()),
          ),
          if (_message != null) ...[
            const SizedBox(height: 12),
            Text(_message!, style: const TextStyle(color: AppColors.danger)),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _loading ? null : _submit,
            child: Text(_loading ? "Veuillez patienter…" : (_registerMode ? "Créer mon compte" : "Se connecter")),
          ),
          TextButton(
            onPressed: () => setState(() => _registerMode = !_registerMode),
            child: Text(_registerMode ? "J'ai déjà un compte" : "Créer un compte visiteur"),
          ),
        ],
      ),
    );
  }
}
