/**
 * What reaches Google, proven over every address this app has.
 *
 * ── THIS IS NOT A TEST ABOUT ANALYTICS. IT IS A TEST ABOUT A READING LIST. ────────────────────
 *
 * Everywhere else in the estate a path is a noun. Here every address names a person or a
 * conversation, so the stock GA4 behaviour — `page_location` and `page_path` taken from
 * `document.location` on every event, by the tag, without being asked — is a third-party log of who
 * reads whom. `lib/analytics.ts` exists to stop that, and the only way to know it still works is to
 * walk the whole route table with real handles in the paths and assert that none of them come out
 * the other side.
 *
 * So the shape of this file is deliberate: it does not check that `redactedLocation` returns what
 * the implementation happens to return. It checks that the STRING GOING TO GOOGLE contains no
 * handle, no post id, no tag and no query, for every route, including the ones that do not exist.
 * A regression here is silent, lawful-looking and permanent — GA4 has no delete for a field that
 * should never have been sent.
 *
 * ── AND THE ORDERING IS PART OF THE PROTECTION ────────────────────────────────────────────────
 *
 * `gtag` is a shim over an array. A `set` queued before the tag loads is applied before the tag's
 * own automatic first `page_view`; queued after, there is a window in which the real path is what
 * gets sent, and that window is the whole of the first page view. The `dataLayer` assertions below
 * are about ORDER as much as content.
 *
 * ── WHAT THIS FILE OWNS, NOW THAT THE PUSHING IS UPSTREAM ─────────────────────────────────────
 *
 * `lib/analytics.ts` no longer writes to `dataLayer` itself: it hands a PAGE FIELDS PROVIDER to
 * `@cloudsforge/ui/consent`, which queues it. So the split is — the gate's own suite proves the
 * MECHANISM (that a registration is applied, that `grantConsent` re-applies before `config`), and
 * this file proves the CONTENT, which is the half that is this surface's alone and the half a
 * regression would be silent in. The assertions below still read the real `dataLayer`, through the
 * real gate, because the question worth answering is what a reviewer would see in the GA property
 * rather than what a provider returned to a mock.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { CONSENT_STORAGE_KEY, setPageFieldsProvider } from '@cloudsforge/ui/consent'
import {
  pageFields,
  primeAnalyticsRedaction,
  redactedLocation,
  redactedReferrer,
  trackPageView,
} from '../src/lib/analytics.ts'
import { ROUTES } from '../src/lib/routes.ts'
import {
  type Browser,
  installDocument,
  installStorage,
  installWindow,
  removeDocument,
  removeStorage,
  removeWindow,
} from './browser-stubs.ts'

const ORIGIN = 'https://agora.cloudsforge.online'

/**
 * Every route with a REAL value substituted for each parameter.
 *
 * The identifiers are the point: `nefeli` is a handle somebody has, the uuid is the shape
 * micro-agora mints, and `mining` is a tag with people behind it. A test that walked the table with
 * `:handle` still in the path would prove nothing at all.
 */
const CONCRETE: readonly { path: string; pattern: string }[] = ROUTES.map((route) => ({
  path:
    '/' +
    route.path
      .split('/')
      .map((segment) => {
        if (segment === ':id') return '9f2c7d18-4a6b-4c21-9f0e-3b7a1c5e8d24'
        if (segment === ':handle') return 'nefeli'
        if (segment === ':tag') return 'mining'
        if (segment === ':slug') return 'ember-miners'
        return segment
      })
      .join('/'),
  pattern: `/${route.path}`,
}))

/** The identifiers that must never appear in anything this module produces. */
const SECRETS = ['nefeli', '9f2c7d18', 'mining', 'ember-miners', 'q=', 'how%20do%20i']

function open(url: string, referrer = '', consent?: 'granted' | 'denied'): Browser {
  const browser = installWindow(url)
  installStorage(consent ? { [CONSENT_STORAGE_KEY]: consent } : {})
  installDocument({ 'cf-release': '2026.8.74' }, referrer)
  return browser
}

afterEach(() => {
  // The registered provider is module state inside the gate, so it outlives the window it was
  // registered against and every test after this one would otherwise run against the last one's
  // registration. Withdrawing it makes each test say for itself whether a provider is registered,
  // which is exactly the difference between "the fields are redacted" and "the fields are redacted
  // because the previous test happened to run first".
  setPageFieldsProvider(null)
  removeWindow()
  removeStorage()
  removeDocument()
})

/* ---- the redaction itself ------------------------------------------- */

test('EVERY ROUTE REPORTS ITS PATTERN, WITH A REAL IDENTIFIER IN THE PATH', () => {
  for (const { path, pattern } of CONCRETE) {
    assert.equal(redactedLocation(ORIGIN, path), `${ORIGIN}${pattern === '/' ? '/' : pattern}`)
  }
})

test('no identifier survives the redaction, checked as a substring rather than by shape', () => {
  // The assertion the one above cannot make: it compares against an expected string, so it would go
  // on passing if `routePattern` and this file were changed together in the same wrong direction.
  for (const { path } of CONCRETE) {
    const reported = redactedLocation(ORIGIN, path)
    for (const secret of SECRETS) {
      assert.ok(!reported.includes(secret), `${path} reported as ${reported}, which carries a name`)
    }
  }
})

test('an address the router does not have becomes /unknown, not itself', () => {
  // The fallback is exactly where an unexpected path leaks. A crawler probing `/wp-admin`, a
  // mistyped handle, a route deleted last release — all of them are "some browser opened an address
  // we do not have", which is the whole of what a counter needs.
  assert.equal(redactedLocation(ORIGIN, '/v/nefeli/followers'), `${ORIGIN}/unknown`)
  assert.equal(redactedLocation(ORIGIN, '/wp-admin/setup-config.php'), `${ORIGIN}/unknown`)
  assert.equal(redactedLocation(ORIGIN, '/p'), `${ORIGIN}/unknown`)
})

test('the segment count is compared, so /circles and /circles/:slug cannot be confused', () => {
  assert.equal(redactedLocation(ORIGIN, '/circles'), `${ORIGIN}/circles`)
  assert.equal(redactedLocation(ORIGIN, '/circles/ember-miners'), `${ORIGIN}/circles/:slug`)
})

/* ---- referrers ------------------------------------------------------- */

test('AN EXTERNAL REFERRER IS KEPT WHOLE, AND AN INTERNAL ONE IS REDACTED', () => {
  // The external one is how the estate learns a post was linked from somewhere, which is a genuinely
  // useful number that says nothing about this reader.
  assert.equal(
    redactedReferrer(ORIGIN, 'https://news.ycombinator.com/item?id=1'),
    'https://news.ycombinator.com/item?id=1',
  )
  // The internal one is where the redaction would otherwise leak: GA fills `page_referrer` from
  // `document.referrer` by itself, and `/v/nefeli` is no less identifying for arriving in that
  // field than in the location field.
  assert.equal(redactedReferrer(ORIGIN, `${ORIGIN}/v/nefeli`), `${ORIGIN}/v/:handle`)
  assert.equal(redactedReferrer(ORIGIN, `${ORIGIN}/search?q=how%20do%20i`), `${ORIGIN}/search`)
})

test('a referrer that is not a URL, or is absent, reports nothing rather than itself', () => {
  assert.equal(redactedReferrer(ORIGIN, ''), '')
  assert.equal(redactedReferrer(ORIGIN, 'not a url'), '')
  assert.equal(redactedReferrer(ORIGIN, 'javascript:alert(1)'), '')
})

test('a same-hostname referrer on another PORT is external, because an origin includes the port', () => {
  // `http://localhost:5197` and `http://localhost:4150` are different origins and the standard says
  // so. Getting this wrong in the other direction would redact somebody else's referrer, which is
  // harmless; getting it wrong this way would treat our own as theirs and send the path.
  assert.equal(
    redactedReferrer('http://localhost:5197', 'http://localhost:5197/v/nefeli'),
    'http://localhost:5197/v/:handle',
  )
})

/* ---- the dataLayer --------------------------------------------------- */

/** The queued `gtag` calls, as arrays, in order. */
function queued(browser: Browser): unknown[][] {
  return (browser.window.dataLayer ?? []).map((args) => [...args])
}

test('THE PRIMED FIELDS ARE PUSHED AS AN ARGUMENTS OBJECT, WHICH THE TAG REQUIRES', () => {
  // Google's own shim pushes `arguments`, not an array, and the tag reads each queued entry as an
  // arguments object. An array of the same values is not accepted in its place — it is silently
  // ignored, which means the redaction silently stops applying while every test on its CONTENT goes
  // on passing.
  const browser = open(`${ORIGIN}/v/nefeli`)
  primeAnalyticsRedaction()
  const entries = browser.window.dataLayer ?? []
  assert.equal(entries.length, 1)
  assert.equal(Object.prototype.toString.call(entries[0]), '[object Arguments]')
  assert.equal(Array.isArray(entries[0]), false)
})

test('priming reports the pattern of the address the tab actually opened on', () => {
  const browser = open(`${ORIGIN}/p/9f2c7d18-4a6b-4c21-9f0e-3b7a1c5e8d24?ref=x#reply`)
  primeAnalyticsRedaction()
  const [command, fields] = queued(browser)[0] as [string, Record<string, string>]
  assert.equal(command, 'set')
  assert.equal(fields['page_location'], `${ORIGIN}/p/:id`)
  assert.equal(fields['page_path'], '/p/:id')
  // The query and the hash are gone whole, rather than filtered — an allowlist of "safe" parameters
  // is a list somebody eventually adds one more entry to.
  assert.ok(!JSON.stringify(fields).includes('ref=x'))
  assert.ok(!JSON.stringify(fields).includes('reply'))
})

test('the page title is a CONSTANT, because this surface titles pages with handles', () => {
  // GA falls back to `document.title` when it is not told one, and on this surface that carries the
  // handle and the first line of a post — the same identifiers the path was just stripped of, in a
  // field nobody thinks to look at.
  const browser = open(`${ORIGIN}/v/nefeli`)
  primeAnalyticsRedaction()
  const [, fields] = queued(browser)[0] as [string, Record<string, string>]
  assert.equal(fields['page_title'], 'Forge Agora')
})

test('NOTHING IN THE WHOLE dataLayer CARRIES AN IDENTIFIER, INCLUDING THE REFERRER', () => {
  // The end-to-end version, and the one that would catch a field added later without thinking. It
  // reads the entire queue as one string — the same way a reviewer reading a GA property would.
  const browser = open(
    `${ORIGIN}/p/9f2c7d18-4a6b-4c21-9f0e-3b7a1c5e8d24`,
    `${ORIGIN}/v/nefeli`,
    'granted',
  )
  primeAnalyticsRedaction()
  trackPageView('/tag/mining')
  trackPageView('/search?q=how%20do%20i')
  const dumped = JSON.stringify(queued(browser))
  for (const secret of SECRETS) {
    assert.ok(!dumped.includes(secret), `the dataLayer carries ${secret}`)
  }
  assert.ok(dumped.includes('/p/:id') && dumped.includes('/tag/:tag'))
})

test('a page view is a set FOLLOWED BY the event, so the fields lead the event that reads them', () => {
  const browser = open(`${ORIGIN}/`, '', 'granted')
  primeAnalyticsRedaction()
  trackPageView('/circles/ember-miners')
  // The first entry is the registration itself; the navigation is the two after it, in this order.
  // An `event` whose fields were queued after it reads the PREVIOUS page's globals, which is the
  // failure that looks like off-by-one traffic rather than like a bug.
  const entries = queued(browser).slice(1)
  assert.deepEqual(
    entries.map((e) => `${String(e[0])}:${String(e[1])}`),
    ['set:[object Object]', 'event:page_view'],
  )
  const fields = entries[1]?.[2] as Record<string, string>
  assert.equal(fields['page_path'], '/circles/:slug')
})

test('WITHOUT CONSENT NO EVENT IS QUEUED AT ALL', () => {
  // No tag has been loaded, so an event would sit in an array nothing ever reads — and an unbounded
  // array of events nobody consented to is worth avoiding on a page somebody scrolls for twenty
  // minutes. `denied` and "never asked" behave identically, which is the only defensible reading.
  //
  // Primed first ON PURPOSE, so the only thing standing between `trackPageView` and the layer is
  // the reader's answer. Registration itself does push — a `set` is not an event, it loads no
  // script and sets no cookie, and it has to be in the layer BEFORE the tag arrives or the tag's
  // own first page view carries the real address. That is the whole ordering this file exists for.
  const denied = open(`${ORIGIN}/v/nefeli`, '', 'denied')
  primeAnalyticsRedaction()
  const registration = queued(denied).length
  trackPageView('/v/nefeli')
  assert.equal(queued(denied).length, registration)

  setPageFieldsProvider(null)
  removeWindow()
  removeStorage()
  removeDocument()

  const unasked = open(`${ORIGIN}/v/nefeli`)
  primeAnalyticsRedaction()
  const unaskedRegistration = queued(unasked).length
  trackPageView('/v/nefeli')
  assert.equal(queued(unasked).length, unaskedRegistration)
})

test('THE REGISTERED PROVIDER IS THE pageFields IN THIS FILE, NOT A COPY OF IT', () => {
  // The gate holds a function and calls it whenever it needs the globals — at registration, before
  // the `config` it pushes on accept, and before every `page_view`. So every assertion above about
  // `pageFields` is only an assertion about what SHIPS if the function handed over is that one.
  // Proven through the layer rather than by identity, because identity would still hold if the
  // provider were registered and then never applied.
  const browser = open(`${ORIGIN}/p/9f2c7d18-4a6b-4c21-9f0e-3b7a1c5e8d24`, `${ORIGIN}/v/nefeli`)
  primeAnalyticsRedaction()
  const [, fields] = queued(browser)[0] as [string, Record<string, string>]
  assert.deepEqual(fields, pageFields('/p/9f2c7d18-4a6b-4c21-9f0e-3b7a1c5e8d24'))
})

test('the fields follow the reader, rather than pinning to the address they entered on', () => {
  // The mid-session shape, from this surface's side. A reader opens `/`, moves to `/tag/mining`,
  // and accepts there: the gate re-reads the provider before the `config` it pushes, and what it
  // gets back has to describe where they ARE. A provider that snapshotted its answer at boot would
  // report `/` forever — and would pass every test that only checks for absent identifiers.
  //
  // The gate's own suite proves it re-reads on accept (it can inject a script; this stub cannot).
  // What is proven here is the half that makes that worth doing: this provider is a live function
  // of the address, not a value computed once at registration.
  const browser = open(`${ORIGIN}/`, '', 'granted')
  primeAnalyticsRedaction()
  const [, atBoot] = queued(browser)[0] as [string, Record<string, string>]
  assert.equal(atBoot['page_path'], '/')

  browser.window.location.pathname = '/tag/mining'
  trackPageView()

  const entries = queued(browser)
  const fields = entries[entries.length - 1]?.[2] as Record<string, string>
  assert.equal(fields['page_path'], '/tag/:tag')
  assert.equal(fields['page_location'], `${ORIGIN}/tag/:tag`)
})

test('every entry point is a no-op with no window, so nothing throws where there is no browser', () => {
  // These run at module scope in `main.tsx`. A throw here is a blank page rather than a missing
  // statistic, which is the wrong trade in both directions.
  removeWindow()
  removeDocument()
  assert.doesNotThrow(() => primeAnalyticsRedaction())
  assert.doesNotThrow(() => trackPageView('/v/nefeli'))
})
