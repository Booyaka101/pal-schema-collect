// Minimal GitHub REST v3 client (no dependencies, Node >= 18 global fetch).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const API_BASE = process.env.PALSC_API_BASE || 'https://api.github.com';

/** --token flag > GH_TOKEN > GITHUB_TOKEN > `gh auth token`. Returns null if none. */
export function resolveToken(flagToken) {
  if (flagToken) return flagToken;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const t = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (t) return t;
  } catch {
    /* gh CLI not installed or not logged in */
  }
  return null;
}

export class GitHubApi {
  /** @param {string} repo "owner/name" @param {string|null} token */
  constructor(repo, token) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`invalid --repo "${repo}" (expected owner/name)`);
    this.repo = repo;
    this.token = token;
  }

  async req(method, path, body, opts = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'palsc (pal-schema-collect)',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`Could not reach GitHub API (${API_BASE}): ${e.cause?.message || e.message}`);
    }
    if (opts.allow404 && res.status === 404) return null;
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data?.errors ? ` ${JSON.stringify(data.errors)}` : '';
      throw new Error(`GitHub API ${method} ${path} -> ${res.status}: ${data?.message || res.statusText}${detail}`);
    }
    return data;
  }

  get(path, opts) {
    return this.req('GET', path, undefined, opts);
  }

  repoPath(sub) {
    return `/repos/${this.repo}${sub}`;
  }
}

/** Git blob SHA-1 of a buffer — matches the `sha` GitHub lists for file contents. */
export function gitBlobSha(buf) {
  const h = createHash('sha1');
  h.update(`blob ${buf.length}\0`);
  h.update(buf);
  return h.digest('hex');
}

/** Decode a contents-API response object's base64 payload to utf8 text. */
export function decodeContent(obj) {
  return Buffer.from(obj.content, 'base64').toString('utf8');
}
