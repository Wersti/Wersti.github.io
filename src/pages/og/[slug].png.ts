/**
 * Per-page Open Graph images, generated at build time.
 *
 * A static endpoint: `getStaticPaths` enumerates the pages, Astro writes each
 * result to `dist/og/<slug>.png`. No server, no request-time work.
 */

import type { APIRoute } from 'astro';
import { renderOgImage } from '../../lib/og';

const CARDS = {
  home: {
    eyebrow: 'Telematics Engineer · Mathematician',
    title: 'Networks, numbers, and systems that hold up.',
  },
  projects: {
    eyebrow: 'Selected work',
    title: 'Projects — networking, numerics, and embedded systems.',
  },
  contact: {
    eyebrow: 'Say hello',
    title: 'Get in touch.',
  },
} as const;

export function getStaticPaths() {
  return Object.keys(CARDS).map((slug) => ({ params: { slug } }));
}

export const GET: APIRoute = async ({ params }) => {
  const card = CARDS[params.slug as keyof typeof CARDS];

  // getStaticPaths constrains slug to the keys above, so this is unreachable in
  // a static build; it exists so a typo shows up as a 404 rather than a crash.
  if (!card) return new Response('Not found', { status: 404 });

  const png = await renderOgImage(card);

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
