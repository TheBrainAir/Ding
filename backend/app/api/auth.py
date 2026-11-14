from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import DEFAULT_RESTAURANT_SETTINGS
from app.db import get_db
from app.deps import current_user, issue_login, revoke_login
from app.models import Restaurant, User
from app.schemas import LoginIn, SignupIn
from app.serializers import restaurant_out, user_out

router = APIRouter(tags=["auth"])
hasher = PasswordHasher()


def _me(db: Session, user: User) -> dict:
    return {"user": user_out(user), "restaurant": restaurant_out(db.get(Restaurant, user.restaurant_id))}


def create_owner(db: Session, email: str, password: str, restaurant_name: str) -> User:
    restaurant = Restaurant(name=restaurant_name.strip(), **DEFAULT_RESTAURANT_SETTINGS)
    db.add(restaurant)
    db.flush()
    user = User(email=email, password_hash=hasher.hash(password), restaurant_id=restaurant.id)
    db.add(user)
    db.commit()
    return user


@router.post("/auth/signup")
def signup(body: SignupIn, response: Response, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = create_owner(db, body.email, body.password, body.restaurant_name)
    issue_login(db, response, user)
    return _me(db, user)


@router.post("/auth/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(User).where(User.email == body.email))
    try:
        if user is None or not hasher.verify(user.password_hash, body.password):
            raise VerificationError
    except (VerificationError, InvalidHashError):
        raise HTTPException(status_code=401, detail="Wrong email or password") from None
    issue_login(db, response, user)
    return _me(db, user)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> Response:
    revoke_login(db, request, response)
    response.status_code = 204
    return response


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return _me(db, user)
