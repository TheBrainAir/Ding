"""ORM models. Timestamps are naive UTC; serializers add the `Z`."""

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Restaurant(Base):
    __tablename__ = "restaurants"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    currency: Mapped[str] = mapped_column(String(8))
    menu_language: Mapped[str] = mapped_column(String(16))
    persona_name: Mapped[str] = mapped_column(String(80))
    voice_id: Mapped[str] = mapped_column(String(120))
    llm_model: Mapped[str] = mapped_column(String(120))
    stt_model: Mapped[str] = mapped_column(String(120))
    tts_model: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    restaurant: Mapped[Restaurant] = relationship()


class AuthToken(Base):
    """Dashboard login session; the cookie carries the raw token, we store its hash."""

    __tablename__ = "auth_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Dish(Base):
    __tablename__ = "dishes"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(80), default="Other")
    price: Mapped[float] = mapped_column(Float, default=0.0)
    photo_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ingredients: Mapped[list] = mapped_column(JSON, default=list)
    allergens: Mapped[list] = mapped_column(JSON, default=list)
    may_contain: Mapped[list] = mapped_column(JSON, default=list)
    dietary_tags: Mapped[list] = mapped_column(JSON, default=list)
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    # float32 vector of the dish document, see services/rag.py
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", order_by="KnowledgeChunk.idx"
    )


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("knowledge_items.id", ondelete="CASCADE"), index=True)
    restaurant_id: Mapped[int] = mapped_column(Integer, index=True)
    idx: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[bytes] = mapped_column(LargeBinary)

    item: Mapped[KnowledgeItem] = relationship(back_populates="chunks")


class DiningTable(Base):
    __tablename__ = "tables"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(80))
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class GuestSession(Base):
    """One guest (or party) at a table, from the first press until closed."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    table_id: Mapped[int | None] = mapped_column(
        ForeignKey("tables.id", ondelete="SET NULL"), index=True, nullable=True
    )
    table_label: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | closed
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Allergy record written only by the set_allergies tool.
    allergies_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    allergens: Mapped[list] = mapped_column(JSON, default=list)
    allergy_notes: Mapped[str] = mapped_column(Text, default="")
    none_declared: Mapped[bool] = mapped_column(Boolean, default=False)

    # Claude conversation, append-only: full response.content (thinking included)
    # is stored and replayed verbatim.
    messages: Mapped[list] = mapped_column(JSON, default=list)
    # Frozen at session start so the cached / thinking-bound prefix never changes.
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    # Menu index the model last saw (system prompt or a later system message).
    menu_index: Mapped[str] = mapped_column(Text, default="")
    # Spoken text only: [{role: guest|waiter, text, at}]
    transcript: Mapped[list] = mapped_column(JSON, default=list)
    turn_count: Mapped[int] = mapped_column(Integer, default=0)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("sessions.id", ondelete="SET NULL"), index=True, nullable=True
    )
    table_id: Mapped[int | None] = mapped_column(ForeignKey("tables.id", ondelete="SET NULL"), nullable=True)
    table_label: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    allergens: Mapped[list] = mapped_column(JSON, default=list)
    allergy_note: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    total: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    placed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderItem.id"
    )

    def recompute_total(self) -> None:
        self.total = round(sum(i.price * i.quantity for i in self.items), 2)


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    dish_id: Mapped[int | None] = mapped_column(ForeignKey("dishes.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(200))  # snapshot
    price: Mapped[float] = mapped_column(Float)  # snapshot
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[str] = mapped_column(Text, default="")
    # True when the guest explicitly accepted an allergen risk for this item.
    allergen_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    conflicts: Mapped[list] = mapped_column(JSON, default=list)

    order: Mapped[Order] = relationship(back_populates="items")
    dish: Mapped[Dish | None] = relationship()


class WaiterCall(Base):
    __tablename__ = "waiter_calls"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    table_id: Mapped[int | None] = mapped_column(ForeignKey("tables.id", ondelete="SET NULL"), nullable=True)
    table_label: Mapped[str] = mapped_column(String(80), default="")
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AppMeta(Base):
    """Small key/value store for internal bookkeeping (e.g. which embedding model built the index)."""

    __tablename__ = "app_meta"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class DishTranslation(Base):
    """A dish's name and description in a guest language, cached. Valid while `source_hash`
    matches the dish's current name + description (editing the dish invalidates it)."""

    __tablename__ = "dish_translations"
    __table_args__ = (UniqueConstraint("dish_id", "language", name="uq_dish_translation"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    dish_id: Mapped[int] = mapped_column(ForeignKey("dishes.id", ondelete="CASCADE"), index=True)
    restaurant_id: Mapped[int] = mapped_column(Integer, index=True)
    language: Mapped[str] = mapped_column(String(16), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    source_hash: Mapped[str] = mapped_column(String(40))
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)  # unused for now
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
