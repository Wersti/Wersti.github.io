/**
 * Public repositories, fetched once at build time and shared by every page
 * that lists projects. Never throws: a failed fetch returns `ok: false` so the
 * page can render a fallback instead of failing the build.
 */

export interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  archived: boolean;
  topics?: string[];
  updated_at: string;
}

export interface Project extends Repo {
  /** Short domain label shown above the title, e.g. "Wireless communications". */
  field: string;
  /** Human-readable title; falls back to the repo name. */
  title: string;
  topicsShown: string[];
}

/** Repos that are not projects: the profile README and this site itself. */
const EXCLUDED = new Set(['Wersti', 'Wersti.github.io']);

/**
 * Curated framing for known repos. Anything not listed still appears, using
 * its repo name and a field derived from its language.
 */
const CURATED: Record<string, { title: string; field: string }> = {
  'joint-unicast-multigroup-multicast': {
    title: 'Joint unicast & multi-group multicast',
    field: 'Massive MIMO · Bachelor’s thesis',
  },
  'infinite-laplacian-image-interpolation': {
    title: 'Infinite-Laplacian image interpolation',
    field: 'PDEs · Numerical methods',
  },
  'cryptography-playground': {
    title: 'Cryptography playground',
    field: 'Cryptography',
  },
};

/** Curated repos keep this order; the rest follow by stars, then recency. */
const ORDER = Object.keys(CURATED);

let cache: Promise<{ ok: boolean; projects: Project[] }> | undefined;

export function getProjects() {
  cache ??= load();
  return cache;
}

async function load(): Promise<{ ok: boolean; projects: Project[] }> {
  const token = import.meta.env.GITHUB_TOKEN;

  try {
    const res = await fetch('https://api.github.com/users/Wersti/repos?sort=updated&per_page=100', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'wersti-portfolio-build',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);

    const repos: Repo[] = await res.json();
    const projects = repos
      .filter((r) => !r.fork && !r.archived && !EXCLUDED.has(r.name))
      .map((r) => ({
        ...r,
        title: CURATED[r.name]?.title ?? r.name,
        field: CURATED[r.name]?.field ?? r.language ?? 'Project',
        topicsShown: (r.topics ?? []).slice(0, 4),
      }))
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.name);
        const ib = ORDER.indexOf(b.name);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
        if (b.stargazers_count !== a.stargazers_count) return b.stargazers_count - a.stargazers_count;
        return Date.parse(b.updated_at) - Date.parse(a.updated_at);
      });

    return { ok: true, projects };
  } catch (err) {
    console.warn('[github] Could not fetch repositories:', err);
    return { ok: false, projects: [] };
  }
}
