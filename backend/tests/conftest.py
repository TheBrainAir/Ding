import os
import tempfile

# Point the app at a throwaway data dir before anything imports app.config.
os.environ["DING_DATA_DIR"] = tempfile.mkdtemp(prefix="ding-test-")
os.environ["ELEVENLABS_API_KEY"] = ""

import pytest
from sqlalchemy import select

from app.db import Base, SessionLocal, engine, init_db
from app.models import DiningTable, Dish, Restaurant
from app.seed import seed
from app.services import guest_sessions
from app.services.tools import ToolContext, execute_tool
from tests.fixtures import TEST_MENU


@pytest.fixture
def db():
    Base.metadata.drop_all(engine)
    init_db()
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def demo(db):
    info = seed(db, TEST_MENU)
    restaurant = db.get(Restaurant, info["restaurant_id"])
    table = db.scalar(select(DiningTable).where(DiningTable.token == info["tables"][0]["token"]))
    return {"info": info, "restaurant": restaurant, "table": table}


@pytest.fixture
def ctx(db, demo):
    session, _ = guest_sessions.get_or_create(db, demo["table"], demo["restaurant"])
    return ToolContext(db=db, session=session, restaurant=demo["restaurant"])


def dish_id(db, name: str) -> int:
    return db.scalar(select(Dish.id).where(Dish.name == name))


def call(ctx: ToolContext, name: str, **tool_input):
    return execute_tool(ctx, name, tool_input)
