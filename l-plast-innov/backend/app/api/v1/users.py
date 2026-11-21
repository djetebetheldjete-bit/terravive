"""Gestion des utilisateurs et des rôles (administration)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.database.session import get_db
from app.models.enums import RoleName
from app.models.user import Role, User
from app.schemas.entities import UserOut, UserRoleUpdate

router = APIRouter(prefix="/users", tags=["Utilisateurs"])


@router.get("", response_model=list[UserOut], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.created_at.desc())).all()


@router.put("/{user_id}/role", response_model=UserOut, dependencies=[Depends(require_admin)])
def set_role(user_id: int, payload: UserRoleUpdate, db: Session = Depends(get_db)):
    try:
        role_name = RoleName(payload.role_name)
    except ValueError:
        raise HTTPException(422, f"Rôle inconnu : {payload.role_name}")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Utilisateur introuvable.")
    role = db.scalar(select(Role).where(Role.name == role_name))
    if role is None:
        role = Role(name=role_name)
        db.add(role)
        db.flush()
    user.role_id = role.id
    db.commit()
    db.refresh(user)
    return user


class _ConsentBody:  # placeholder (kept simple)
    pass


@router.put("/me/location-consent", response_model=UserOut)
def set_location_consent(
    consent: bool, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """L'utilisateur active/désactive sa géolocalisation facultative (vie privée)."""
    user.location_consent = consent
    db.commit()
    db.refresh(user)
    return user
