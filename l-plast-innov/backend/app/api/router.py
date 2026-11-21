"""Agrège toutes les routes v1 sous /api/v1."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    alerts,
    auth,
    cameras,
    categories,
    cleaning,
    detections,
    simulation,
    stats,
    users,
    zones,
)
from app.core.config import settings

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(categories.router)
api_router.include_router(zones.router)
api_router.include_router(cameras.router)
api_router.include_router(detections.router)
api_router.include_router(alerts.router)
api_router.include_router(cleaning.router)
api_router.include_router(stats.router)

if settings.simulation_mode:
    api_router.include_router(simulation.router)
