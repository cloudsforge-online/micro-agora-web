/**
 * The reporter, held to its own five rules.
 *
 * `lib/obs.ts` states them at the top: it never throws, it never reports itself, it batches and
 * flushes on pagehide, it is bounded, and — this surface's own — it reports the route PATTERN and
 * never the path. Each one exists because of a specific way browser telemetry goes wrong, and each
 * one fails in a way that is invisible from the outside:
 *
 *   Rule 1 broken — the page dies where the reporter did, and the stack blames the component.
 *   Rule 2 broken — an ingest that starts refusing gets hammered by every browser at once, which is
 *                   how a degraded service becomes an offline one.
 *   Rule 3 broken — the last error before the reader closed the tab is exactly the one that is lost.
 *   Rule 4 broken — a render loop throwing on every frame sends unbounded requests from a phone.
 *   Rule 5 broken — `route` is an indexed column with a dashboard several people can open, and
 *                   filling it with `/p/<uuid>` builds a log of who read which conversation out of
 *                   error reports, as a side effect.
 *
 * None of that surfaces as a failing build. It surfaces months later as a bill, an outage or a
 * privacy review, so it is asserted here.
 *
 * The wire shape is pinned too, against `lantern/src/rum.ts`: `samples` and not `events`, nine keys
 * and not ten, and `kind` from the closed set the CHECK constraint accepts. A record carrying
 * anything else is dropped at ingest with reason `unknown_kind` — a 202 with `stored: 0`, which is
 * the shape of a batch accepted and discarded in full.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  __resetObs,
  enqueueBounded,
  envelope,
  flush,
  kindFor,
  report,
  type RumSample,
} from '../src/lib/obs.ts'
import { ROUTES } from '../src/lib/routes.ts'
import {
  type Browser,
  type FetchCall,
  type FetchStub,
  installDocument,
  installFetch,
  installNavigator,
  installSessionStorage,
  installWindow,
  json,
  removeDocument,
  removeSessionStorage,
  removeWindow,
} from './browser-stubs.ts'

const ORIGIN = 'https://agora.cloudsforge.online'

let fetchStub: FetchStub | null = null

function open(url = `${ORIGIN}/`): Browser {
  const browser = installWindow(url)
  installDocument({ 'cf-release': '2026.8.74' })
  installSessionStorage()
  return browser
}

/** Install a fetch that answers `202 {"stored": n}` for whatever it is given. */
function accepting(stored?: number): FetchStub {
  fetchStub = installFetch((call: FetchCall) => {
    const batch = (JSON.parse(call.body ?? '{"samples":[]}') as { samples: unknown[] }).samples
    return json(202, { stored: stored ?? batch.length })
  })
  return fetchStub
}

/** The samples of the nth request, parsed. */
function sent(stub: FetchStub, n = 0): RumSample[] {
  return (JSON.parse(stub.calls[n]?.body ?? '{"samples":[]}') as { samples: RumSample[] }).samples
}

afterEach(() => {
  __resetObs()
  fetchStub?.restore()
  fetchStub = null
  removeWindow()
  removeDocument()
  removeSessionStorage()
})

/* ---- the wire shape -------------------------------------------------- */

test("EVERY CALLER TYPE MAPS ONTO LANTERN'S CLOSED SET", () => {
  // `kind` is a CHECK constraint, not a convention. Anything unrecognised must become `error`
  // rather than being passed through, because passing it through is the bug: an unknown kind is
  // dropped at ingest, and a coarsely labelled error beats a dropped one.
  assert.equal(kindFor('PageLoad'), 'page_load')
  assert.equal(kindFor('FirstContentfulPaint'), 'first_contentful_paint')
  assert.equal(kindFor('LargestContentfulPaint'), 'largest_contentful_paint')
  assert.equal(kindFor('UnhandledRejection'), 'unhandled_rejection')
  for (const type of ['NetworkError', 'RefreshFailed', 'RefreshUnreachable', 'NonJsonErrorBody']) {
    assert.equal(kindFor(type), 'fetch_error', `${type} should be a request that did not come back`)
  }
  for (const type of ['TypeError', 'ResourceError', 'WindowError', 'AuthCallbackFailed', '']) {
    assert.equal(kindFor(type), 'error')
  }
})

test('the caller precise classifier survives the narrowing, in attributes', () => {
  // Otherwise the narrowing is a loss: `RefreshUnreachable` and `NonJsonErrorBody` are the same
  // `fetch_error` on the wire, and they are completely different incidents.
  open()
  const sample = envelope({ app: 'agora-web', type: 'RefreshUnreachable', message: 'failed' })
  assert.equal(sample.kind, 'fetch_error')
  assert.equal(sample.attributes['type'], 'RefreshUnreachable')
})

test('AN ENVELOPE IS EXACTLY THE NINE KEYS LANTERN STORES', () => {
  // A tenth key is a silent no-op — `fromWire` reads nine and ignores the rest — so a field
  // promoted to the top level looks like it is being sent and is not stored anywhere.
  open()
  const sample = envelope({ app: 'agora-web', type: 'WindowError', message: 'boom' })
  assert.deepEqual(Object.keys(sample).sort(), [
    'app',
    'attributes',
    'kind',
    'requestId',
    'route',
    'session',
    'statusCode',
    'traceId',
    'valueMs',
  ])
})

test('the fields with no column are absent rather than null, and the ones with a column are null', () => {
  open()
  const sample = envelope({ app: 'agora-web', type: 'WindowError', message: 'boom' })
  assert.equal(sample.valueMs, null)
  assert.equal(sample.statusCode, null)
  assert.equal(sample.requestId, null)
  // No browser-side trace context exists today. Lantern requires exactly 32 hex characters and
  // nulls anything else, so null is the honest value rather than a fabricated one.
  assert.equal(sample.traceId, null)
  assert.ok(!('stack' in sample.attributes), 'an absent stack should not be sent as null')
  assert.ok(!('context' in sample.attributes))
})

test('value_ms is a whole number, because the column is an INTEGER', () => {
  // A float is REJECTED by the insert rather than rounded by it, and the rejection is one line in
  // an ingest log nobody reads. `performance` returns fractional milliseconds by default.
  open()
  assert.equal(envelope({ app: 'a', type: 'PageLoad', message: '/', valueMs: 1234.567 }).valueMs, 1235)
  assert.equal(envelope({ app: 'a', type: 'PageLoad', message: '/', valueMs: 0.4 }).valueMs, 0)
})

test('the release comes off the meta tag, and is honest when there is no tag', () => {
  open()
  assert.equal(envelope({ app: 'a', type: 'E', message: 'm' }).attributes['release'], '2026.8.74')
  removeDocument()
  installDocument({})
  assert.equal(envelope({ app: 'a', type: 'E', message: 'm' }).attributes['release'], 'unknown')
})

/* ---- rule 5: the pattern, never the path ----------------------------- */

test('NO SAMPLE CAN CARRY A HANDLE, A POST ID, A TAG OR A QUERY — EVERY ROUTE', () => {
  const concrete: [string, string][] = ROUTES.map((route) => [
    '/' +
      route.path
        .split('/')
        .map((s) =>
          s === ':id'
            ? '9f2c7d18-4a6b-4c21-9f0e-3b7a1c5e8d24'
            : s === ':handle'
              ? 'nefeli'
              : s === ':tag'
                ? 'mining'
                : s === ':slug'
                  ? 'ember-miners'
                  : s,
        )
        .join('/'),
    `/${route.path}`,
  ])

  for (const [path, pattern] of concrete) {
    open(`${ORIGIN}${path}?q=how%20do%20i#reply-3`)
    const sample = envelope({ app: 'agora-web', type: 'WindowError', message: 'boom' })
    assert.equal(sample.route, pattern === '/' ? '/' : pattern)
    const dumped = JSON.stringify(sample)
    for (const secret of ['nefeli', '9f2c7d18', 'mining', 'ember-miners', 'how%20do%20i', 'reply-3']) {
      assert.ok(!dumped.includes(secret), `a sample from ${path} carries ${secret}`)
    }
    removeWindow()
    removeDocument()
    removeSessionStorage()
  }
})

test('the ORIGIN is kept, because it is the environment and says nothing about the reader', () => {
  // It is the difference between mainnet, testnet and a preview deployment, which is the first
  // question asked of any error report.
  open(`${ORIGIN}/v/nefeli`)
  assert.equal(envelope({ app: 'a', type: 'E', message: 'm' }).attributes['url'], `${ORIGIN}/v/:handle`)
})

/* ---- rule 4: bounded ------------------------------------------------- */

test('THE QUEUE DROPS FROM THE FRONT, KEEPING THE NEWEST', () => {
  // A loop's thousandth exception is identical to its first, whereas the state of the page just
  // before the tab closed is not. Dropping the newest would keep the least useful thirty-two events
  // any page ever produces.
  const make = (i: number): RumSample =>
    ({ app: 'a', kind: 'error', route: '/', valueMs: i }) as unknown as RumSample
  let queue: RumSample[] = []
  for (let i = 0; i < 40; i += 1) queue = enqueueBounded(queue, make(i))
  assert.equal(queue.length, 32)
  assert.equal(queue[0]?.valueMs, 8)
  assert.equal(queue[31]?.valueMs, 39)
})

test('there is a lifetime cap on requests, and it holds', async () => {
  // A page that has already sent two hundred batches is a page in a loop, and the two hundred and
  // first tells nobody anything the first ten did not. The cap is on REQUESTS rather than events,
  // so a burst still arrives whole.
  open()
  const stub = accepting()
  for (let i = 0; i < 205; i += 1) {
    report({ app: 'agora-web', type: 'WindowError', message: `boom ${i}` })
    await flush()
  }
  assert.equal(stub.calls.length, 200)
})

/* ---- rules 1 and 2: never throw, never report yourself ---------------- */

test('A FETCH THAT REJECTS PRODUCES NO SECOND REPORT AND NO REJECTION', async () => {
  // The outage amplifier. A browser can generate reports-about-failed-reports faster than an ingest
  // can shed them, and every browser on the estate would do it at the same moment.
  open()
  const stub = installFetch(() => {
    throw new TypeError('Failed to fetch')
  })
  fetchStub = stub
  report({ app: 'agora-web', type: 'WindowError', message: 'boom' })
  await assert.doesNotReject(() => flush())
  assert.equal(stub.calls.length, 1)
  // And the queue is not retried into an ingest that is already refusing.
  await flush()
  assert.equal(stub.calls.length, 1)
})

test('a non-2xx is said out loud exactly once and never thrown', async () => {
  // A silent `catch {}` here is how the estate ran for months with an ingest path that 404ed: every
  // browser was reporting, nothing was arriving, and nothing anywhere said so.
  open()
  const stub = installFetch(() => json(404, { error: 'no such route' }))
  fetchStub = stub
  const warnings: unknown[][] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => void warnings.push(args)
  try {
    report({ app: 'agora-web', type: 'WindowError', message: 'boom' })
    await flush()
  } finally {
    console.warn = original
  }
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0]?.[0]), /ingest rejected this batch — 404/)
})

test('A 2XX IS NOT SUCCESS: 202 {"stored":0} IS A BATCH DISCARDED IN FULL', async () => {
  // The failure this whole shape exists to catch. The status is 202, the promise resolves, the
  // browser is satisfied, and not one sample was stored.
  open()
  accepting(0)
  const warnings: unknown[][] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => void warnings.push(args)
  try {
    report({ app: 'agora-web', type: 'WindowError', message: 'boom' })
    await flush()
  } finally {
    console.warn = original
  }
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0]?.[0]), /stored 0 of 1 samples/)
})

test('report never throws, even with no browser and no document at all', () => {
  removeWindow()
  removeDocument()
  removeSessionStorage()
  assert.doesNotThrow(() => report({ app: 'agora-web', type: 'WindowError', message: 'boom' }))
})

/* ---- rule 3: the batch, and getting it out --------------------------- */

test('THE BODY KEY IS samples, WHICH SIX FRONTENDS GOT WRONG', () => {
  // Lantern answers a body shaped `{"events":[…]}` with an explicit 400 naming that exact mistake,
  // because that is the envelope six frontends sent for months.
  open()
  const stub = accepting()
  report({ app: 'agora-web', type: 'WindowError', message: 'boom' })
  return flush().then(() => {
    const body = JSON.parse(stub.calls[0]?.body ?? '{}') as Record<string, unknown>
    assert.deepEqual(Object.keys(body), ['samples'])
    assert.equal(sent(stub).length, 1)
  })
})

test('the ingest is posted keepalive and WITHOUT credentials', async () => {
  // `keepalive` is what makes the report survive the navigation that usually follows the error
  // worth reading. No credentials because the ingest is unauthenticated, and sending cookies to it
  // would make it a CSRF surface bought for nothing.
  open()
  const stub = accepting()
  report({ app: 'agora-web', type: 'WindowError', message: 'boom' })
  await flush()
  const call = stub.calls[0]
  assert.equal(call?.method, 'POST')
  assert.equal(call?.keepalive, true)
  assert.equal(call?.credentials, 'omit')
  assert.match(call?.url ?? '', /\/ingest\/client$/)
})

test('a burst becomes ONE request, which is the whole point of batching', async () => {
  open()
  const stub = accepting()
  for (let i = 0; i < 5; i += 1) {
    report({ app: 'agora-web', type: 'WindowError', message: `boom ${i}` })
  }
  await flush()
  assert.equal(stub.calls.length, 1)
  assert.equal(sent(stub).length, 5)
})

test('pagehide uses sendBeacon, because a keepalive fetch is not guaranteed once the document goes', async () => {
  open()
  const stub = accepting()
  const nav = installNavigator()
  try {
    report({ app: 'agora-web', type: 'WindowError', message: 'boom' })
    await flush(true)
    assert.equal(nav.beacons.length, 1)
    assert.match(nav.beacons[0]?.url ?? '', /\/ingest\/client$/)
    // The content type is on the BLOB, because sendBeacon takes no headers — a beacon posted as
    // `text/plain` is what Lantern's ingest refuses, and it refuses it after the tab is gone.
    assert.equal(nav.beacons[0]?.type, 'application/json')
    assert.ok((nav.beacons[0]?.bytes ?? 0) > 0)
    assert.equal(stub.calls.length, 0, 'a beacon flush must not also fetch')
  } finally {
    nav.restore()
  }
})

test('flushing an empty queue sends nothing', async () => {
  open()
  const stub = accepting()
  await flush()
  await flush(true)
  assert.equal(stub.calls.length, 0)
})

/* ---- the session id -------------------------------------------------- */

test('THE SESSION ID IS PER TAB AND LIVES IN sessionStorage, NOT localStorage', () => {
  // It exists so two samples from one visit can be joined. `sessionStorage` means it dies with the
  // tab and never follows a reader between visits, which is the difference between a join key and
  // an identifier.
  open()
  const store = installSessionStorage()
  const first = envelope({ app: 'a', type: 'E', message: 'm' }).session
  const second = envelope({ app: 'a', type: 'E', message: 'm' }).session
  assert.ok(first)
  assert.equal(first, second, 'a fresh id per sample would make the join key useless')
  assert.equal(store.get('cf-obs-session'), first)
  assert.equal(store.size, 1)
})

test('a browser with storage disabled costs a join, not a sample', () => {
  // Storage can be refused outright, and a reporter that threw there would take the page down for
  // exactly the readers whose setup is already unusual enough to be worth hearing about.
  open()
  removeSessionStorage()
  const sample = envelope({ app: 'a', type: 'E', message: 'm' })
  assert.equal(sample.session, null)
  assert.equal(sample.route, '/')
})
