# Wersti.github.io

My personal portfolio. Static site, built with Astro, deployed to GitHub Pages.

**Visit:** [https://wersti.github.io/](https://wersti.github.io/)

## Stack

| | |
|---|---|
| Framework | [Astro](https://astro.build) — static output, zero client JS by default |
| Styles | [Tailwind CSS v4](https://tailwindcss.com) via `@tailwindcss/vite`, CSS-first `@theme` config |
| WebGL | [OGL](https://github.com/oframe/ogl) (~10 KB) — one shader, one draw call |
| OG images | [satori](https://github.com/vercel/satori) + resvg, rendered at build time |
| Deploy | GitHub Actions → GitHub Pages |

## Local development

Everything runs in Docker. Nothing needs to be installed on the host beyond
Docker itself — no Node, no npm, no `node_modules` on your machine.

```bash
docker compose up dev          # dev server at http://localhost:4321
docker compose run --rm dev npm run build    # production build into dist/
docker compose run --rm dev npm run check    # type-check
```

After changing `package.json`, rebuild the image so the new dependencies land
inside it: `docker compose build dev`. Dependencies are installed **into the
image**, and an anonymous volume shadows `/app/node_modules`, so the host bind
mount can't overwrite them with a non-existent host directory.

## Architecture notes

**Design tokens** (`src/styles/global.css`) use two levels of indirection:
numeric primitive scales (`--color-ink-950`, `--color-signal-300`) and semantic
aliases on top (`--color-surface`, `--color-text-accent`). Components only ever
consume the semantic layer, so recolouring the site means editing one block.

**Motion** is CSS scroll-driven (`animation-timeline: view()`) rather than
scroll event listeners, so it runs on the compositor and stays exact at any
scroll speed. Every effect is wrapped in `@supports` and disabled under
`prefers-reduced-motion: reduce`.

Two non-obvious constraints, both of which will silently break things:

- Scroll-driven rules use `animation-*` **longhands**, never the `animation`
  shorthand. The shorthand resets `animation-timeline` to `auto`, and CSS
  minification can reorder it after the timeline declaration.
- No `overflow: hidden` on a section containing parallax layers. Any non-visible
  `overflow` makes an element a scroll container, and `view()` resolves against
  the nearest one — freezing descendants at mid-progress.

**The hero attractor** (`src/scripts/attractor.ts`) integrates the Lorenz system
on the CPU each frame and renders it as GPU points. It only loads when WebGL is
available, the viewport is desktop-sized, the canvas is on screen, and reduced
motion is not requested; otherwise a CSS gradient fallback stands in.

**Project data** is fetched from the GitHub API at build time, not in the
browser. Visitors never hit the rate limit, there is no loading flash, and the
content is in the HTML for crawlers. A failed fetch renders a fallback card
rather than failing the build.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`. The repository's
Pages source must be set to **GitHub Actions** (Settings → Pages).
