# laughing-octo-potato

## Dashboard

Open `dashboard/index.html` in a browser. There is no build step. It loads React, Tailwind and Babel from public CDNs, so it needs an internet connection.

- **Usage**: total button uses and uses per function (translation, read aloud, allergen info), each compared with the previous period. A Daily / Weekly / Monthly chart shows exact counts on hover. It currently runs on generated demo data: replace the `USAGE` array in `dashboard/index.html` with records shaped `{ date, translate, read, allergen }`.
- **Menu**: business owners add meals with a name, photo and ingredients. Allergens (gluten, dairy, eggs, peanuts, tree nuts, soy, fish, shellfish, sesame) are detected from ingredient names, and owners can add or remove any of them before saving. **Export** shows the menu as JSON to load onto the button. The menu is stored in the browser (localStorage) for now.
- **Assistant**: settings for the AI on the button: its name and greeting, tone (friendly, professional, playful, calm), answer length, free-text instructions on how to talk to guests, facts about the restaurant, languages, voice and speaking speed, and allergen safety options. A live preview shows example replies built from these settings and the menu, and can read them aloud. Settings are included in the menu export.
- **Effects** switch (top right): optional count-up numbers, card spotlight and fade-in, in the style of ReactBits. Off by default.

The look follows shadcn/ui (zinc palette, black / grey / white), recreated with Tailwind classes rather than installed components.
