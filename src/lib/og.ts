/**
 * Open Graph image generation.
 *
 * Rendered at build time: satori turns a JSX-like tree into SVG, resvg
 * rasterises it to PNG. Nothing runs at request time and nothing ships to the
 * browser — the output is a static file in `dist`.
 *
 * Hand-built element objects rather than JSX, so this stays a plain .ts module
 * and does not pull a JSX runtime into the build for four images.
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { decompress } from 'wawoff2';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const WIDTH = 1200;
const HEIGHT = 630;

// Matches the site's semantic tokens. Duplicated as literals because satori
// resolves no custom properties — it has no cascade.
const SURFACE = '#0a0f14';
const TEXT_PRIMARY = '#f4f7f9';
const TEXT_SECONDARY = '#93a7b5';
const ACCENT = '#6aeaff';
/** --color-signal-700 (#0b7590) at 40% alpha: the hero glow. */
const GLOW = '#0b759066';

/**
 * satori needs real font bytes, with two constraints its OpenType parser
 * imposes:
 *
 *   1. No WOFF2 — the wrapper is rejected outright, so it has to be
 *      decompressed to a bare SFNT first.
 *   2. No variable fonts — it chokes on the `fvar` table. The site serves
 *      variable fonts, but these images use the static @fontsource builds,
 *      which is why each weight is a separate file here.
 *
 * All of it is build-only. Nothing extra reaches the browser.
 */

// Static (non-variable) faces, one file per weight.
const FONT_FILES = {
  serif400: '@fontsource/newsreader/files/newsreader-latin-400-normal.woff2',
  serifItalic: '@fontsource/newsreader/files/newsreader-latin-400-italic.woff2',
  mono400: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
} as const;

/**
 * Decompress one WOFF2 to SFNT bytes.
 *
 * Strictly one at a time, and copied via Buffer.from the instant the call
 * returns. wawoff2 is a WASM module: decompress() hands back a Uint8Array that
 * is a *view onto the shared WASM heap*, not a copy. Decompressing a second
 * font while still holding the first view overwrites it in place — which then
 * surfaces far away as "Unsupported OpenType signature" from satori.
 */
async function toSfnt(specifier: string): Promise<Buffer> {
  // Resolved through the package rather than a hardcoded path, so a dependency
  // update that moves the files fails loudly at build instead of silently
  // falling back to a default face.
  const woff2 = await readFile(require.resolve(specifier));
  return Buffer.from(await decompress(woff2));
}

async function loadFonts() {
  const serif400 = await toSfnt(FONT_FILES.serif400);
  const serifItalic = await toSfnt(FONT_FILES.serifItalic);
  const mono400 = await toSfnt(FONT_FILES.mono400);

  return [
    { name: 'Newsreader', data: serif400, weight: 400 as const, style: 'normal' as const },
    { name: 'Newsreader', data: serifItalic, weight: 400 as const, style: 'italic' as const },
    { name: 'IBM Plex Mono', data: mono400, weight: 400 as const, style: 'normal' as const },
  ];
}

let fontsPromise: ReturnType<typeof loadFonts> | undefined;

export interface OgOptions {
  title: string;
  eyebrow: string;
}

export async function renderOgImage({ title, eyebrow }: OgOptions): Promise<Buffer> {
  // Fonts are read once and shared across every image in a build.
  fontsPromise ??= loadFonts();
  const fonts = await fontsPromise;

  const tree = {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: SURFACE,
        // Echoes the hero's radial glow so the card and the site read as one.
        backgroundImage: `radial-gradient(ellipse 70% 70% at 82% 30%, ${GLOW}, transparent 70%)`,
        padding: '72px 80px',
        fontFamily: 'Newsreader',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontFamily: 'IBM Plex Mono',
              fontSize: 24,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: ACCENT,
            },
            children: eyebrow,
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontSize: 96,
              fontWeight: 400,
              lineHeight: 1.02,
              letterSpacing: '-0.015em',
              color: TEXT_PRIMARY,
              maxWidth: 940,
            },
            children: title,
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: '1px solid #ffffff26',
              paddingTop: 28,
              fontFamily: 'IBM Plex Mono',
              fontSize: 22,
              color: TEXT_SECONDARY,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', fontFamily: 'Newsreader', fontSize: 36, color: TEXT_PRIMARY },
                  children: 'Wersti.',
                },
              },
              {
                type: 'div',
                props: { style: { display: 'flex' }, children: 'wersti.github.io' },
              },
            ],
          },
        },
      ],
    },
  };

  let svg: string;
  try {
    svg = await satori(tree as Parameters<typeof satori>[0], {
      width: WIDTH,
      height: HEIGHT,
      fonts,
    });
  } catch (err) {
    // A satori failure (bad font bytes, layout error) must not crash the whole
    // build. Log a clear message so the cause is findable, then re-throw so
    // the route handler can surface a 500 rather than writing a corrupt PNG.
    console.error(`[og] satori failed for "${eyebrow} / ${title}":`, err);
    throw err;
  }

  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}
