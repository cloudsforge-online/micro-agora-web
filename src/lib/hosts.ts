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
 * The API base for a development stack, and the empty string everywhere else.
 *
 * In production the bundle and the service are ONE ORIGIN: nginx serves this bundle at
 * `agora.<apex>` and micro-agora answers `/v1/...` behind the same hostname, which is the
 * arrangement `pool.<apex>` and `explorer.<apex>` already have in `deploy/gateway/dynamic/
 * estate-web.yml` — the bundle router matches the Host at priority 500, the API router matches Host
 * plus `PathPrefix('/v1')` at 600. So the base is empty and every request stays relative.
 *
 * An UNREGISTERED placement resolves relative too, deliberately: composing
 * `https://agora.<whatever-this-is>` for a preview deployment invents a hostname that does not
 * exist, and the failure then presents as a network error rather than as the thing it is. A
 * relative request at least reaches whatever is serving this bundle, and the shell says the
 * placement is unregistered either way.
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
 * Two layers answering two different questions. `resolveApiBase` answers "is this a development
 * stack?" — the only case where the square is somewhere other than this origin — and stays a pure
 * function of the hostname so `test/hosts.test.ts` can pin it without a browser. `viewedApiOrigin()`
 * answers "is the reader looking at the other square?" and is `''` until they touch the switcher
 * (micro-org#459), so in production this is the empty string and every request stays relative.
 *
 * The order matters. A local stack has no sibling estate to view — `NetworkSwitcher` hides itself
 * off-registry — so the dev port wins outright and `viewedApiOrigin()` is never consulted there.
 *
 * A FUNCTION, NOT A CONSTANT, and that is load-bearing. A module-level string is captured on first
 * import and goes on naming the network the tab opened on; every read in this bundle calls this at
 * request time so that switching the network re-points the very next fetch — which is what makes
 * the amber band above the timeline tell the truth.
 */
export function apiBase(): string {
  return (
    resolveApiBase(typeof window === 'undefined' ? '' : window.location.hostname) ||
    viewedApiOrigin()
  )
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
