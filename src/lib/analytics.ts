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
 * ── WHY THIS IS HERE AND NOT IN @cloudsforge/ui ────────────────────────────────────────────────
 *
 * `consent.ts` issues a plain `gtag('config', id, …)` with no page-field overrides and has no hook
 * for adding one; it is also owned by another repository. Redacting from this bundle is possible
 * because `gtag` is not a function Google gives you — it is a shim that pushes its arguments onto
 * `window.dataLayer`, and the tag reads that array in order whenever it finishes loading. So a
 * `set` queued BEFORE the tag arrives is applied before the tag's own first `page_view`. The shim
 * is reproduced below rather than imported because `consent.ts` keeps it module-private.
 *
 * A shared hook would be better and is worth proposing upstream. It is not worth blocking this
 * surface on, and a redaction that lives next to the routes it redacts is not obviously the wrong
 * place for it.
 */
import { onConsentChange, readConsent } from '@cloudsforge/ui/consent'
import { routePattern } from './routes.ts'

/**
 * `dataLayer`, and the shim that feeds it.
 *
 * Reproduced from Google's own snippet rather than approximated: it pushes the ARGUMENTS OBJECT,
 * not an array, and that is load-bearing — the tag reads each queued entry as an arguments object
 * and an array of the same values is not accepted in its place. So this is a `function` expression
 * using `arguments`, which is exactly the thing a rest parameter would tidy away and break.
 */
interface AnalyticsGlobals {
  dataLayer?: IArguments[]
}

function globals(): (Window & AnalyticsGlobals) | null {
  return typeof window === 'undefined' ? null : (window as Window & AnalyticsGlobals)
}

const gtag: (...args: readonly unknown[]) => void = function gtagShim(): void {
  const w = globals()
  if (!w) return
  w.dataLayer = w.dataLayer ?? []
  // eslint-disable-next-line prefer-rest-params
  w.dataLayer.push(arguments)
}

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

/** The fields every GA4 event on this surface carries, computed for one address. */
function pageFields(pathname: string): Record<string, string> {
  const w = globals()
  const origin = w ? w.location.origin : ''
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
 * Queue the redacted page fields as GA4 GLOBAL parameters.
 *
 * MUST be called before `initAnalytics()`, and `main.tsx` does. `initAnalytics()` grants
 * immediately for a reader who accepted on a previous visit, which pushes `config` — and `config`
 * sends the tag's automatic first `page_view`. Queuing the `set` first means the redacted fields
 * are already in the layer when the tag reads it, so there is no window in which the real path is
 * the one that gets sent. Doing it afterwards would be a race, and the losing branch of that race
 * reports a handle.
 *
 * `set` rather than `config` options because it persists across the `config` that follows it and
 * applies to every event, including the automatic ones this bundle never issues.
 */
export function primeAnalyticsRedaction(): void {
  const w = globals()
  if (!w) return
  gtag('set', pageFields(w.location.pathname))
}

/**
 * Report a client-side navigation.
 *
 * GA4 sends a `page_view` when the tag loads and never again — a single-page app that does not do
 * this shows every reader as having viewed exactly one page. The `set` is repeated before the
 * event so that the global fields follow the reader rather than pinning to the address they
 * entered on.
 *
 * A no-op without consent: no tag has been loaded, so the push would sit in an array nothing ever
 * reads, and an unbounded array of events nobody consented to is worth avoiding on a page somebody
 * scrolls for twenty minutes.
 */
export function trackPageView(pathname: string): void {
  if (readConsent() !== 'granted') return
  const fields = pageFields(pathname)
  gtag('set', fields)
  gtag('event', 'page_view', fields)
}

/**
 * Re-prime when the reader's answer changes.
 *
 * A reader who accepts mid-session causes `grantConsent()` to push `config`, whose automatic
 * `page_view` needs the redacted fields already in place — and by then the fields primed at boot
 * describe whichever address the tab opened on rather than the one being read now. Returns the
 * unsubscribe function, which `main.tsx` never calls: this lives as long as the document.
 */
export function watchConsentForRedaction(): () => void {
  return onConsentChange((decision) => {
    if (decision !== 'granted') return
    const w = globals()
    if (!w) return
    gtag('set', pageFields(w.location.pathname))
  })
}
