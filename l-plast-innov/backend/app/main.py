"""Point d'entrée de l'API L-PLAST-INNOV (serveur central)."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.core.config import settings

app = FastAPI(
    title="L-PLAST-INNOV — Serveur central",
    description=(
        "API de surveillance, cartographie et suivi des déchets plastiques du "
        "littoral (plage de Balmer, San Pedro). "
        "⚠️ Les données marquées is_simulated=true sont des données de "
        "DÉMONSTRATION et ne correspondent à aucune observation réelle."
    ),
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/", tags=["Système"])
def root():
    return {
        "name": settings.app_name,
        "version": __version__,
        "environment": settings.environment,
        "simulation_mode": settings.simulation_mode,
        "docs": "/docs",
    }


@app.get("/health", tags=["Système"])
def health():
    return {"status": "ok"}
