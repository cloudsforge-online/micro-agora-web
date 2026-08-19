/**
 * Where this app talks to, resolved at runtime from `window.location`, never from a build-time
 * constant.
 *
 * `apiBase()` is the one address that decides what a reader sees, and it is composed from TWO
 * things: the apex this page was served from, and the network the reader is VIEWING. The second
 * half is what `lib/viewed.ts` exists for, and it is why this file has no module-level constant —
 * a value captured at import time would go on naming the network the tab started on after the
 * reader switched away from it.
 */
import { cloudsforgeHosts, type CloudsForgeHosts, type SurfaceKey } from '@cloudsforge/ui'
import { BASE } from './routes.ts'
import { viewedApiOrigin } from './viewed.ts'

/**
 * The surface this application IS.
 *
 * `agora`, registered as a `service` with `inSwitcher: false`, subdomain `agora`, accent `#bf69a9`
 * and glyph `⁂`. `markId: null` — micro-brand has no agora set, and the reasoning for borrowing the
 * company's card rather than another product's is in `index.html`.
 *
 * The switcher decision is the one worth knowing about here, and `surfaces.ts` records it at
 * length: the product switcher is the control somebody uses to move between the things they came to
 * DO, and a conversation is not one of them. People arrive at Agora because a post was linked to
 * them or because they wanted to ask something after using something else. That is a weaker
 * position than a rule and it is stated as one — the row is cheap to change and the accent has
 * already been paid for.
 */
export const PRODUCT: SurfaceKey = 'agora'

/** The name reported to the observability ingest and shown in error copy. */
export const APP_NAME = 'agora-web'

/**
 * The accent block this page's `<html>` names.
 *
 * `agora` is a real selector in `ui/packages/ui/src/tokens.css`. Naming a product with no block
 * would fall through to the company ember in complete silence, which is the exact failure tokens.css
 * calls out and the one `admin` had and `explorer` still has. `test/brand-chrome.test.ts` asserts
 * the selector this page names really exists upstream.
 */
export const ACCENT_SURFACE = 'agora'

/**
 * The sentence a search result carries, declared ONCE.
 *
 * It leads with the account, because that is the fact that decides whether a stranger reads any
 * further: this is not one more network asking them to sign up. `test/seo.test.ts` compares this
 * byte for byte with the description meta in `index.html`, so the copy a link-preview fetcher gets
 * — those generally do not execute JavaScript — cannot drift from the copy a crawler that does
 * execute JavaScript ends up with.
 */
export const SURFACE_DESCRIPTION =
  'The CloudsForge public square. Talk about crypto, the chain, or anything else with the rest of ' +
  'the ecosystem — with the account you already have, and no second sign-up.'

/** The same four names `cloudsforgeHosts()` treats as development. Kept in step by test. */
export function isLocal(hostname: string): boolean {
  return (
    hostname === '' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local')
  )
}

/**
 * Whether this bundle is being served from an address the surface registry knows.
 *
 * `cloudsforgeHosts()` derives the apex by stripping a KNOWN first label. Served from an unknown
 * name — a preview deployment, somebody's tunnel — the whole name becomes the apex and every
 * CloudsForge URL derived from it resolves one level too deep. The app still renders, because
 * nothing here is a security boundary this bundle enforces; but it says so, once, in the shell.
 */
export function isRegisteredPlacement(
  pageOrigin: string,
  hostname: string,
  estate: CloudsForgeHosts,
): boolean {
  if (isLocal(hostname)) return true
  if (!pageOrigin) return true
  try {
    return new URL(estate[PRODUCT]).origin === pageOrigin
  } catch {
    return false
  }
}

/** Every CloudsForge base URL, for the current environment and the VIEWED network. */
export function hosts(): CloudsForgeHosts {
  return cloudsforgeHosts()
}

/**
 * The port micro-agora binds in a development stack — `PORT` in `micro-agora/.env.example`, and the
 * `devPort` on this surface's registry row. It is what a developer CALLS; vite serves 5197.
 */
const AGORA_API_DEV_PORT = 4150

/**
 * The API base for a DEVELOPMENT STACK, and the empty string everywhere else.
 *
 * One question only: "is micro-agora somewhere other than this origin?" It is, exactly once — under
 * `pnpm dev`, where the service runs directly on 4150 with no gateway in front of it. Everywhere
 * else the answer is "no, it is on this origin", and the empty string says so.
 *
 * ── THE MOUNT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────────────
 *
 * Wave 3c made this bundle `<apex>/agora`, so a production read is `/agora/v1/...` rather than
 * `/v1/...`. That prefix belongs to `apiBase()` below, not to this function, and the separation is
 * not tidiness:
 *
 *   * this function is a PURE FUNCTION OF THE HOSTNAME, which is what lets `test/hosts.test.ts`
 *     pin it without a browser, and a mount is not a fact about a hostname;
 *   * the dev branch must NOT carry the mount — there is no gateway under `pnpm dev` and
 *     therefore nothing to strip `/agora` back off, so `localhost:4150/agora/v1` would 404;
 *   * and `apiBase()` has to compose the mount with the VIEWED ESTATE's origin anyway, which this
 *     function knows nothing about.
 *
 * Drawn by COMPARING HOSTNAMES rather than by a `DEV` flag, because a flag is a build-time constant
 * and this repository has none: an image built for production and opened on localhost would then
 * point at a host that is not there.
 */
export function resolveApiBase(hostname: string): string {
  return isLocal(hostname) ? `http://localhost:${AGORA_API_DEV_PORT}` : ''
}

/**
 * micro-agora's base URL, on the network the reader is VIEWING. Call it per request.
 *
 * THREE questions now, and separating them is what keeps the network switcher working:
 *
 *   1. `resolveApiBase` — "is this a development stack?" The only case where micro-agora is
 *      somewhere other than this origin. A pure function of the hostname, so `test/hosts.test.ts`
 *      can pin it without a browser.
 *   2. `viewedApiOrigin()` — "WHICH ESTATE is the reader looking at?" An ORIGIN, or `''` while
 *      they are reading the one that served this page (micro-org#459).
 *   3. `BASE` — "WHERE UNDER that estate does the square live?" `/agora`, since wave 3c.
 *
 * ── 2 AND 3 ARE DIFFERENT QUESTIONS, AND CONFLATING THEM BREAKS THE SWITCHER ──────────────────
 *
 * This was `resolveApiBase(...) || viewedApiOrigin()`, and the `||` was correct only while the
 * production answer to 1 was the empty string. The first version of this change made
 * `resolveApiBase` return the mount, which is truthy — so `viewedApiOrigin()` STOPPED BEING
 * CONSULTED AT ALL, and pressing Testnet in the bar would have gone on reading mainnet while the
 * amber band said otherwise. On a surface where the whole point is that a post lands in the square
 * the reader believes they are in, that is the worst failure this bundle has.
 *
 * micro-ui's registry says the same thing on `explorer`'s row, which is parked for a harder
 * version of it: "a consolidated surface's reads are origin PLUS MOUNT, so every caller has to
 * learn the difference between which estate and where under it". Agora is the easy version —
 * nothing here keys AUTH on the origin, so the bearer goes to either estate as it always did, and
 * the composition below is the whole change.
 *
 * The dev branch returns early rather than composing, because a local stack has no gateway to
 * strip `/agora` back off and no sibling estate to view — `NetworkSwitcher` hides itself
 * off-registry.
 *
 * A FUNCTION, NOT A CONSTANT, and that is load-bearing. A module-level string is captured on first
 * import and goes on naming the network the tab opened on; every read in this bundle calls this at
 * request time so that switching the network re-points the very next fetch — which is what makes
 * the amber band above the timeline tell the truth.
 */
export function apiBase(): string {
  const dev = resolveApiBase(typeof window === 'undefined' ? '' : window.location.hostname)
  if (dev) return dev
  // `''` + `/agora` when reading this estate; `https://testnet.<apex>` + `/agora` when reading the
  // other one. Same mount either way — both estates serve the square from the same folder.
  return `${viewedApiOrigin()}${BASE}`
}

/** The page origin, or a stable placeholder when there is no document (tests). */
export function pageOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

/** Whether the current address is one the registry knows. Read by the shell. */
export function placementIsKnown(): boolean {
  if (typeof window === 'undefined') return true
  return isRegisteredPlacement(window.location.origin, window.location.hostname, cloudsforgeHosts())
}
