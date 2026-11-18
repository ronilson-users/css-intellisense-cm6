# CSS Intellisense
### Acode plugin

Autocomplete for **classes** and **IDs** defined in your project's CSS/SCSS/LESS/Stylus files, right inside the [Acode](https://acode.foxdebug.com/) editor. Type `class="` or `id="` and instantly see which selectors already exist in your project — no more switching to the CSS file to check.

![ID autocomplete finding #main-title](assets/autocomplete-id-encontrado.jpg)

## ✨ Features

- **Type-aware autocomplete** — `class=` / `className=` suggests classes, `id=` suggests IDs. Never mixed up.
- **Works across languages**: `.html`, `.htm`, `.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte`, `.astro`.
- **Reads every stylesheet in the project**: `.css`, `.scss`, `.less`, `.styl`.
- **Accurate selector extraction**: an AST parser handles plain CSS with precision, backed by a text-scan fallback so nothing is missed even if an unusual comment or syntax trips up the parser.
- **No false positives**: hex colors like `#fff` or `#0d6efd` are never suggested as ID selectors.
- **Always up to date**: the class/ID index refreshes automatically when you save a CSS file or switch tabs — loading happens in the background so the editor never freezes.
- **Source tracking**: every suggestion shows which stylesheet it came from, handy when a project has multiple CSS files.
- **Plays well with others**: merges into Acode/CodeMirror's native autocomplete instead of overriding it, so it works alongside Emmet, React Native Snippets, and other completion plugins.
- **Quick commands** to manually refresh the cache or check what's currently indexed.

## 🚀 Usage

### Class autocomplete

Start typing inside `class="..."` (or `className="..."` in JSX) and matching classes from your CSS appear in the suggestion list.

![Suggestion appearing as a prefix is typed](assets/autocomplete-id-btn.jpg)

### ID autocomplete

Same idea inside `id="..."` — only `#id` selectors from your CSS are suggested:

![Typing inside an id attribute](assets/autocomplete-id.jpg)

Selectors are picked up no matter where they sit in the source file — even after large comment blocks, section dividers (`/* ==== */`), or other rules:

![IDs declared in the source CSS file](assets/css-fonte-ids.jpg)

### Commands

Available from Acode's command palette:

| Command | Shortcut | What it does |
|---|---|---|
| Refresh CSS Cache | `Ctrl+Alt+R` | Reloads the CSS index immediately — useful right after creating a new stylesheet |
| Show CSS Cache Status | — | Lists every indexed file with its class/ID counts |

## 🗺️ Roadmap

- Suggest selectors inside `.css` files too (for nesting / `@apply`).
- Jump-to-definition from HTML straight to the matching selector.
- CSS Modules support (`styles.myClass`).

## 🤝 Contributing

Suggestions, issues, and PRs are welcome. If a selector isn't showing up, run `cssIntellisense.status` first to confirm the file was indexed before opening an issue.

## 📄 License

Distributed under the license specified in the project's `plugin.json`.
