/**
 * What Google Analytics is allowed to be told about this surface, which is less than it is told
 * about every other one.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROBLEM: ON THIS SURFACE THE PATH IS THE PRIVATE PART.
 *
 * `@cloudsforge/ui/consent` already does the hard half — no script and no cookie until the reader
 * presses Accept — and that is a question about WHETHER to count. This file is about WHAT is in the
 * count, and it exists because the two are not the same question here.
 *
 * Everywhere else in the estate a path is a noun: `/pools`, `/status`, `/markets/ember-usd`. Here
 * every address names a person or a conversation:
 *
 *     /v/nefeli          which person this browser reads
 *     /p/9f2c…           which conversation, and — with a second request — which reply
 *     /tag/mining        what they are interested in
 *     /search?q=…        what they typed
 *
 * GA4 records `page_location` and `page_path` on every event, by itself, from `document.location`.
 * So the stock behaviour on this surface is a third-party log of who reads whom. A reader who
 * accepted analytics agreed to be counted, not to hand over a reading list; consent to processing
 * is not consent to processing anything you like (GDPR Art. 5(1)(b), purpose limitation — a
 * separate obligation from the Art. 6 lawful basis the banner establishes). And the honest test is
 * simpler than the legal one: nobody pressing Accept on a cookie banner believes they are
 * publishing which handles they looked at.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIX: REPORT THE PATTERN, NEVER THE PATH.
 *
 * `/v/:handle`, not `/v/nefeli`. That keeps every number anybody would actually ask for — how many
 * people read profiles, how many open a thread from a link, whether search is used at all — and
 * keeps none of the identifiers. It is a deliberate loss of one number: per-post popularity is
 * unmeasurable in GA. micro-agora counts its own posts server-side, where the data is already, and
 * that is the right place for it.
 *
 * ── WHERE THE PUSHING HAPPENS, AND WHY IT IS NOT HERE ANY MORE ─────────────────────────────────
 *
 * This module used to reproduce Google's `gtag` shim locally and push onto `window.dataLayer`
 * itself, with a note here saying a shared hook "would be better and is worth proposing upstream".
 * It has been proposed and it exists: `@cloudsforge/ui/consent` now takes a PAGE FIELDS PROVIDER —
 * a function from a path to the global parameters every event carries — and applies it itself, at
 * registration and again immediately before the `config` that produces the tag's automatic first
 * `page_view`.
 *
 * Three things got better and one of them is not cosmetic:
 *
 *   * One writer to `dataLayer` in the estate, so the ordering that makes the redaction hold is a
 *     property of the gate rather than of two files agreeing.
 *   * The accept-mid-session race is closed INSIDE `grantConsent`, which is the only place that
 *     knows when `config` is pushed. This surface used to watch for the consent change and re-prime
 *     afterwards, which was a second attempt at the same ordering from outside.
 *   * A hand-rolled tag call in a surface repository is what `web-ci`'s third-party-analytics scan
 *     exists to refuse, and it was refusing this one. That guard was right: the shim was correct
 *     here and would not be correct the next time somebody copied it.
 *
 * What stays here is what belongs here — the ROUTE TABLE's opinion about which paths are
 * identifying, which is this surface's own and nobody else's.
 */
import { setPageFieldsProvider, trackPageView } from '@cloudsforge/ui/consent'
import { routePattern } from './routes.ts'

/**
 * Report a client-side navigation, with this surface's fields.
 *
 * Re-exported rather than wrapped: the gate reads the registered provider itself, so there is
 * nothing left for this module to add. `components/shell.tsx` calls it on every location change,
 * and it is a no-op until the reader has accepted.
 */
export { trackPageView }

/**
 * The location this page reports itself as: origin, plus the route pattern, and nothing else.
 *
 * No query string and no hash, unconditionally — `?q=` on `/search` is the reader's own words and
 * `?t=` on `/whispers` names a private conversation, and an allowlist of "safe" parameters is a
 * list somebody eventually adds one more entry to.
 *
 * Exported so `test/analytics.test.ts` can assert the redaction over every route in the table
 * without a browser or a tag.
 */
export function redactedLocation(origin: string, pathname: string): string {
  return `${origin}${routePattern(pathname)}`
}

/**
 * A referrer worth sending.
 *
 * An EXTERNAL referrer is kept whole: it is how the estate learns that a post was linked from
 * somewhere, which is a genuinely useful number and reveals nothing about this reader. An INTERNAL
 * one is redacted the same way as the location, because `/v/nefeli` is no less identifying for
 * arriving in the referrer field than in the location field — and internal referrers are where the
 * redaction would otherwise leak, since GA fills `page_referrer` from `document.referrer` by
 * itself.
 */
export function redactedReferrer(origin: string, referrer: string): string {
  if (!referrer) return ''
  try {
    const url = new URL(referrer)
    if (url.origin === origin) return redactedLocation(origin, url.pathname)
    // ONLY http(s) is passed through whole, and the check is a PARSE rather than a prefix test —
    // the same rule `lib/format.ts` applies to a link in a post, for the same reason. `new URL()`
    // accepts `javascript:`, `data:` and `blob:` perfectly happily, and each of those carries its
    // whole payload in the string. A browser never puts one in `document.referrer`, so this branch
    // is unreachable today; it is here because "unreachable" is a property of the caller, this
    // function is exported, and the cost of being wrong is a payload in a third party's logs.
    return url.protocol === 'http:' || url.protocol === 'https:' ? referrer : ''
  } catch {
    return ''
  }
}

/**
 * The fields every GA4 event on this surface carries, computed for one address.
 *
 * Exported so the suite can assert them directly. It is also what is handed to the gate below, so
 * the thing the tests read is the thing that ships rather than a re-implementation of it.
 */
export function pageFields(pathname: string): Record<string, string> {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const referrer = typeof document === 'undefined' ? '' : document.referrer
  return {
    page_location: redactedLocation(origin, pathname),
    page_path: routePattern(pathname),
    page_referrer: redactedReferrer(origin, referrer),
    // GA falls back to `document.title` otherwise, and this surface's titles carry the handle and
    // the first line of the post — the same identifiers the path was just stripped of.
    page_title: 'Forge Agora',
  }
}

/**
 * Hand the redaction to the consent gate.
 *
 * MUST be called before `initAnalytics()`, and `main.tsx` does. `initAnalytics()` grants
 * immediately for a reader who accepted on a previous visit, which pushes `config` — and `config`
 * sends the tag's automatic first `page_view`. Registering first means the redacted fields are
 * already in the layer when the tag reads it, so there is no window in which the real path is the
 * one that gets sent. Doing it afterwards would be a race, and the losing branch of that race
 * reports a handle.
 *
 * The mid-session case — a reader who accepts on `/v/nefeli` after arriving on `/` — is the gate's
 * to handle and it does: `grantConsent()` re-reads this provider immediately before the `config` it
 * pushes. This surface used to attempt the same thing from outside with a consent listener, which
 * was a second guess at an ordering only the gate can actually know.
 */
export function primeAnalyticsRedaction(): void {
  setPageFieldsProvider(pageFields)
}
