"""Routes du mode simulation (tester sans caméra physique).

Toutes les données produites sont marquées DEMO/is_simulated. Ces routes ne sont
disponibles que si SIMULATION_MODE=true.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_staff
from app.core.config import settings
from app.database.session import get_db
from app.schemas.entities import IngestOut
from app.services import simulation

router = APIRouter(prefix="/simulation", tags=["Simulation (DEMO)"])


def _guard():
    if not settings.simulation_mode:
        raise HTTPException(403, "Mode simulation désactivé (SIMULATION_MODE=false).")


class SimulateDetectionRequest(BaseModel):
    zone_code: str | None = None
    camera_code: str | None = None
    category_code: str | None = None
    new_object: bool = True


class SurgeRequest(BaseModel):
    zone_code: str
    count: int = 12
    category_code: str | None = None


@router.post("/detection", response_model=IngestOut, dependencies=[Depends(require_staff)])
def simulate_detection(payload: SimulateDetectionRequest, db: Session = Depends(get_db)):
    _guard()
    try:
        return simulation.simulate_detection(db, **payload.model_dump())
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e))


@router.post("/surge", dependencies=[Depends(require_staff)])
def simulate_surge(payload: SurgeRequest, db: Session = Depends(get_db)):
    """Simule une montée de pollution jusqu'au franchissement des seuils."""
    _guard()
    try:
        return simulation.simulate_pollution_surge(db, **payload.model_dump())
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e))
