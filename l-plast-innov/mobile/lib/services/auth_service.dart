import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config.dart';

/// Gère l'authentification et la session (jeton JWT + rôle).
///
/// Trois rôles : visitor, cleaner, admin. Un visiteur n'a pas accès aux
/// fonctions d'administration (gérées côté serveur par le contrôle des rôles).
class AuthService extends ChangeNotifier {
  String? _token;
  String? _role;
  String? _email;

  String? get token => _token;
  String? get role => _role;
  String? get email => _email;
  bool get isLoggedIn => _token != null;
  bool get isVisitor => _role == "visitor" || _role == null;

  Future<void> loadSession() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString("token");
    _role = prefs.getString("role");
    _email = prefs.getString("email");
    notifyListeners();
  }

  Future<bool> login(String email, String password) async {
    final res = await http.post(
      Uri.parse("${AppConfig.apiBase}/api/v1/auth/login"),
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: {"username": email, "password": password},
    );
    if (res.statusCode != 200) return false;
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    _token = data["access_token"];
    _role = data["role"];
    _email = email;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString("token", _token!);
    await prefs.setString("role", _role!);
    await prefs.setString("email", email);
    notifyListeners();
    return true;
  }

  Future<bool> register(String email, String password, String? fullName) async {
    final res = await http.post(
      Uri.parse("${AppConfig.apiBase}/api/v1/auth/register"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({
        "email": email,
        "password": password,
        "full_name": fullName,
      }),
    );
    return res.statusCode == 201;
  }

  Future<void> logout() async {
    _token = null;
    _role = null;
    _email = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    notifyListeners();
  }
}
