"""Tests du franchissement des seuils et de la génération d'alertes."""
from __future__ import annotations


def _surge(client, headers, zone, n):
    return client.post(
        "/api/v1/simulation/surge", json={"zone_code": zone, "count": n}, headers=headers
    ).json()


def test_alert_created_on_crossing_not_each_detection(client, admin_headers):
    # BAL-C : préventif 15, critique 30.
    zone = client.get("/api/v1/zones/BAL-C", headers=admin_headers).json()
    zid = zone["id"]

    # 16 déchets uniques → franchit le préventif (15), pas le critique.
    _surge(client, admin_headers, "BAL-C", 16)

    z = client.get("/api/v1/zones/BAL-C", headers=admin_headers).json()
    assert z["present_waste_count"] >= 15
    assert z["status"] in ("monitored", "alert")

    alerts = client.get(
        f"/api/v1/alerts?zone_id={zid}&open_only=true", headers=admin_headers
    ).json()
    preventive = [a for a in alerts if a["level"] == "preventive"]
    # Une SEULE alerte préventive malgré 16 détections.
    assert len(preventive) == 1, f"attendu 1 alerte préventive, obtenu {len(preventive)}"
    assert preventive[0]["threshold_value"] == 15


def test_threshold_uses_unique_present_not_raw_detections(client, admin_headers):
    """Le seuil se calcule sur les déchets uniques présents, pas les détections brutes."""
    zone_code = "BAL-A"  # préventif 10, critique 20
    zid = client.get(f"/api/v1/zones/{zone_code}", headers=admin_headers).json()["id"]

    # On revoit plusieurs fois LE MÊME objet via l'ingestion directe.
    from app.database.session import SessionLocal
    from app.services import ingestion

    db = SessionLocal()
    try:
        for i in range(25):
            ingestion.ingest_detection(
                db,
                category_code="plastic_bag",
                camera_code=f"CAM-{zone_code}",
                track_uid="SAME-OBJECT",  # toujours le même déchet
                event_uid=f"same-{i}",
                lat=4.749,
                lon=-6.636,
                source="test",
                is_simulated=True,
            )
    finally:
        db.close()

    z = client.get(f"/api/v1/zones/{zone_code}", headers=admin_headers).json()
    # 25 détections du même objet = 1 seul déchet présent → aucune alerte.
    alerts = client.get(
        f"/api/v1/alerts?zone_id={zid}&open_only=true", headers=admin_headers
    ).json()
    assert alerts == [] or all(a["level"] != "preventive" for a in alerts)
