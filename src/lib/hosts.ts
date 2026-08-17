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
 * micro-agora's base path, on the network the reader is viewing.
 *
 * `viewedApiOrigin()` is `api.<apex>` for mainnet and `api-testnet.<apex>` for testnet, chosen by
 * the switcher in the bar rather than by the hostname this page happens to be served from. The
 * `/agora` prefix is the gateway's route to the service; the service itself mounts everything under
 * `/v1`, so a full address is `<origin>/agora/v1/timeline/latest`.
 *
 * A FUNCTION, NOT A CONSTANT, and that is load-bearing. A module-level string is captured on first
 * import and goes on naming the network the tab opened on; every read in this bundle calls this at
 * request time so that switching the network re-points the very next fetch.
 */
export function apiBase(): string {
  return `${viewedApiOrigin()}/agora`
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
