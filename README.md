# Syntxd

A stateless, client-side viewer and formatter for structured data — JSON today, CSV/YAML/XML on the roadmap. Paste JSON, format or minify it, and quickly search and explore an interactive tree — everything runs locally in your browser with no backend and no data leaving the page.

## Features

- **Paste & auto-parse** — debounced, live validation with line/column error messages
- **Format / Minify** — pretty-print (2-space indent) or collapse to a single line
- **Interactive tree** — collapsible nodes, type-aware syntax coloring, expand/collapse all
- **Search** — case-insensitive matching across keys *and* values with match highlighting, a live match counter, and ↑/↓ navigation that auto-expands to each hit
- **JSONPath & filters** — query the document with JSONPath (member/index/wildcard/slice/union/recursive descent) and filter expressions (`[?(@.price > 20)]`); results are listed and highlighted in the tree
- **Copy** — copy the formatted JSON to your clipboard
- **Responsive** — side-by-side panes on wide screens, stacked on narrow ones; light and dark themes

## Getting started

Requires the Node version pinned in [`.tool-versions`](.tool-versions) (install via `mise install` or `asdf install`).

```bash
npm install
npm run dev
```

Open the URL printed by Vite (default `http://localhost:5173`).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with HMR |
| `npm run build` | Typecheck (`tsc -b`) and build the static site to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run oxlint |
| `npm run test` | Run Vitest unit tests |

## Deployment

`npm run build` emits a fully static site in `dist/`. Asset paths are relative (`base: './'`), so the build can be hosted from any path — GitHub Pages, S3, Netlify, or a plain file server — without additional configuration.

### Self-hosting

Every GitHub release includes `syntxd-<version>.tar.gz` and `syntxd-<version>.zip`, each containing the built static site (unpacked contents of `dist/`). Download either archive, extract it, and serve the directory from any static file host — nginx, Apache, S3, Netlify, caddy, etc. No build step or runtime is required.

### GitHub Pages (automated)

The [release workflow](.github/workflows/release.yaml) builds the site and publishes it to GitHub Pages after every successful release (i.e. every merge to `main`). To enable it, do this once:

1. Repo **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
2. Merge to `main` (or run the workflow manually); the site appears at `https://<owner>.github.io/<repo>/`.

## Querying

Switch the toolbar to **JSONPath** to run structured queries. Supported syntax:

```
$                      root
$.a.b                  dot member access
$['a']['b']            bracket member access
$[0]  $[-1]            array index (negative counts from the end)
$[*]  $.*              wildcard
$[0,2,'name']          union of indices and names
$[1:3]  $[::2]         array slices (Python-style, negatives supported)
$..price               recursive descent (also bare `..` and `..*`)
$[?(@.price > 20)]     filter selectors
```

Filter expressions support `@` (current node) and `$` (root) paths, comparison
(`== != < <= > >=`), regex `=~ /pattern/flags`, and boolean `&& || !` with
parentheses. `==`/`!=` are strict deep-equality (no type coercion). A bare
`@.prop` condition is truthy unless missing, `null`, or `false`. The engine is a
dependency-free, no-`eval` implementation in
[`src/lib/jsonpath.ts`](src/lib/jsonpath.ts).

## How it works

- **State** lives entirely in React component state; nothing is persisted.
- **Parsing & search logic** is pure and lives in [`src/lib/json.ts`](src/lib/json.ts): the JSON value is walked once to produce a renderable tree plus an ordered list of search matches (keys and primitive values, never array indices).
- **JSONPath** ([`src/lib/jsonpath.ts`](src/lib/jsonpath.ts)) is a hand-rolled parser + evaluator (tokenizer → AST → evaluation, no `eval`).
- **Rendering** is a recursive component ([`src/components/JsonTreeNode.tsx`](src/components/JsonTreeNode.tsx)) that highlights matches and auto-expands ancestors when you navigate between hits.

## Testing

```bash
npm run test
```

Unit tests cover parsing (including error location), formatting, the tree/search builder in [`src/lib/json.test.ts`](src/lib/json.test.ts), and the JSONPath engine in [`src/lib/jsonpath.test.ts`](src/lib/jsonpath.test.ts).

## License

[MIT](LICENSE)