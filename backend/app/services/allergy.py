"""Deterministic allergy guard.

The model is told to ask about allergies, but safety does not rest on the prompt:
the ordering tools call into this module and refuse on the server.

- Nothing can be ordered until the guest's answer is recorded (set_allergies).
- A dish whose allergens or may_contain (traces) intersect the guest's allergens is
  blocked unless the guest explicitly accepted the risk; such items are flagged.
- Free-text notes are mined conservatively: allergen words ("shellfish", "nut",
  "dairy") add the matching EU allergens, diet words ("vegan", "halal") require the
  dietary tag, and any other food word ("pork", "strawberries") is matched against
  the dish's ingredient list.
"""

import re

from app.catalog import ALLERGEN_IDS
from app.models import Dish, GuestSession

# English note words (singular, see _stem) -> EU allergens they imply.
_ALLERGEN_WORDS: dict[str, tuple[str, ...]] = {
    "peanut": ("peanuts",),
    "groundnut": ("peanuts",),
    "nut": ("tree_nuts", "peanuts"),
    "almond": ("tree_nuts",),
    "walnut": ("tree_nuts",),
    "cashew": ("tree_nuts",),
    "pistachio": ("tree_nuts",),
    "hazelnut": ("tree_nuts",),
    "pecan": ("tree_nuts",),
    "macadamia": ("tree_nuts",),
    "brazil": ("tree_nuts",),
    "shellfish": ("crustaceans", "molluscs"),
    "seafood": ("crustaceans", "molluscs", "fish"),
    "crustacean": ("crustaceans",),
    "shrimp": ("crustaceans",),
    "prawn": ("crustaceans",),
    "crab": ("crustaceans",),
    "lobster": ("crustaceans",),
    "crayfish": ("crustaceans",),
    "langoustine": ("crustaceans",),
    "mollusc": ("molluscs",),
    "mollusk": ("molluscs",),
    "squid": ("molluscs",),
    "octopus": ("molluscs",),
    "mussel": ("molluscs",),
    "clam": ("molluscs",),
    "oyster": ("molluscs",),
    "scallop": ("molluscs",),
    "snail": ("molluscs",),
    "calamari": ("molluscs",),
    "fish": ("fish",),
    "anchovy": ("fish",),
    "salmon": ("fish",),
    "tuna": ("fish",),
    "cod": ("fish",),
    "milk": ("milk",),
    "dairy": ("milk",),
    "lactose": ("milk",),
    "cheese": ("milk",),
    "cream": ("milk",),
    "butter": ("milk",),
    "casein": ("milk",),
    "whey": ("milk",),
    "egg": ("eggs",),
    "gluten": ("gluten",),
    "wheat": ("gluten",),
    "barley": ("gluten",),
    "rye": ("gluten",),
    "celiac": ("gluten",),
    "coeliac": ("gluten",),
    "spelt": ("gluten",),
    "soy": ("soy",),
    "soya": ("soy",),
    "soybean": ("soy",),
    "tofu": ("soy",),
    "sesame": ("sesame",),
    "tahini": ("sesame",),
    "mustard": ("mustard",),
    "celery": ("celery",),
    "celeriac": ("celery",),
    "lupin": ("lupin",),
    "lupine": ("lupin",),
    "sulphite": ("sulphites",),
    "sulfite": ("sulphites",),
}

# Diet words in notes -> the dish must carry one of these tags.
_DIET_WORDS: dict[str, tuple[str, ...]] = {
    "vegan": ("vegan",),
    "vegetarian": ("vegetarian", "vegan"),
    "halal": ("halal", "vegan", "vegetarian"),
    "kosher": ("kosher",),
}

_STOPWORDS = {
    "allergy",
    "allergic",
    "allergen",
    "intolerance",
    "intolerant",
    "severe",
    "severely",
    "mild",
    "slight",
    "strong",
    "strict",
    "strictly",
    "avoid",
    "avoiding",
    "cannot",
    "can",
    "eat",
    "eating",
    "doe",
    "doesn",
    "not",
    "none",
    "any",
    "also",
    "and",
    "but",
    "the",
    "for",
    "with",
    "without",
    "from",
    "very",
    "really",
    "guest",
    "table",
    "person",
    "people",
    "child",
    "children",
    "kid",
    "wife",
    "husband",
    "friend",
    "partner",
    "someone",
    "one",
    "two",
    "three",
    "please",
    "trace",
    "anaphylaxis",
    "anaphylactic",
    "epipen",
    "carry",
    "diet",
    "dietary",
    "restriction",
    "free",
    "food",
    "only",
    "some",
    "little",
    "bit",
    "prefer",
    "preference",
    "like",
    "dislike",
    "would",
    "want",
    "need",
    "careful",
    "sensitive",
    "sensitivity",
    "reaction",
    "life",
    "threatening",
    "mother",
    "father",
    "son",
    "daughter",
    "baby",
    "all",
    "kind",
    "type",
    "product",
    "contain",
    "containing",
    "may",
    "might",
    "that",
    "this",
    "they",
    "she",
    "her",
    "his",
    "their",
    "has",
    "have",
    "had",
    "who",
    "which",
    "what",
    "when",
    "about",
    "after",
    "before",
    "other",
    "raw",
    "cooked",
    "fresh",
    "sauce",
    "declared",
    "said",
    "say",
    "declined",
    "answer",
    "known",
    "unknown",
    "get",
    "bad",
    "stomach",
    "upset",
    "hive",
    "shock",
    "tree",
    "medical",
    "doctor",
    "pregnant",
    "nothing",
    "everything",
    "fine",
    "okay",
    "issue",
    "problem",
}

_WORD = re.compile(r"[a-z]+")


def _stem(word: str) -> str:
    """Naive English singular: strawberries -> strawberry, eggs -> egg, dishes -> dish."""
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith(("xes", "zes", "ches", "shes", "sses", "oes")) and len(word) > 4:
        return word[:-2]
    if word.endswith("s") and not word.endswith(("ss", "us", "is")) and len(word) > 3:
        return word[:-1]
    return word


def _note_stems(notes: str) -> list[str]:
    return [_stem(w) for w in _WORD.findall(notes.lower()) if len(w) >= 3]


def allergens_from_notes(notes: str) -> list[str]:
    found: list[str] = []
    for stem in _note_stems(notes):
        for allergen in _ALLERGEN_WORDS.get(stem, ()):
            if allergen not in found:
                found.append(allergen)
    return found


def diet_requirements(notes: str) -> list[tuple[str, tuple[str, ...]]]:
    reqs: list[tuple[str, tuple[str, ...]]] = []
    for stem in _note_stems(notes):
        for word, tags in _DIET_WORDS.items():
            if stem == _stem(word) and all(r[0] != word for r in reqs):
                reqs.append((word, tags))
    return reqs


def ingredient_terms(notes: str) -> list[str]:
    """Food words from notes that are neither allergen words, diet words nor filler."""
    diet = {_stem(w) for w in _DIET_WORDS}
    terms: list[str] = []
    for stem in _note_stems(notes):
        if stem in _STOPWORDS or stem in _ALLERGEN_WORDS or stem in diet:
            continue
        if stem not in terms:
            terms.append(stem)
    return terms


def dish_conflicts(
    dish: Dish,
    allergens: list[str],
    notes: str = "",
) -> list[dict]:
    """Everything about `dish` that clashes with the guest's recorded allergies."""
    guest = set(allergens)
    conflicts: list[dict] = []
    contains = [a for a in ALLERGEN_IDS if a in guest and a in (dish.allergens or [])]
    for a in contains:
        conflicts.append({"allergen": a, "source": "contains"})
    for a in ALLERGEN_IDS:
        if a in guest and a not in contains and a in (dish.may_contain or []):
            conflicts.append({"allergen": a, "source": "may_contain"})

    if notes:
        ing_words = [(ing, {_stem(w) for w in _WORD.findall(ing.lower())}) for ing in dish.ingredients or []]
        for term in ingredient_terms(notes):
            for ing, stems in ing_words:
                if term in stems:
                    conflicts.append({"allergen": term, "source": "ingredient", "ingredient": ing})
                    break
        tags = set(dish.dietary_tags or [])
        for word, accepted in diet_requirements(notes):
            if not tags.intersection(accepted):
                conflicts.append({"allergen": word, "source": "diet"})
    return conflicts


def session_conflicts(dish: Dish, session: GuestSession) -> list[dict]:
    if not session.allergies_confirmed:
        return []
    return dish_conflicts(dish, list(session.allergens or []), session.allergy_notes or "")


def describe_conflicts(conflicts: list[dict]) -> str:
    parts = []
    for c in conflicts:
        name = c["allergen"].replace("_", " ")
        if c["source"] == "contains":
            parts.append(f"contains {name}")
        elif c["source"] == "may_contain":
            parts.append(f"may contain traces of {name}")
        elif c["source"] == "ingredient":
            parts.append(f"has {c.get('ingredient', name)}")
        else:
            parts.append(f"is not marked {name}")
    return "; ".join(parts)


ALLERGIES_NOT_RECORDED = {
    "ok": False,
    "error": "allergies_not_recorded",
    "message": (
        "Refused: the guest has not been asked about allergies yet. Ask whether anyone "
        "at the table has food allergies or dietary restrictions, record the answer with "
        "set_allergies, then try again."
    ),
}
