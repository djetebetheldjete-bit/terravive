/// Modèles de données, alignés sur l'API L-PLAST-INNOV.

class Zone {
  final int id;
  final String code;
  final String name;
  final String status;
  final int presentWasteCount;
  final double? centerLat;
  final double? centerLon;
  final String? geojson;
  final bool isSimulated;
  final int? preventive;
  final int? critical;

  Zone({
    required this.id,
    required this.code,
    required this.name,
    required this.status,
    required this.presentWasteCount,
    this.centerLat,
    this.centerLon,
    this.geojson,
    this.isSimulated = false,
    this.preventive,
    this.critical,
  });

  factory Zone.fromJson(Map<String, dynamic> j) {
    final th = j["threshold"] as Map<String, dynamic>?;
    return Zone(
      id: j["id"],
      code: j["code"],
      name: j["name"],
      status: j["status"],
      presentWasteCount: j["present_waste_count"] ?? 0,
      centerLat: (j["center_lat"] as num?)?.toDouble(),
      centerLon: (j["center_lon"] as num?)?.toDouble(),
      geojson: j["geojson"],
      isSimulated: j["is_simulated"] ?? false,
      preventive: th?["preventive"],
      critical: th?["critical"],
    );
  }
}

class Alert {
  final int id;
  final int zoneId;
  final String level;
  final String status;
  final int wasteCountAtTrigger;
  final int thresholdValue;
  final String? message;
  final DateTime triggeredAt;
  final bool isSimulated;

  Alert({
    required this.id,
    required this.zoneId,
    required this.level,
    required this.status,
    required this.wasteCountAtTrigger,
    required this.thresholdValue,
    required this.triggeredAt,
    this.message,
    this.isSimulated = false,
  });

  factory Alert.fromJson(Map<String, dynamic> j) => Alert(
        id: j["id"],
        zoneId: j["zone_id"],
        level: j["level"],
        status: j["status"],
        wasteCountAtTrigger: j["waste_count_at_trigger"],
        thresholdValue: j["threshold_value"],
        message: j["message"],
        triggeredAt: DateTime.parse(j["triggered_at"]),
        isSimulated: j["is_simulated"] ?? false,
      );
}

class Overview {
  final int presentWaste;
  final int newWasteToday;
  final int removedToday;
  final int zonesTotal;
  final int zonesAlert;
  final int alertsOpen;
  final Map<String, int> wasteByCategory;

  Overview({
    required this.presentWaste,
    required this.newWasteToday,
    required this.removedToday,
    required this.zonesTotal,
    required this.zonesAlert,
    required this.alertsOpen,
    required this.wasteByCategory,
  });

  factory Overview.fromJson(Map<String, dynamic> j) => Overview(
        presentWaste: j["present_waste"] ?? 0,
        newWasteToday: j["new_waste_today"] ?? 0,
        removedToday: j["removed_today"] ?? 0,
        zonesTotal: j["zones_total"] ?? 0,
        zonesAlert: j["zones_alert"] ?? 0,
        alertsOpen: j["alerts_open"] ?? 0,
        wasteByCategory:
            (j["waste_by_category"] as Map<String, dynamic>? ?? {}).map(
          (k, v) => MapEntry(k, (v as num).toInt()),
        ),
      );
}

class DailyCount {
  final String day;
  final int newWaste;
  final int totalDetections;
  final int removed;

  DailyCount({
    required this.day,
    required this.newWaste,
    required this.totalDetections,
    required this.removed,
  });

  factory DailyCount.fromJson(Map<String, dynamic> j) => DailyCount(
        day: j["day"],
        newWaste: j["new_waste"] ?? 0,
        totalDetections: j["total_detections"] ?? 0,
        removed: j["removed"] ?? 0,
      );
}

class CleaningOp {
  final int id;
  final int zoneId;
  final String status;
  final int? reportedRemovedCount;

  CleaningOp({
    required this.id,
    required this.zoneId,
    required this.status,
    this.reportedRemovedCount,
  });

  factory CleaningOp.fromJson(Map<String, dynamic> j) => CleaningOp(
        id: j["id"],
        zoneId: j["zone_id"],
        status: j["status"],
        reportedRemovedCount: j["reported_removed_count"],
      );
}
