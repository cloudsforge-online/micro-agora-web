/**
 * The auth client: one refresh at a time, one error shape, and a hand-off code that is never in the
 * address bar while it is in flight.
 *
 * ── THE FOUR THINGS THIS FILE EXISTS FOR ──────────────────────────────────────────────────────
 *
 * 1. THE SINGLE-FLIGHT REFRESH. A timeline fires four requests on mount. On an expired access token
 *    all four come back 401, and four refreshes against a ROTATING refresh token means three of
 *    them present a token that has just been superseded. The reader is signed out while holding a
 *    valid session, at random, on a page that was working a second ago. It is the defect this whole
 *    module's shape is for, and it cannot be reproduced by hand.
 *
 * 2. THE NESTED /auth/me SHAPE. Identity answers `{ user: {...} }`; the web template read `handle`
 *    and `roles` off the TOP level, where they are not, and four frontends inherited it. `roles`
 *    was then always empty and every `adminOnly` entry was hidden from every operator. Here the
 *    consequence is worse than a missing menu: `roles` is what shows the moderation queue, and a
 *    moderator who cannot see reports is a square with nobody answering them.
 *
 * 3. THE HAND-OFF ORDERING. The code is stripped from the hash BEFORE the exchange request is sent.
 *    An "after" version leaves it in the history, in the referrer of anything the page loads next,
 *    and in any screenshot taken while the request is in flight — and if the exchange throws, never
 *    strips it at all. The assertion is on the ORDER of two side effects, which is the only way to
 *    state it.
 *
 * 4. WHAT IS NOT REPORTED. Every browser puts the full request URL in a fetch rejection, and an
 *    estate credential has leaked exactly that way before. The failures here are reported by their
 *    MESSAGE, never by printing what was thrown, and the API path is reported as a route pattern
 *    because `/v1/voices/nefeli` is `/v/nefeli` by another spelling.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  __resetAuth,
  ApiError,
  AUTH_EXPIRED_EVENT,
  api,
  bootstrapSession,
  clearTokens,
  fetchReader,
  getAccessToken,
  hasSession,
  newIdempotencyKey,
  NOBODY,
  noticeFor,
  readErrorBody,
  readReader,
  refreshSession,
  setTokens,
  signOut,
} from '../src/lib/api.ts'
import { flush } from '../src/lib/obs.ts'
import {
  type Browser,
  type FetchCall,
  type FetchStub,
  installDocument,
  installFetch,
  installHostileStorage,
  installSessionStorage,
  installStorage,
  installWindow,
  json,
  removeDocument,
  removeSessionStorage,
  removeStorage,
  removeWindow,
} from './browser-stubs.ts'

const ORIGIN = 'https://agora.cloudsforge.online'

let fetchStub: FetchStub | null = null

function open(url = `${ORIGIN}/`, seed: Record<string, string> = {}): Browser {
  const browser = installWindow(url)
  installStorage(seed)
  installSessionStorage()
  installDocument({ 'cf-release': '2026.8.74' })
  return browser
}

function signedIn(url = `${ORIGIN}/`): Browser {
  const browser = open(url)
  setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  return browser
}

afterEach(() => {
  __resetAuth()
  fetchStub?.restore()
  fetchStub = null
  removeWindow()
  removeStorage()
  removeSessionStorage()
  removeDocument()
})

/* ---- token storage --------------------------------------------------- */

test('THE TOKEN KEYS ARE THE SHARED ESTATE ONES, SPELLED THE SAME IN EVERY PRODUCT', () => {
  // A session established at the Account portal is picked up here with no round trip because the
  // keys match, and signing out of one app on a shared machine clears what the next would read.
  // Renaming them here would break both, silently, on one surface.
  const store = installStorage()
  setTokens({ accessToken: 'a', refreshToken: 'r' })
  assert.deepEqual([...store.keys()].sort(), ['cf.accessToken', 'cf.refreshToken'])
  assert.equal(hasSession(), true)
  clearTokens()
  assert.equal(hasSession(), false)
  assert.equal(store.size, 0)
  removeStorage()
})

test('A HOSTILE localStorage FALLS BACK TO MEMORY RATHER THAN TAKING THE PAGE DOWN', () => {
  // Safari's private window throws on ACCESS, not on the `typeof` check. A module that touched it
  // directly would fail at import time — a public square that renders nothing for a reader who
  // opened a linked post in a private window, which is a very ordinary way to open a link.
  installHostileStorage()
  assert.doesNotThrow(() => setTokens({ accessToken: 'a', refreshToken: 'r' }))
  assert.equal(getAccessToken(), 'a')
  assert.equal(hasSession(), true)
  __resetAuth()
  assert.equal(getAccessToken(), null, 'the memory fallback is per document, as it must be')
  removeStorage()
})

/* ---- the error envelope ---------------------------------------------- */

test("THE ESTATE ERROR BODY IS NESTED, AND READING IT FLAT RENDERS '[object Object]'", () => {
  const nested = readErrorBody({
    error: { code: 'forbidden', message: 'You are barred from this circle.', requestId: 'cf-1a2b' },
  })
  assert.deepEqual(nested, {
    message: 'You are barred from this circle.',
    code: 'forbidden',
    requestId: 'cf-1a2b',
  })
  // The flat form is what a proxy or a hand-written handler answers. There is nothing to be gained
  // by refusing to read a message somebody did send.
  assert.equal(readErrorBody({ error: 'Bad gateway' }).message, 'Bad gateway')
  assert.equal(readErrorBody({ message: 'Too many requests', code: 'rate_limited' }).code, 'rate_limited')
  // And nothing is invented from a body that carries nothing.
  assert.deepEqual(readErrorBody(null), { message: undefined, code: undefined, requestId: undefined })
  assert.deepEqual(readErrorBody('nope'), { message: undefined, code: undefined, requestId: undefined })
  assert.equal(readErrorBody({ error: { message: '' } }).message, undefined)
})

test('403 and 404 are their own screens, and everything else is one sentence', () => {
  // 403 was understood and refused: retrying will not help. 404 on this surface is the common one —
  // a deleted post, a barred voice — and both need a different page from "something went wrong".
  const forbidden = noticeFor(new ApiError(403, 'Not for you', 'forbidden', 'cf-9'), 'fallback')
  assert.deepEqual(forbidden, {
    message: 'Not for you',
    requestId: 'cf-9',
    forbidden: true,
    missing: false,
  })
  assert.equal(noticeFor(new ApiError(404, 'Gone', undefined, undefined), 'f').missing, true)
  assert.equal(noticeFor(new ApiError(500, 'Boom'), 'f').forbidden, false)
})

test('a non-ApiError is a bug in THIS bundle, so it is the one case reported to Lantern', async () => {
  // An ApiError has already been logged by the service that produced it, under the request id the
  // reader is being shown. Reporting it again from here would double every server-side incident.
  signedIn()
  const stub = installFetch(() => json(202, { stored: 1 }))
  fetchStub = stub
  const notice = noticeFor(new TypeError('x.map is not a function'), 'Could not load the timeline.')
  assert.equal(notice.message, 'Could not load the timeline.')
  assert.equal(notice.requestId, undefined)

  await flush()
  const body = JSON.parse(stub.calls.at(-1)?.body ?? '{"samples":[]}') as {
    samples: { kind: string; attributes: Record<string, unknown> }[]
  }
  const sample = body.samples.at(-1)
  assert.equal(sample?.kind, 'error')
  assert.equal(sample?.attributes['type'], 'TypeError')
  assert.equal(
    (sample?.attributes['context'] as Record<string, string>)['fallback'],
    'Could not load the timeline.',
  )
})

/* ---- the single-flight refresh --------------------------------------- */

test('FOUR CONCURRENT REFRESHES PERFORM ONE, WHICH IS THE WHOLE REASON THIS MODULE EXISTS', async () => {
  signedIn()
  let refreshes = 0
  fetchStub = installFetch((call: FetchCall) => {
    if (call.url.includes('/auth/refresh')) {
      refreshes += 1
      return json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' })
    }
    return json(200, {})
  })

  const results = await Promise.all([
    refreshSession(),
    refreshSession(),
    refreshSession(),
    refreshSession(),
  ])
  assert.deepEqual(results, [true, true, true, true])
  assert.equal(refreshes, 1, `${refreshes} refreshes against a rotating token signs the reader out`)
  assert.equal(getAccessToken(), 'access-2')
})

test('the slot is cleared when it settles, so the NEXT expiry starts a fresh attempt', async () => {
  // A cached promise would replay a stale answer for the life of the document: the reader refreshes
  // successfully once, and every later expiry is answered "already fine" until the tab is closed.
  signedIn()
  let refreshes = 0
  fetchStub = installFetch(() => {
    refreshes += 1
    return json(200, { accessToken: `access-${refreshes + 1}`, refreshToken: `refresh-${refreshes + 1}` })
  })
  await refreshSession()
  await refreshSession()
  assert.equal(refreshes, 2)
})

test('with no refresh token there is no request at all', async () => {
  open()
  const stub = installFetch(() => json(200, {}))
  fetchStub = stub
  assert.equal(await refreshSession(), false)
  assert.equal(stub.calls.length, 0)
})

test('a 401 refresh is routine and a 500 refresh is Nimbus failing, and they are told apart', async () => {
  // Both sign the reader out. Only one of them is an incident, and they are indistinguishable for
  // as long as neither is written down.
  signedIn()
  const stub = installFetch((call: FetchCall) =>
    call.url.includes('/auth/refresh') ? json(503, { error: 'upstream' }) : json(202, { stored: 1 }),
  )
  fetchStub = stub
  assert.equal(await refreshSession(), false)
  await flush()
  const reported = stub.calls
    .filter((c) => c.url.includes('/ingest/client'))
    .flatMap(
      (c) => (JSON.parse(c.body ?? '{"samples":[]}') as { samples: { attributes: Record<string, unknown> }[] }).samples,
    )
  assert.equal(reported.at(-1)?.attributes['type'], 'RefreshFailed')
})

/* ---- the request core ------------------------------------------------ */

test('AN EXPIRED ACCESS TOKEN IS REFRESHED ONCE AND THE RETRY CARRIES THE NEW BEARER', async () => {
  // Retrying with the OLD token is the version of this that looks like it works: the refresh
  // succeeds, the retry 401s again, and the reader is signed out with a valid session in storage.
  signedIn()
  const stub = installFetch((call: FetchCall) => {
    if (call.url.includes('/auth/refresh')) {
      return json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' })
    }
    return call.headers['authorization'] === 'Bearer access-2'
      ? json(200, { posts: [] })
      : json(401, { error: { code: 'token_expired', message: 'expired' } })
  })
  fetchStub = stub

  const body = await api<{ posts: unknown[] }>('/v1/timeline')
  assert.deepEqual(body, { posts: [] })
  const bearers = stub.calls.filter((c) => c.url.includes('/timeline')).map((c) => c.headers['authorization'])
  assert.deepEqual(bearers, ['Bearer access-1', 'Bearer access-2'])
})

test('a refresh that fails clears the tokens and tells the app, once', async () => {
  const browser = signedIn()
  fetchStub = installFetch((call: FetchCall) =>
    call.url.includes('/auth/refresh')
      ? json(401, { error: { code: 'invalid_grant', message: 'expired' } })
      : json(401, { error: { code: 'token_expired', message: 'expired' } }, 'cf-77'),
  )

  const err = await api('/v1/timeline').then(
    () => null,
    (e: unknown) => e,
  )
  assert.ok(err instanceof ApiError)
  assert.equal(err.status, 401)
  assert.equal(err.code, 'session_expired')
  assert.equal(err.requestId, 'cf-77')
  assert.equal(hasSession(), false)
  assert.deepEqual(browser.dispatched, [AUTH_EXPIRED_EVENT])
})

test('EVERY REQUEST GOES WITHOUT COOKIES, ON EVERY PATH', async () => {
  // The gateway grants this origin cross-environment CORS. `credentials: 'include'` would make that
  // a credentialed grant, for a cookie nothing reads — a CSRF surface bought for nothing.
  signedIn()
  const stub = installFetch((call: FetchCall) =>
    call.url.includes('/auth/refresh')
      ? json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' })
      : call.headers['authorization'] === 'Bearer access-2'
        ? json(200, {})
        : json(401, {}),
  )
  fetchStub = stub
  await api('/v1/timeline')
  assert.ok(stub.calls.length >= 3)
  for (const call of stub.calls) assert.equal(call.credentials, 'omit', `${call.url} sent credentials`)
})

test('a network failure is one sentence to the reader, and a ROUTE PATTERN to Lantern', async () => {
  // `/v1/voices/nefeli` is `/v/nefeli` by another spelling, and it would walk straight past the
  // redaction every other reporter in this bundle performs.
  signedIn(`${ORIGIN}/v/nefeli`)
  let first = true
  const stub = installFetch(() => {
    if (first) {
      first = false
      throw new TypeError('Failed to fetch')
    }
    return json(202, { stored: 1 })
  })
  fetchStub = stub

  const err = await api('/v1/voices/nefeli').then(
    () => null,
    (e: unknown) => e,
  )
  assert.ok(err instanceof ApiError)
  assert.equal(err.status, 0)
  assert.match(err.message, /Cannot reach the square/)

  await flush()
  const dumped = stub.calls
    .filter((c) => c.url.includes('/ingest/client'))
    .map((c) => c.body ?? '')
    .join('')
  assert.ok(dumped.includes('NetworkError'))
  assert.ok(!dumped.includes('nefeli'), 'the report carries the handle the request was for')
})

test('AN ABORT IS RETHROWN UNTOUCHED AND REPORTED NOWHERE', async () => {
  // A reader who navigated away, or switched network mid-request. Reporting it as a network fault
  // would fill Lantern with the consequences of scrolling, and wrapping it in an ApiError would
  // make it indistinguishable from one at the call site.
  signedIn()
  const stub = installFetch(() => {
    throw new DOMException('The operation was aborted.', 'AbortError')
  })
  fetchStub = stub
  const controller = new AbortController()
  const err = await api('/v1/timeline', { signal: controller.signal }).then(
    () => null,
    (e: unknown) => e,
  )
  assert.ok(err instanceof DOMException)
  assert.equal(err.name, 'AbortError')
  assert.ok(!(err instanceof ApiError))

  await flush()
  assert.equal(stub.calls.filter((c) => c.url.includes('/ingest/client')).length, 0)
})

test('a non-JSON error body is reported, because nothing server-side logs that request', async () => {
  // It means something in FRONT of the service answered — a gateway, a CDN, a misrouted deploy —
  // and the request never reached the thing that would have logged it.
  signedIn()
  const stub = installFetch((call: FetchCall) =>
    call.url.includes('/ingest/client')
      ? json(202, { stored: 1 })
      : new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html', 'x-request-id': 'cf-502' },
        }),
  )
  fetchStub = stub

  const err = await api('/v1/timeline').then(
    () => null,
    (e: unknown) => e,
  )
  assert.ok(err instanceof ApiError)
  assert.equal(err.status, 502)
  assert.equal(err.requestId, 'cf-502')
  await flush()
  const dumped = stub.calls.filter((c) => c.url.includes('/ingest/client')).map((c) => c.body).join('')
  assert.ok(dumped.includes('NonJsonErrorBody'))
})

test('an empty answer is undefined rather than a parse error', async () => {
  // 204 on a delete, and `content-length: 0` from a proxy. `res.json()` on either throws, and the
  // throw would be reported as a bug in a request that succeeded.
  signedIn()
  fetchStub = installFetch(() => new Response(null, { status: 204 }))
  assert.equal(await api('/v1/posts/abc', { method: 'DELETE' }), undefined)
})

test('query values are stringified and the absent ones are left out entirely', async () => {
  signedIn()
  const stub = installFetch(() => json(200, {}))
  fetchStub = stub
  await api('/v1/search', { query: { q: 'ember', limit: 20, mine: false, cursor: undefined, before: null } })
  const url = new URL(stub.calls[0]?.url ?? '')
  assert.equal(url.searchParams.get('q'), 'ember')
  assert.equal(url.searchParams.get('limit'), '20')
  assert.equal(url.searchParams.get('mine'), 'false')
  assert.equal(url.searchParams.has('cursor'), false)
  assert.equal(url.searchParams.has('before'), false)
})

test('an idempotency key satisfies the floor micro-agora refuses below', async () => {
  // The service accepts `/^[A-Za-z0-9_:.-]{8,200}$/` and REFUSES anything shorter than eight
  // characters — a floor rather than a formality, because a short key collides across readers and a
  // colliding idempotency store serves somebody else's answer instead of deduplicating a retry.
  const keys = new Set<string>()
  for (let i = 0; i < 50; i += 1) {
    const key = newIdempotencyKey()
    assert.match(key, /^[A-Za-z0-9_:.-]{8,200}$/)
    keys.add(key)
  }
  assert.equal(keys.size, 50)

  signedIn()
  const stub = installFetch(() => json(201, {}))
  fetchStub = stub
  await api('/v1/posts', { method: 'POST', body: { body: 'hello' }, idempotencyKey: 'k-abcdefgh' })
  assert.equal(stub.calls[0]?.headers['idempotency-key'], 'k-abcdefgh')
  assert.equal(stub.calls[0]?.headers['content-type'], 'application/json')
})

/* ---- who is reading -------------------------------------------------- */

test('THE READER IS NESTED UNDER user, AND THERE IS NO FLAT FALLBACK', () => {
  assert.deepEqual(readReader({ user: { handle: 'nefeli', roles: ['operator'] } }), {
    handle: 'nefeli',
    roles: ['operator'],
  })
  // The defect four frontends inherited. Tolerating it would encode a response identity does not
  // send, and the next reader of this file could not tell which of the two shapes is real.
  assert.deepEqual(readReader({ handle: 'nefeli', roles: ['operator'] }), NOBODY)
  assert.deepEqual(readReader({ user: null }), NOBODY)
  assert.deepEqual(readReader(null), NOBODY)
  // A handle of '' is nobody, and a non-string role is dropped rather than trusted downstream.
  assert.equal(readReader({ user: { handle: '' } }).handle, null)
  assert.deepEqual(readReader({ user: { roles: ['operator', 7, null] } }).roles, ['operator'])
  assert.deepEqual(readReader({ user: { roles: 'operator' } }).roles, [])
})

test('nobody signed in means no request, and a 401 ends the session', async () => {
  open()
  const stub = installFetch(() => json(200, {}))
  fetchStub = stub
  assert.equal(await fetchReader(), null)
  assert.equal(stub.calls.length, 0, 'an anonymous reader costs an identity round trip')

  const browser = signedIn()
  fetchStub?.restore()
  fetchStub = installFetch(() => json(401, { error: { code: 'expired', message: 'no' } }))
  assert.equal(await fetchReader(), null)
  assert.equal(hasSession(), false)
  assert.deepEqual(browser.dispatched, [AUTH_EXPIRED_EVENT])
})

/* ---- boot ------------------------------------------------------------ */

test('THE HAND-OFF CODE LEAVES THE ADDRESS BAR BEFORE IT GOES OVER THE WIRE', async () => {
  // The ordering is the security property. A code left in the address bar during a round trip is a
  // code in the history, in the referrer of anything loaded next, and in any screenshot taken while
  // the request is in flight — and an "after" version never strips it at all when the exchange
  // throws. Asserting the ORDER of the two side effects is the only way to state that.
  const browser = installWindow(`${ORIGIN}/p/9f2c?ref=x#cf_code=one-time-secret`)
  installStorage()
  installSessionStorage()
  installDocument({ 'cf-release': '2026.8.74' })
  fetchStub = installFetch(
    () => json(200, { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 }),
    browser.trace,
  )

  assert.equal(await bootstrapSession(), true)

  const replaced = browser.trace.findIndex((t) => t.startsWith('replaceState:'))
  const fetched = browser.trace.findIndex((t) => t.startsWith('fetch:'))
  assert.ok(replaced >= 0 && fetched >= 0, `trace was ${browser.trace.join(' → ')}`)
  assert.ok(replaced < fetched, 'the code was still in the address bar while the exchange was in flight')

  // The rest of the address survives: an app may keep its own state in the hash, and the reader is
  // meant to land on the post they followed a link to.
  assert.equal(browser.replaced[0], '/p/9f2c?ref=x')
  assert.ok(!browser.window.location.href.includes('one-time-secret'))
  // And the code travelled in the BODY, never in a URL that a proxy or an access log would keep.
  assert.ok(!(fetchStub.calls[0]?.url ?? '').includes('one-time-secret'))
  assert.ok((fetchStub.calls[0]?.body ?? '').includes('one-time-secret'))
  assert.equal(hasSession(), true)
})

test('a boot with no code and no session asks nobody anything', async () => {
  // A stranger who followed a link to a post reads it without an identity round trip. The silent
  // probe is gated on a cookie hint precisely so that this stays true.
  open(`${ORIGIN}/p/9f2c`)
  const stub = installFetch(() => json(200, {}))
  fetchStub = stub
  assert.equal(await bootstrapSession(), false)
  assert.equal(stub.calls.length, 0)
})

test('a failed exchange is a signed-out boot rather than a broken app', async () => {
  // The sign-in button is right there. A throw here would be a blank page for a reader whose
  // hand-off happened to expire in the second it took them to arrive.
  const browser = installWindow(`${ORIGIN}/#cf_code=stale`)
  installStorage()
  installSessionStorage()
  installDocument({ 'cf-release': '2026.8.74' })
  fetchStub = installFetch(() => json(400, { error: { code: 'expired', message: 'gone' } }))
  assert.equal(await bootstrapSession(), false)
  assert.equal(hasSession(), false)
  assert.ok(!browser.window.location.href.includes('stale'), 'a failed exchange left the code in the URL')
})

test('an existing session boots signed in with no request', async () => {
  signedIn(`${ORIGIN}/home`)
  const stub = installFetch(() => json(200, {}))
  fetchStub = stub
  assert.equal(await bootstrapSession(), true)
  assert.equal(stub.calls.length, 0)
})

test('SIGNING OUT CLEARS THIS APP TOKENS FIRST — THE PORTAL CANNOT REACH THEM', () => {
  // If the redirect went first, a reader who closed the tab mid-navigation, or whose network dropped
  // on the way, would come back to a surface still holding a bearer for a session that was revoked.
  const browser = signedIn(`${ORIGIN}/settings`)
  signOut()
  assert.equal(hasSession(), false)
  assert.equal(browser.assigned.length, 1)
  assert.match(browser.assigned[0] ?? '', /\/logout\?return=/)
  assert.ok(browser.trace.indexOf('assign:' + (browser.assigned[0] ?? '')) >= 0)
})
