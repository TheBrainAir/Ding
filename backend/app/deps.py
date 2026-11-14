"""Dashboard auth: an opaque token in an httpOnly cookie, hashed in auth_tokens."""

import hashlib
import secrets

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AuthToken, Restaurant, User

COOKIE_NAME = "ding_session"
COOKIE_MAX_AGE = 30 * 24 * 3600


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_login(db: Session, response: Response, user: User) -> None:
    token = secrets.token_urlsafe(32)
    db.add(AuthToken(token_hash=_hash(token), user_id=user.id))
    db.commit()
    response.set_cookie(COOKIE_NAME, token, max_age=COOKIE_MAX_AGE, httponly=True, samesite="lax", path="/")


def revoke_login(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        row = db.get(AuthToken, _hash(token))
        if row:
            db.delete(row)
            db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


def user_from_request(db: Session, request: Request) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    row = db.get(AuthToken, _hash(token))
    if row is None:
        return None
    return db.get(User, row.user_id)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = user_from_request(db, request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


def current_restaurant(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Restaurant:
    restaurant = db.get(Restaurant, user.restaurant_id)
    if restaurant is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return restaurant
