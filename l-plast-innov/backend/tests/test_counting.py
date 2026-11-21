"""Tests des TROIS indicateurs de comptage — jamais confondus."""
from __future__ import annotations

from app.database.session import SessionLocal
from app.services import counting, ingestion


def _ingest(db, uid, track=None, zone="BAL-A", cat="plastic_bottle"):
    return ingestion.ingest_detection(
        db,
        category_code=cat,
        camera_code=f"CAM-{zone}",
        track_uid=track,
        event_uid=uid,
        lat=4.749,
        lon=-6.636,
        confidence=0.9,
        source="test",
        is_simulated=True,
    )


def test_three_indicators_are_distinct():
    db = SessionLocal()
    try:
        from app.core.timezone import local_day, local_day_bounds_utc

        start, end = local_day_bounds_utc(local_day())

        base_present = counting.present_now(db)
        base_new = counting.new_in_period(db, start, end)
        base_det = counting.detections_in_period(db, start, end)

        # Deux objets DISTINCTS (track_uid différents).
        _ingest(db, "u1", track="T1")
        _ingest(db, "u2", track="T2")
        # Le MÊME objet T1 revu 3 fois (ne doit pas augmenter "présents").
        _ingest(db, "u3", track="T1")
        _ingest(db, "u4", track="T1")
        _ingest(db, "u5", track="T1")

        present = counting.present_now(db) - base_present
        new = counting.new_in_period(db, start, end) - base_new
        det = counting.detections_in_period(db, start, end) - base_det

        assert present == 2, "2 déchets uniques présents"
        assert new == 2, "2 nouveaux déchets uniques"
        assert det == 5, "5 événements de détection au total"
    finally:
        db.close()


def test_duplicate_event_uid_is_ignored():
    """Un même event_uid rejoué par le réseau ne compte qu'une fois."""
    db = SessionLocal()
    try:
        from app.core.timezone import local_day, local_day_bounds_utc

        start, end = local_day_bounds_utc(local_day())
        before = counting.detections_in_period(db, start, end)

        r1 = _ingest(db, "dup-1", track="D1")
        r2 = _ingest(db, "dup-1", track="D1")  # même event_uid

        assert r1.accepted is True
        assert r2.accepted is False and r2.reason == "duplicate_event"
        after = counting.detections_in_period(db, start, end)
        assert after - before == 1
    finally:
        db.close()
