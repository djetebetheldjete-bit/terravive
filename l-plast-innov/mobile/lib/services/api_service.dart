import 'dart:convert';
import 'package:http/http.dart' as http;

import '../config.dart';
import '../models/models.dart';

/// Client HTTP de l'API L-PLAST-INNOV.
class ApiService {
  final String? token;
  ApiService(this.token);

  Map<String, String> get _headers => {
        "Content-Type": "application/json",
        if (token != null) "Authorization": "Bearer $token",
      };

  Uri _u(String path) => Uri.parse("${AppConfig.apiBase}$path");

  Future<Overview> overview() async {
    final r = await http.get(_u("/api/v1/stats/overview"), headers: _headers);
    _check(r);
    return Overview.fromJson(jsonDecode(r.body));
  }

  Future<List<Zone>> zones() async {
    final r = await http.get(_u("/api/v1/zones"), headers: _headers);
    _check(r);
    return (jsonDecode(r.body) as List).map((e) => Zone.fromJson(e)).toList();
  }

  Future<List<Alert>> alerts({bool openOnly = false}) async {
    final q = openOnly ? "?open_only=true" : "";
    final r = await http.get(_u("/api/v1/alerts$q"), headers: _headers);
    _check(r);
    return (jsonDecode(r.body) as List).map((e) => Alert.fromJson(e)).toList();
  }

  Future<List<DailyCount>> series({int days = 14}) async {
    final r = await http.get(_u("/api/v1/stats/series?days=$days"), headers: _headers);
    _check(r);
    return (jsonDecode(r.body) as List).map((e) => DailyCount.fromJson(e)).toList();
  }

  Future<List<CleaningOp>> cleaning() async {
    final r = await http.get(_u("/api/v1/cleaning"), headers: _headers);
    _check(r);
    return (jsonDecode(r.body) as List).map((e) => CleaningOp.fromJson(e)).toList();
  }

  void _check(http.Response r) {
    if (r.statusCode >= 400) {
      throw Exception("Erreur API ${r.statusCode}");
    }
  }
}
