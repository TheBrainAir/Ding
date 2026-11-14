"""Menu and knowledge-base retrieval with local multilingual embeddings (fastembed, ONNX).

Vectors are float32 BLOBs in SQLite; search is cosine similarity in numpy over one
restaurant's rows (menus are small) plus a small bonus for shared words. A guest
query in Russian, Spanish or Armenian lands on the English-described dish because
the embedding model maps all of them into one space. (In conversation the waiter is
also told to write its search queries in the menu's language, which helps further.)
"""

import logging
import re
import threading

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppMeta, Dish, KnowledgeChunk, KnowledgeItem

log = logging.getLogger(__name__)

_model = None
_model_lock = threading.Lock()
_WORD = re.compile(r"\w+", re.UNICODE)


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from fastembed import TextEmbedding

                settings.model_cache_dir.mkdir(parents=True, exist_ok=True)
                _model = TextEmbedding(settings.embedding_model, cache_dir=str(settings.model_cache_dir))
    return _model


def warmup() -> None:
    """Load the model and rebuild the index if it was built with another model."""
    try:
        embed_query("warm up")
        from app.db import SessionLocal

        with SessionLocal() as db:
            ensure_index(db)
    except Exception:  # pragma: no cover - startup best effort
        log.exception("embedding model warm-up failed")


INDEX_KEY = "embedding_model"


def ensure_index(db: Session) -> bool:
    """Re-embed every dish and note when the configured model changed. Returns True if it did."""
    meta = db.get(AppMeta, INDEX_KEY)
    if meta is not None and meta.value == settings.embedding_model:
        return False
    dishes = list(db.scalars(select(Dish)))
    if dishes:
        for d, vec in zip(dishes, embed([dish_document(d) for d in dishes]), strict=True):
            d.embedding = to_blob(vec)
    for item in db.scalars(select(KnowledgeItem)):
        reindex_knowledge(item)
    if meta is None:
        meta = AppMeta(key=INDEX_KEY)
        db.add(meta)
    meta.value = settings.embedding_model
    db.commit()
    log.info("search index built with %s (%d dishes)", settings.embedding_model, len(dishes))
    return True


def _normalise(vecs) -> np.ndarray:
    vecs = np.array(list(vecs), dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vecs / norms


def embed(texts: list[str]) -> np.ndarray:
    """Embed documents (dishes, notes). Models that need "passage:" prefixes get them."""
    model = _get_model()
    with _model_lock:
        return _normalise(model.passage_embed(texts))


def embed_query(text: str) -> np.ndarray:
    model = _get_model()
    with _model_lock:
        return _normalise(model.query_embed([text]))[0]


def to_blob(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) >= 3}


# ---------------------------------------------------------------- dishes


def dish_document(d: Dish) -> str:
    """What gets embedded. The model truncates at 128 tokens: most telling parts first."""
    parts = [f"{d.name}.", f"{d.category}."]
    if d.description:
        parts.append(d.description.strip())
    if d.ingredients:
        parts.append("Ingredients: " + ", ".join(d.ingredients) + ".")
    if d.dietary_tags:
        parts.append(" ".join(t.replace("_", " ") for t in d.dietary_tags) + ".")
    if d.allergens:
        parts.append("Contains " + ", ".join(a.replace("_", " ") for a in d.allergens) + ".")
    return " ".join(parts)


def reindex_dish(d: Dish) -> None:
    d.embedding = to_blob(embed([dish_document(d)])[0])


def search_dishes(
    db: Session,
    restaurant_id: int,
    query: str,
    *,
    category: str | None = None,
    k: int = 5,
) -> list[tuple[Dish, float]]:
    """Top-k available dishes for a free-text query in any language."""
    stmt = select(Dish).where(Dish.restaurant_id == restaurant_id, Dish.available.is_(True))
    dishes = [d for d in db.scalars(stmt) if d.embedding]
    if category:
        in_cat = [d for d in dishes if d.category.lower() == category.strip().lower()]
        dishes = in_cat or dishes
    if not dishes or not query.strip():
        return []

    q = embed_query(query)
    dishes = [d for d in dishes if len(d.embedding) == q.nbytes]  # skip vectors from another model
    if not dishes:
        return []
    matrix = np.stack([from_blob(d.embedding) for d in dishes])
    scores = matrix @ q
    q_words = _words(query)
    ranked: list[tuple[Dish, float]] = []
    for d, score in zip(dishes, scores, strict=True):
        bonus = 0.0
        if q_words:
            overlap = len(q_words & _words(dish_document(d)))
            bonus += min(0.12, 0.04 * overlap)
        if d.name.lower() in query.lower():
            bonus += 0.1
        ranked.append((d, float(score) + bonus))
    ranked.sort(key=lambda x: x[1], reverse=True)
    return ranked[:k]


# ---------------------------------------------------------------- knowledge


def chunk_text(title: str, content: str, max_chars: int = 420) -> list[str]:
    """Split a note into retrieval chunks of a few sentences, each prefixed by its title."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
    chunks: list[str] = []
    for para in paragraphs or [""]:
        sentences = re.split(r"(?<=[.!?])\s+", para)
        buf = ""
        for s in sentences:
            if buf and len(buf) + len(s) + 1 > max_chars:
                chunks.append(buf)
                buf = s
            else:
                buf = f"{buf} {s}".strip()
        if buf:
            chunks.append(buf)
    return [f"{title}: {c}" if c else title for c in chunks]


def reindex_knowledge(item: KnowledgeItem) -> None:
    texts = chunk_text(item.title, item.content)
    vecs = embed(texts)
    item.chunks = [
        KnowledgeChunk(restaurant_id=item.restaurant_id, idx=i, text=t, embedding=to_blob(v))
        for i, (t, v) in enumerate(zip(texts, vecs, strict=True))
    ]


def search_knowledge(db: Session, restaurant_id: int, query: str, *, k: int = 3) -> list[tuple[KnowledgeChunk, float]]:
    chunks = list(db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.restaurant_id == restaurant_id)))
    if not chunks or not query.strip():
        return []
    q = embed_query(query)
    chunks = [c for c in chunks if len(c.embedding) == q.nbytes]
    if not chunks:
        return []
    scores = np.stack([from_blob(c.embedding) for c in chunks]) @ q
    q_words = _words(query)
    ranked = []
    for c, score in zip(chunks, scores, strict=True):
        bonus = min(0.12, 0.04 * len(q_words & _words(c.text))) if q_words else 0.0
        ranked.append((c, float(score) + bonus))
    ranked.sort(key=lambda x: x[1], reverse=True)
    return ranked[:k]
