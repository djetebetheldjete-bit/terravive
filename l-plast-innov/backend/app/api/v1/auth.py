"""Authentification : inscription (visiteur) et connexion (JWT)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models.enums import RoleName
from app.models.user import Role, User
from app.schemas.auth import RegisterRequest, Token
from app.schemas.entities import UserOut

router = APIRouter(prefix="/auth", tags=["Authentification"])


@router.post("/register", response_model=UserOut, status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """Crée un compte VISITEUR. Les rôles supérieurs sont attribués par un admin."""
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=409, detail="Un compte existe déjà pour cet e-mail.")
    visitor_role = db.scalar(select(Role).where(Role.name == RoleName.VISITOR))
    if visitor_role is None:
        visitor_role = Role(name=RoleName.VISITOR, description="Visiteur volontaire")
        db.add(visitor_role)
        db.flush()
    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role_id=visitor_role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Connexion OAuth2 (username = e-mail). Renvoie un jeton JWT."""
    user = db.scalar(select(User).where(User.email == form.username))
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-mail ou mot de passe incorrect.",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Compte désactivé.")
    token = create_access_token(subject=user.id, role=user.role_name)
    return Token(access_token=token, role=user.role_name)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
