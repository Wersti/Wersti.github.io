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

/**
 * satori needs real font bytes, with two constraints its OpenType parser
 * imposes:
 *
 *   1. No WOFF2 — the wrapper is rejected outright, so it has to be
 *      decompressed to a bare SFNT first.
 *   2. No variable fonts — it chokes on the `fvar` table. The site serves
 *      variable Inter, but these images use the static @fontsource builds,
 *      which is why each weight is a separate file here.
 *
 * All of it is build-only. Nothing extra reaches the browser.
 */

// Static (non-variable) faces, one file per weight.
const FONT_FILES = {
  sans400: '@fontsource/inter/files/inter-latin-400-normal.woff2',
  sans700: '@fontsource/inter/files/inter-latin-700-normal.woff2',
  mono400: '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
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
  const sans400 = await toSfnt(FONT_FILES.sans400);
  const sans700 = await toSfnt(FONT_FILES.sans700);
  const mono400 = await toSfnt(FONT_FILES.mono400);

  return [
    { name: 'Inter', data: sans400, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: sans700, weight: 700 as const, style: 'normal' as const },
    { name: 'JetBrains Mono', data: mono400, weight: 400 as const, style: 'normal' as const },
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
        backgroundImage: `radial-gradient(ellipse 70% 70% at 82% 30%, #0b759066, transparent 70%)`,
        padding: '72px 80px',
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontFamily: 'JetBrains Mono',
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
              fontSize: 82,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
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
              fontFamily: 'JetBrains Mono',
              fontSize: 22,
              color: TEXT_SECONDARY,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', color: TEXT_PRIMARY, letterSpacing: '0.2em' },
                  children: 'WERSTI.',
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

  const svg = await satori(tree as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });

  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}
