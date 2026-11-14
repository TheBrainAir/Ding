"""Build the printable menu from menu.json: menu.html -> menu.pdf (headless Chrome), then check it.

    python3 demo/build_menu.py            # build + check
    python3 demo/build_menu.py --check    # only check the existing menu.pdf

menu.json is the single source of truth: names, prices, allergens and tags on paper are
rendered from it, so the printed menu and the seeded data cannot drift apart.
Fonts (Young Serif, Figtree; SIL OFL) are local in fonts/, photos in photos/.
"""

import html
import json
import re
import subprocess
import sys
from pathlib import Path

DEMO = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

ALLERGENS = {  # id -> (code on paper, legend label), in catalog order
    "gluten": ("GL", "Gluten"),
    "crustaceans": ("CR", "Crustaceans"),
    "eggs": ("EG", "Eggs"),
    "fish": ("FI", "Fish"),
    "peanuts": ("PN", "Peanuts"),
    "soy": ("SO", "Soy"),
    "milk": ("MI", "Milk"),
    "tree_nuts": ("TN", "Tree nuts"),
    "celery": ("CE", "Celery"),
    "mustard": ("MU", "Mustard"),
    "sesame": ("SE", "Sesame"),
    "sulphites": ("SU", "Sulphites"),
    "lupin": ("LU", "Lupin"),
    "molluscs": ("MO", "Molluscs"),
}
TAGS = {"vegan": "VG", "vegetarian": "V", "halal": "H", "kosher": "K", "gluten_free": "GF", "spicy": None}

# Which dishes get a photo on paper (every dish has one in the app).
PRINT_PHOTOS = {
    1: ["Rainbow Summer Rolls", "Chicken Satay Skewers", "Chili Garlic Prawns", "Pad Thai with Shrimp", "Spicy Miso Ramen"],
    2: ["Mango Sticky Rice", "Matcha Tiramisu", "Black Sesame Ice Cream", "Thai Iced Tea", "Lychee Mint Spritz"],
}

CHILI = (
    '<svg class="chili" viewBox="0 0 24 24" aria-label="spicy">'
    '<path fill="currentColor" d="M14.6 8.1c2.9-.2 4.6 2.3 3.7 5.3-1.5 4.6-6.9 8-13.4 8.4-1.1.1-1.4-1.2-.5-1.6 '
    '4.3-2 7.2-5.4 8-9.4.3-1.6 1-2.6 2.2-2.7z"/>'
    '<path fill="currentColor" d="M12.9 8.3c.6-1.6 2.5-2.4 4.3-1.8.9.3 1.5 1 1.6 1.9-1.6-1-3.9-1.1-5.9-.1z"/>'
    '<path d="M15.9 6.6c.1-1.7 1-3.1 2.6-3.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
    "</svg>"
)
BUTTON = (
    '<svg class="btn" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.2" fill="none" '
    'stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5.6" fill="currentColor"/></svg>'
)


def money(price: float) -> str:
    return f"{price:.0f}" if float(price).is_integer() else f"{price:.2f}"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def dish_html(d: dict) -> str:
    tags = []
    for t in d["dietary_tags"]:
        if t == "spicy":
            tags.append(CHILI)
        elif TAGS.get(t):
            tags.append(f'<span class="tag">{TAGS[t]}</span>')
    contains = "".join(f'<span class="al">{ALLERGENS[a][0]}</span>' for a in ALLERGENS if a in d["allergens"])
    traces = " ".join(ALLERGENS[a][0] for a in ALLERGENS if a in d["may_contain"])
    meta = contains
    if traces:
        meta += f'<span class="traces">may contain {traces}</span>'
    if not meta:
        meta = '<span class="free">no major allergens</span>'
    return f"""
      <article class="dish">
        <div class="line"><h3>{esc(d["name"])}</h3><span class="tags">{"".join(tags)}</span><span class="price">{money(d["price"])}</span></div>
        <p class="desc">{esc(d["description"])}</p>
        <div class="meta">{meta}</div>
      </article>"""


def section(title: str, dishes: list[dict], extra: str = "") -> str:
    items = "".join(dish_html(d) for d in dishes)
    return f'<section class="course"><h2><span>{esc(title)}</span></h2>{items}{extra}</section>'


def strip(names: list[str], by_name: dict) -> str:
    cells = []
    for n in names:
        d = by_name[n]
        cells.append(f'<figure><img src="{esc(d["photo"])}" alt="{esc(n)}"><figcaption>{esc(n)}</figcaption></figure>')
    return f'<div class="strip">{"".join(cells)}</div>'


def legend(dishes: list[dict]) -> str:
    used = {a for d in dishes for a in d["allergens"] + d["may_contain"]}
    items = " ".join(
        f'<span class="lg"><span class="al">{code}</span>{label}</span>'
        for a, (code, label) in ALLERGENS.items()
        if a in used
    )
    diet = (
        '<span class="lg"><span class="tag">VG</span>Vegan</span> <span class="lg"><span class="tag">V</span>Vegetarian</span> '
        f'<span class="lg"><span class="tag">GF</span>Gluten-free</span> <span class="lg">{CHILI}Spicy</span>'
    )
    return f"""
      <div class="legend">
        <div class="lg-row"><b>Allergens</b> {items}</div>
        <div class="lg-row"><b>Diet</b> {diet} <span class="lg note">&ldquo;may contain&rdquo; = possible traces</span></div>
      </div>"""


def ding_line() -> str:
    return (
        f'<div class="ding">{BUTTON}<span>Press the <b>Ding</b> button on your table and order in your own language '
        "&mdash; our AI waiter will check your allergies with you.</span></div>"
    )


def render(menu: dict) -> str:
    r = menu["restaurant"]
    dishes = menu["dishes"]
    by_name = {d["name"]: d for d in dishes}
    cat = {c: [d for d in dishes if d["category"] == c] for c in ("Starters", "Mains", "Desserts", "Drinks")}
    assert sum(len(v) for v in cat.values()) == len(dishes), "every dish needs one of the four categories"
    name = esc(r["name"]).replace("&amp;", '<em class="amp">&amp;</em>')
    hours = "Mon&ndash;Thu 11:30&ndash;22:00 &middot; Fri&ndash;Sat 11:30&ndash;23:00 &middot; Sun 12:00&ndash;21:00"

    page1 = f"""
    <div class="page">
      <header class="mast">
        <p class="kicker">{esc(r["tagline"])}</p>
        <h1>{name}</h1>
        <p class="sub">All prices in US dollars &middot; {hours}</p>
      </header>
      {strip(PRINT_PHOTOS[1], by_name)}
      <div class="cols">
        {section("Starters", cat["Starters"])}
        {section("Mains", cat["Mains"])}
      </div>
      <footer>{legend(dishes)}{ding_line()}</footer>
    </div>"""

    allergy_box = """
        <div class="box">
          <h4>Food allergies?</h4>
          <p>Every dish shows the allergens it contains. Our kitchen handles peanuts, tree nuts, sesame,
          soy, gluten, milk, eggs, fish, shellfish and molluscs. We do not remove allergens from a dish on
          request, so please choose a dish that is free from yours. The tofu for the bao is fried in a
          fryer shared with shellfish. With a severe allergy, please also speak to the manager on duty.</p>
        </div>"""

    page2 = f"""
    <div class="page p2">
      <header class="mast small">
        <h1>{name}</h1>
        <p class="kicker">Sweets &amp; drinks &middot; everything here is alcohol-free</p>
      </header>
      {strip(PRINT_PHOTOS[2], by_name)}
      <div class="cols">
        {section("Desserts", cat["Desserts"], allergy_box)}
        {section("Drinks", cat["Drinks"])}
      </div>
      <div class="info">
        <p><b>Hours</b> Mon&ndash;Thu 11:30&ndash;22:00 &middot; Fri&ndash;Sat 11:30&ndash;23:00<br>Sun 12:00&ndash;21:00 &middot; last orders 30 min before closing</p>
        <p><b>Wi-Fi</b> GingerCoal-Guest<br>Password: charcoal2026</p>
        <p><b>Paying</b> Cards, Apple Pay, Google Pay, cash<br>Split bills welcome &middot; service not included</p>
      </div>
      <footer>{legend(dishes)}{ding_line()}</footer>
    </div>"""

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{esc(r["name"])} &mdash; Menu</title>
<style>
@font-face {{ font-family: "Young Serif"; src: url("fonts/young-serif-400-normal.woff2") format("woff2"); font-weight: 400; }}
@font-face {{ font-family: "Figtree"; src: url("fonts/figtree-400-normal.woff2") format("woff2"); font-weight: 400; }}
@font-face {{ font-family: "Figtree"; src: url("fonts/figtree-400-italic.woff2") format("woff2"); font-weight: 400; font-style: italic; }}
@font-face {{ font-family: "Figtree"; src: url("fonts/figtree-500-normal.woff2") format("woff2"); font-weight: 500; }}
@font-face {{ font-family: "Figtree"; src: url("fonts/figtree-600-normal.woff2") format("woff2"); font-weight: 600; }}
@font-face {{ font-family: "Figtree"; src: url("fonts/figtree-700-normal.woff2") format("woff2"); font-weight: 700; }}
@font-face {{ font-family: "Figtree"; src: url("fonts/figtree-800-normal.woff2") format("woff2"); font-weight: 800; }}

:root {{
  --ink: #1c1917;
  --soft: #4a443f;
  --mute: #7a726b;
  --rule: #d9d3cc;
  --ember: #b2381a;
  --paper: #ffffff;
}}
@page {{ size: 8.5in 11in; margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ background: var(--paper); color: var(--ink); }}
body {{ font-family: "Figtree", sans-serif; font-size: 9.5pt; line-height: 1.35;
       -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.page {{ width: 8.5in; height: 11in; padding: 0.5in 0.55in 0.45in; display: flex; flex-direction: column;
         overflow: hidden; break-after: page; position: relative; }}
.page:last-child {{ break-after: auto; }}

/* masthead */
.mast {{ text-align: center; margin-bottom: 0.2in; }}
.mast h1 {{ font-family: "Young Serif", serif; font-weight: 400; font-size: 44pt; line-height: 1; letter-spacing: -0.5pt; }}
.mast .amp {{ font-style: normal; color: var(--ember); }}
.kicker {{ font-size: 8.5pt; font-weight: 700; letter-spacing: 2.2pt; text-transform: uppercase; color: var(--ember); margin-bottom: 6pt; }}
.mast .sub {{ margin-top: 7pt; font-size: 8.5pt; color: var(--soft); letter-spacing: 0.2pt; }}
.mast.small h1 {{ font-size: 26pt; margin-bottom: 5pt; }}
.mast.small .kicker {{ margin-bottom: 0; }}

/* photo strip */
.strip {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.12in; margin-bottom: 0.2in; }}
.strip figure {{ display: flex; flex-direction: column; }}
.strip img {{ width: 100%; aspect-ratio: 1 / 1; object-fit: cover; display: block; border-radius: 3pt; }}
.strip figcaption {{ margin-top: 3.5pt; font-size: 7.2pt; font-weight: 600; letter-spacing: 0.3pt; color: var(--soft); text-align: center; }}

/* courses */
.cols {{ display: grid; grid-template-columns: 1fr 1fr; column-gap: 0.4in; align-items: start; }}
.course h2 {{ font-family: "Young Serif", serif; font-weight: 400; font-size: 21pt; line-height: 1;
             display: flex; align-items: center; gap: 10pt; margin-bottom: 10pt; }}
.course h2::after {{ content: ""; flex: 1; border-top: 1pt solid var(--ink); transform: translateY(2pt); }}
.dish {{ padding: 5.5pt 0 6pt; border-bottom: 0.6pt solid var(--rule); break-inside: avoid; }}
.dish:last-child {{ border-bottom: 0; }}
.p2 .dish {{ padding: 8pt 0 8.5pt; }}
.p2 .course h2 {{ margin-bottom: 8pt; }}
.line {{ display: flex; align-items: baseline; gap: 5pt; }}
.line h3 {{ font-size: 12pt; font-weight: 700; letter-spacing: 0.1pt; white-space: nowrap; }}
.tags {{ display: inline-flex; align-items: center; gap: 3pt; flex: 1; }}
.tag {{ font-size: 7pt; font-weight: 800; letter-spacing: 0.4pt; color: var(--ember); }}
.chili {{ width: 11pt; height: 11pt; color: var(--ember); transform: translateY(1.5pt); }}
.price {{ font-size: 12pt; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 18pt; text-align: right; }}
.desc {{ margin-top: 2pt; color: var(--soft); font-size: 9.5pt; padding-right: 8pt; }}
.meta {{ margin-top: 3.5pt; display: flex; flex-wrap: wrap; align-items: center; gap: 3pt; }}
.al {{ display: inline-block; font-size: 6.6pt; font-weight: 700; letter-spacing: 0.4pt; line-height: 1;
       padding: 1.6pt 2.6pt 1.4pt; border: 0.7pt solid var(--ink); border-radius: 2pt; color: var(--ink); }}
.traces {{ font-size: 7.5pt; font-style: italic; color: var(--soft); margin-left: 3pt; }}
.free {{ font-size: 7.5pt; font-style: italic; color: var(--mute); }}

/* page 2 extras */
.box {{ margin-top: 14pt; border: 0.8pt solid var(--ink); border-radius: 3pt; padding: 8pt 10pt 9pt; font-size: 8.6pt; color: var(--soft); }}
.box h4 {{ font-family: "Young Serif", serif; font-weight: 400; font-size: 13pt; color: var(--ink); margin-bottom: 3pt; }}
.info {{ display: grid; grid-template-columns: 1.25fr 0.85fr 1.1fr; gap: 0.2in; margin-top: auto; padding-top: 0.15in;
         font-size: 8.4pt; color: var(--soft); line-height: 1.4; }}
.info b {{ display: block; color: var(--ink); font-weight: 700; text-transform: uppercase; letter-spacing: 1pt; font-size: 7pt; margin-bottom: 1pt; }}

/* footer */
footer {{ margin-top: auto; border-top: 0.8pt solid var(--ink); padding-top: 6pt; }}
.info + footer {{ margin-top: 0.14in; }}
.legend {{ font-size: 7.3pt; color: var(--soft); }}
.lg-row {{ display: flex; flex-wrap: wrap; align-items: center; column-gap: 6.5pt; row-gap: 3pt; }}
.lg-row + .lg-row {{ margin-top: 3pt; }}
.lg-row > b {{ color: var(--ink); font-weight: 700; text-transform: uppercase; letter-spacing: 1pt; font-size: 6.8pt; width: 50pt; }}
.lg {{ display: inline-flex; align-items: center; gap: 2.5pt; white-space: nowrap; }}
.lg.note {{ font-style: italic; margin-left: auto; }}
.ding {{ display: flex; align-items: center; justify-content: center; gap: 6pt; margin-top: 7pt; padding-top: 6pt;
         border-top: 0.6pt solid var(--rule); font-size: 8.6pt; color: var(--ink); }}
.ding .btn {{ width: 12pt; height: 12pt; color: var(--ember); flex: none; }}
</style>
</head>
<body>
{page1}
{page2}
</body>
</html>
"""


def build() -> None:
    menu = json.loads((DEMO / "menu.json").read_text())
    (DEMO / "menu.html").write_text(render(menu))
    pdf = DEMO / "menu.pdf"
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--allow-file-access-from-files",
         "--virtual-time-budget=5000", f"--print-to-pdf={pdf}", (DEMO / "menu.html").as_uri()],
        check=True, capture_output=True,
    )
    print(f"wrote {pdf.relative_to(DEMO)}")


def check() -> bool:
    menu = json.loads((DEMO / "menu.json").read_text())
    pdf = DEMO / "menu.pdf"
    problems = []

    # data rules
    allowed_tags = set(TAGS)
    for key in ("name", "tagline", "currency"):
        if not menu["restaurant"].get(key):
            problems.append(f"restaurant.{key} missing")
    names = [d["name"] for d in menu["dishes"]]
    if len(names) != len(set(names)):
        problems.append("duplicate dish names")
    for d in menu["dishes"]:
        for key in ("name", "description", "category", "price", "ingredients", "allergens", "may_contain", "dietary_tags", "photo"):
            if key not in d:
                problems.append(f"{d.get('name')}: missing {key}")
        if not isinstance(d["price"], (int, float)):
            problems.append(f"{d['name']}: price is not a number")
        for a in d["allergens"] + d["may_contain"]:
            if a not in ALLERGENS:
                problems.append(f"{d['name']}: unknown allergen {a}")
        if set(d["allergens"]) & set(d["may_contain"]):
            problems.append(f"{d['name']}: allergen listed as both contains and may_contain")
        for t in d["dietary_tags"]:
            if t not in allowed_tags:
                problems.append(f"{d['name']}: unknown tag {t}")
        if "vegan" in d["dietary_tags"] and set(d["allergens"]) & {"eggs", "milk", "fish", "crustaceans", "molluscs"}:
            problems.append(f"{d['name']}: vegan but has animal allergens")
        if "gluten_free" in d["dietary_tags"] and "gluten" in d["allergens"]:
            problems.append(f"{d['name']}: gluten_free but contains gluten")
        if d["photo"] is not None and not (DEMO / d["photo"]).is_file():
            problems.append(f"{d['name']}: photo {d['photo']} not found")
    for k in menu["knowledge"]:
        if not k.get("title") or not k.get("content"):
            problems.append("knowledge item without title/content")

    # pdf rules
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout
    pages = int(re.search(r"Pages:\s+(\d+)", info).group(1))
    size = re.search(r"Page size:\s+([\d.]+) x ([\d.]+) pts", info)
    if pages != 2:
        problems.append(f"PDF has {pages} pages, expected 2")
    if not size or (round(float(size.group(1))), round(float(size.group(2)))) != (612, 792):
        problems.append(f"PDF page size is not US Letter: {size and size.group(0)}")
    fonts = subprocess.run(["pdffonts", str(pdf)], capture_output=True, text=True, check=True).stdout.splitlines()[2:]
    for row in fonts:
        cols = row.split()  # ... emb sub uni object-id generation
        if cols[-5] != "yes" or cols[-3] != "yes":
            problems.append(f"font not embedded or without unicode map: {row}")
        if "Type 3" in row:
            problems.append(f"Type 3 font (text may not extract): {row}")
    text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    flat = " ".join(text.split())
    for d in menu["dishes"]:
        if not re.search(re.escape(d["name"]) + r"\s.{0,40}?\b" + re.escape(money(d["price"])) + r"\b", flat):
            problems.append(f"{d['name']} with price {money(d['price'])} not found in PDF text")

    for p in problems:
        print("PROBLEM:", p)
    print(f"{pages} pages, {len(menu['dishes'])} dishes, {len(fonts)} fonts, {len(problems)} problems")
    return not problems


if __name__ == "__main__":
    if "--check" not in sys.argv:
        build()
    sys.exit(0 if check() else 1)
