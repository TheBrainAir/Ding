# laughing-octo-potato

## Dashboard

Open `dashboard/index.html` in a browser (no build step).

- **Usage**: total button uses, split by function (translation, read aloud/questions, allergen info), with daily / weekly / monthly charts. Currently runs on generated demo data; to use real data, replace `demoUsage()` in `dashboard/app.js` with records shaped `{date:'YYYY-MM-DD', translate:n, read:n, allergen:n}`.
- **Menu admin**: business owners add meal names, photos and ingredients. Common allergens are detected automatically from the ingredients. Menu is stored in the browser (localStorage) for now; **Export JSON** downloads it for loading onto the button.
