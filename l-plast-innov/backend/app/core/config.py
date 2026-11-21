"""Configuration centralisée, lue depuis l'environnement / le fichier .env.

Aucune valeur secrète n'est codée en dur : tout provient de variables
d'environnement (cf. .env.example). En production, SECRET_KEY et les mots de
passe DOIVENT être fournis par l'environnement.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Application
    app_name: str = "L-PLAST-INNOV"
    environment: str = "development"
    simulation_mode: bool = True

    # Base de données
    database_url: str = "sqlite:///./l_plast_innov.db"

    # Sécurité
    secret_key: str = "dev-secret-a-remplacer-absolument-en-production"
    access_token_expire_minutes: int = 720
    algorithm: str = "HS256"

    # Admin initial
    first_admin_email: str = "admin@l-plast-innov.ci"
    first_admin_password: str = "ChangeMoi123!"

    # Statistiques
    stats_timezone: str = "Africa/Abidjan"

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Seuils par défaut
    default_preventive_threshold: int = 10
    default_critical_threshold: int = 20

    # Notifications
    fcm_server_key: str | None = None

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
