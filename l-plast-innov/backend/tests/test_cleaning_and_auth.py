"""Tests du cycle de nettoyage et du contrôle d'accès par rôle."""
from __future__ import annotations


def test_visitor_cannot_administer(client):
    # Inscription d'un visiteur.
    client.post(
        "/api/v1/auth/register",
        json={"email": "visiteur@example.com", "password": "motdepasse123", "full_name": "V"},
    )
    tok = client.post(
        "/api/v1/auth/login",
        data={"username": "visiteur@example.com", "password": "motdepasse123"},
    ).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    # Un visiteur ne peut pas modifier un seuil.
    r = client.put(
        "/api/v1/zones/BAL-A/threshold", json={"preventive": 5, "critical": 9}, headers=h
    )
    assert r.status_code == 403

    # ni créer une caméra.
    r = client.post(
        "/api/v1/cameras",
        json={"code": "HACK", "name": "x"},
        headers=h,
    )
    assert r.status_code == 403


def test_cleaning_removes_from_present_but_keeps_history(client, admin_headers):
    _ = client.post("/api/v1/simulation/surge", json={"zone_code": "BAL-B", "count": 12}, headers=admin_headers)
    zone = client.get("/api/v1/zones/BAL-B", headers=admin_headers).json()
    before = zone["present_waste_count"]
    assert before > 0

    op = client.post(
        "/api/v1/cleaning", json={"zone_id": zone["id"], "notes": "test"}, headers=admin_headers
    ).json()
    client.patch(
        f"/api/v1/cleaning/{op['id']}/status", json={"status": "in_progress"}, headers=admin_headers
    )
    v = client.post(
        f"/api/v1/cleaning/{op['id']}/verify", json={"confirmed": True}, headers=admin_headers
    ).json()
    assert v["status"] == "verified"

    zone2 = client.get("/api/v1/zones/BAL-B", headers=admin_headers).json()
    assert zone2["present_waste_count"] == 0  # quittés du stock présent

    # mais conservés dans l'historique (removed_today > 0)
    ov = client.get("/api/v1/stats/overview", headers=admin_headers).json()
    assert ov["removed_today"] >= before


def test_threshold_validation_rejects_critical_below_preventive(client, admin_headers):
    r = client.put(
        "/api/v1/zones/BAL-A/threshold", json={"preventive": 20, "critical": 10}, headers=admin_headers
    )
    assert r.status_code == 422
