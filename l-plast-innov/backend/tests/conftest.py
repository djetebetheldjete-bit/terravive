"""Fixtures de test : base SQLite en mémoire isolée + client API."""
from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_lplast.db")
os.environ.setdefault("SIMULATION_MODE", "true")
os.environ.setdefault("SECRET_KEY", "test-secret")

import warnings

import pytest
from fastapi.testclient import TestClient

warnings.filterwarnings("ignore")


@pytest.fixture(scope="session", autouse=True)
def _fresh_db():
    # Base de test neuve.
    db_path = "./test_lplast.db"
    if os.path.exists(db_path):
        os.remove(db_path)
    from app.seed import seed

    seed()
    yield
    if os.path.exists(db_path):
        os.remove(db_path)


@pytest.fixture()
def client():
    from app.main import app

    return TestClient(app)


@pytest.fixture()
def admin_headers(client):
    r = client.post(
        "/api/v1/auth/login",
        data={"username": "admin@l-plast-innov.ci", "password": "ChangeMoi123!"},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
