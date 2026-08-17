/**
 * The auth client: tokens, one refresh at a time, and one error shape.
 *
 * Carried forward in shape from the surfaces that have actually been run against Nimbus. The
 * behaviour worth preserving verbatim is the SINGLE-FLIGHT REFRESH: a timeline that fires four
 * requests on mount, all of which 401 on an expired access token, must perform ONE refresh. Four
 * refreshes against a rotating refresh token means three of them present a token that has just been
 * superseded, and the reader is signed out while holding a valid session.
 *
 * ── WHAT IS DIFFERENT HERE, AND IT IS THE NETWORK ─────────────────────────────────────────────
 *
 * `apiBase()` is a FUNCTION and it is called per request, because the reader can change which
 * square they are reading without leaving the page. Every other estate frontend can get away with
 * capturing the base once. This one cannot: a captured base would send a post the reader composed
 * after switching to the network they switched away from, and words are not a transaction that can
 * be reverted.
 *
 * The bearer, by contrast, is the SAME on both networks. Identity is shared across the combined
 * view (micro-org#459), which is what makes "the account you already have" true — and it is also
 * why a token must never be assumed to grant the same things on both: micro-agora mints a `voice`
 * per network on first write, so a reader with a handle on mainnet has none on testnet until they
 * post there. That is the service's business and this file does not model it; it is recorded here
 * because the natural assumption is the wrong one.
 */
import {
  attemptSilentSignIn,
  consumeAuthCallback,
  signInRedirect,
  signOutRedirect,
} from '@cloudsforge/ui'
import { APP_NAME, apiBase, hosts, pageOrigin } from './hosts.ts'
import { report } from './obs.ts'
import { routePattern } from './routes.ts'

/** Nimbus issues and refreshes tokens; it is cross-origin from every app, always. */
function nimbusUrl(): string {
  return hosts().nimbus
}

/**
 * The shared CloudsForge token keys.
 *
 * Deliberately the same strings in every product: a session established at the Account portal is
 * picked up here without a second round trip, and signing out of one app on a shared machine clears
 * the tokens the next app would have read.
 */
const ACCESS_KEY = 'cf.accessToken'
const REFRESH_KEY = 'cf.refreshToken'

/** Fired when a refresh fails. `AuthProvider` listens and drops the session. */
export const AUTH_EXPIRED_EVENT = 'cf:auth-expired'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

/* ---- token storage ------------------------------------------------- */

const memory = new Map<string, string>()

/**
 * Storage, with a memory fallback.
 *
 * `localStorage` THROWS rather than returning null in a Safari private window and in a third-party
 * iframe with storage blocked. A module that touched it directly would take the whole bundle down
 * at import time in both — and here that means a public square that renders nothing for a reader
 * who opened it in a private window, which is a very ordinary way to open a link somebody sent you.
 * The fallback loses the session on reload, which is a worse experience than persistence and a very
 * much better one than a blank page.
 */
function store(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      // Probe rather than trust: the throw happens on ACCESS, not on the typeof check.
      localStorage.getItem(ACCESS_KEY)
      return localStorage
    }
  } catch {
    // Fall through to memory.
  }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  }
}

export const getAccessToken = (): string | null => store().getItem(ACCESS_KEY)
export const getRefreshToken = (): string | null => store().getItem(REFRESH_KEY)

export function setTokens(tokens: AuthTokens): void {
  store().setItem(ACCESS_KEY, tokens.accessToken)
  store().setItem(REFRESH_KEY, tokens.refreshToken)
}

export function clearTokens(): void {
  store().removeItem(ACCESS_KEY)
  store().removeItem(REFRESH_KEY)
}

export const hasSession = (): boolean => Boolean(getAccessToken() && getRefreshToken())

/* ---- errors -------------------------------------------------------- */

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  /**
   * The server's id for the exact request that failed, echoed in both the `x-request-id` header and
   * the error body. Quoted by the reader, it is what finds their request across every service at
   * once — which is why every failure state in this app displays it.
   */
  readonly requestId: string | undefined

  constructor(status: number, message: string, code?: string, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

/**
 * Read a CloudsForge error body.
 *
 * The estate's envelope is NESTED:
 *
 *     { "error": { "code": "forbidden", "message": "…", "requestId": "cf-1a2b" } }
 *
 * The web template read `data.error` as a STRING, which against a real service assigns an object to
 * a string field and renders `[object Object]` on screen with the real message, the code and the
 * request id all present in the response and all discarded. Both shapes are accepted rather than
 * the nested one only: the flat form is what a proxy or a hand-written handler answers, and there
 * is nothing to be gained by refusing to read a message somebody did send.
 */
export function readErrorBody(body: unknown): {
  message: string | undefined
  code: string | undefined
  requestId: string | undefined
} {
  const none = { message: undefined, code: undefined, requestId: undefined }
  if (typeof body !== 'object' || body === null) return none

  const outer = body as { error?: unknown; code?: unknown; requestId?: unknown; message?: unknown }
  const inner =
    typeof outer.error === 'object' && outer.error !== null
      ? (outer.error as { code?: unknown; message?: unknown; requestId?: unknown })
      : null

  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined

  return {
    // The nested `message` wins over a top-level one; the flat `error` string is the fallback.
    message: str(inner?.message) ?? str(outer.error) ?? str(outer.message),
    code: str(inner?.code) ?? str(outer.code),
    requestId: str(inner?.requestId) ?? str(outer.requestId),
  }
}

/** What a failure state needs: the sentence, and the id to quote at an operator. */
export interface ErrorNotice {
  message: string
  requestId: string | undefined
  /** 403 is its own screen: the request was understood and refused, and retrying will not help. */
  forbidden: boolean
  /** 404 likewise, and on this surface it is the common one — a deleted post, a barred voice. */
  missing: boolean
}

/**
 * Normalise a caught error for display.
 *
 * `fallback` covers the non-ApiError case, which is a bug in this bundle rather than a server
 * response — so it is also the only case worth reporting from here. An ApiError has already been
 * logged by the service that produced it, under the request id shown to the reader.
 */
export function noticeFor(err: unknown, fallback: string): ErrorNotice {
  if (err instanceof ApiError) {
    return {
      message: err.message,
      requestId: err.requestId,
      forbidden: err.status === 403,
      missing: err.status === 404,
    }
  }
  report({
    app: APP_NAME,
    type: err instanceof Error ? err.name : 'UnknownError',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? (err.stack ?? null) : null,
    context: { fallback },
  })
  return { message: fallback, requestId: undefined, forbidden: false, missing: false }
}

/* ---- the single-flight refresh ------------------------------------- */

let inflightRefresh: Promise<boolean> | null = null

/**
 * Refresh the session, at most once concurrently.
 *
 * Every caller that arrives while a refresh is in flight awaits THE SAME promise; the slot is
 * cleared when it settles, so the next 401 after this one starts a fresh attempt rather than
 * replaying a stale answer.
 */
export function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return Promise.resolve(false)
  if (!inflightRefresh) {
    inflightRefresh = performRefresh(refreshToken).finally(() => {
      inflightRefresh = null
    })
  }
  return inflightRefresh
}

async function performRefresh(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${nimbusUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      // The same rule as every other request in this file, applied to the one that carries a
      // refresh token in its body. The default is `same-origin`, which happens to send nothing
      // today because Nimbus is cross-origin from every surface — but that is a fact about the
      // current DNS rather than a decision, and it stops being true the moment this bundle is
      // served from the same origin as the API, which is exactly what a local `pnpm dev` does.
      credentials: 'omit',
    })
    if (!res.ok) {
      // Returning false signs the reader out either way, but the two causes are not the same event:
      // a 401 is an expired refresh token and routine, anything else is Nimbus failing. They are
      // indistinguishable for as long as neither is written down.
      if (res.status !== 401) {
        report({
          app: APP_NAME,
          type: 'RefreshFailed',
          message: `Token refresh failed (${res.status})`,
          statusCode: res.status,
          requestId: res.headers.get('x-request-id'),
        })
      }
      return false
    }
    setTokens((await res.json()) as AuthTokens)
    return true
  } catch (err) {
    // The message only. NEVER the error object and never the URL it carries: every browser puts the
    // full request URL in a fetch rejection, and an estate credential has leaked that way before.
    // `nimbusUrl()` is a public hostname with no userinfo, which is why it is reportable at all —
    // and it is reported as its own field rather than by printing what was thrown.
    report({
      app: APP_NAME,
      type: 'RefreshUnreachable',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context: { nimbus: nimbusUrl() },
    })
    return false
  }
}

/**
 * End the session, ONCE.
 *
 * Two callers can reach the same expiry: `request` expires it when a refresh fails, and a caller
 * like `fetchReader` expires it again when it catches the 401 that came out of that. Both are
 * correct on their own — neither can see the other — so the idempotence lives here rather than in a
 * rule about who is allowed to call it.
 *
 * It matters because the event has listeners that do visible things: `AuthProvider` drops the
 * reader, the shell repaints signed-out, and a second identical event a millisecond later is a
 * second sign-out toast, or a second redirect racing the first.
 */
function expireSession(): void {
  const hadSomething = Boolean(getAccessToken() ?? getRefreshToken())
  clearTokens()
  if (!hadSomething) return
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}

/* ---- idempotency ---------------------------------------------------- */

/**
 * A key for a write that must not happen twice.
 *
 * micro-agora accepts `/^[A-Za-z0-9_:.-]{8,200}$/` and REFUSES anything shorter than eight
 * characters — a floor rather than a formality, because a two-character key collides across readers
 * and an idempotency store that collides does not deduplicate a retry, it serves somebody else's
 * answer. `crypto.randomUUID()` is 36 characters of that alphabet.
 *
 * Generated by the CALLER at the start of a compose action and held across retries; a fresh key per
 * attempt would look identical and protect nothing, because the failure it exists for is a retry
 * after a lost response. The composer therefore mints one when the reader starts typing, not when
 * the request is sent.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Padded so the eight-character floor holds even on the unlikely branch.
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/* ---- the request core ---------------------------------------------- */

export interface RequestOptions {
  method?: string
  body?: unknown
  /** Default true: attach the bearer token and refresh once on 401. */
  auth?: boolean
  query?: Record<string, string | number | boolean | undefined | null>
  /** The caller's `Idempotency-Key`. See {@link newIdempotencyKey}. */
  idempotencyKey?: string
  signal?: AbortSignal
}

async function request<T>(base: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, query, idempotencyKey, signal } = opts

  // `base` may be '' (relative, same origin), so resolve against the page origin.
  const url = new URL(base + path, pageOrigin())
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
  }

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const token = getAccessToken()
    if (auth && token) headers['authorization'] = `Bearer ${token}`
    if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey
    return fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
      // NO COOKIES. Every authenticated call here carries a bearer, and the estate gateway's
      // cross-environment CORS grant is what lets this origin read the other network's API. Adding
      // `credentials: 'include'` would make the grant a credentialed one for a cookie nothing
      // reads, which is a CSRF surface bought for nothing.
      credentials: 'omit',
    })
  }

  let res: Response
  try {
    res = await send()
  } catch (err) {
    // An abort is the app doing its job — a reader who navigated away, or switched network mid
    // request — and reporting it as a network fault would fill Lantern with the consequences of
    // scrolling. Rethrown untouched so the caller can tell it apart.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    // The reader-facing sentence is the right one whether the cause is their wifi or our container.
    // The cause itself, though, only exists here — discarding it is how a service being down looked
    // exactly like a bad connection, for everyone, for as long as it lasted.
    report({
      app: APP_NAME,
      type: 'NetworkError',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      // `url.pathname` would carry a handle or a post id straight past the redaction every other
      // reporter in this bundle performs — `/v1/voices/nefeli` is `/v/nefeli` by another spelling.
      // The ROUTE the reader was on, and the API origin, are what a triage actually needs.
      context: { method, api: url.origin, route: routePattern(url.pathname) },
    })
    throw new ApiError(0, 'Cannot reach the square. Check your connection and try again.')
  }

  // One silent refresh and retry on expiry. Several of these at once share one refresh.
  if (res.status === 401 && auth && getRefreshToken()) {
    if (await refreshSession()) {
      res = await send()
    } else {
      expireSession()
      throw new ApiError(
        401,
        'Your session expired. Sign in again.',
        'session_expired',
        res.headers.get('x-request-id') ?? undefined,
      )
    }
  }

  if (!res.ok) {
    // Every service sets this header on every response, error or not, so it is present even when
    // the body is a proxy's HTML page rather than ours.
    let requestId = res.headers.get('x-request-id') ?? undefined
    let message = res.statusText || `Request failed (${res.status})`
    let code: string | undefined
    try {
      const parsed = readErrorBody(await res.json())
      if (parsed.message) message = parsed.message
      if (parsed.code) code = parsed.code
      if (parsed.requestId) requestId = parsed.requestId
    } catch (err) {
      // A non-JSON error body means something in FRONT of the service answered — a gateway, a CDN,
      // a misrouted deploy — and the request never reached it. Nothing server-side logs that, so it
      // has to be reported from here.
      report({
        app: APP_NAME,
        type: 'NonJsonErrorBody',
        message: `${res.status} response from ${url.origin} was not JSON`,
        stack: err instanceof Error ? (err.stack ?? null) : null,
        statusCode: res.status,
        requestId,
        context: { method, contentType: res.headers.get('content-type') },
      })
    }
    if (res.status === 401 && auth) expireSession()
    throw new ApiError(res.status, message, code, requestId)
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined as T
  return (await res.json()) as T
}

/**
 * micro-agora, on the VIEWED network.
 *
 * `apiBase()` is evaluated here, per call, and the `/v1` is part of the path each caller passes so
 * that a route in `lib/agora.ts` reads the way the service's own route table does.
 */
export const api = <T,>(path: string, opts?: RequestOptions): Promise<T> =>
  request<T>(apiBase(), path, opts)

/** Nimbus, which is cross-origin from everywhere. */
export const nimbus = <T,>(path: string, opts?: RequestOptions): Promise<T> =>
  request<T>(nimbusUrl(), path, opts)

/* ---- who is reading ------------------------------------------------- */

/** What identity answers at `/auth/me`, narrowed to what this surface needs. */
export interface MeResponse {
  user?: {
    id?: string | null
    handle?: string | null
    roles?: readonly string[] | null
  } | null
}

export interface Reader {
  readonly handle: string | null
  readonly roles: readonly string[]
}

export const NOBODY: Reader = { handle: null, roles: [] }

/**
 * Read the reader out of an `/auth/me` body.
 *
 * ── THE SHAPE IS NESTED, AND THE ESTATE GOT THIS WRONG AT THE ROOT ────────────────────────────
 *
 * Identity answers `{ user: {...}, session: {...}, organisations: [...] }` — the profile is NESTED
 * under `user`. The web template declared `interface Me { handle?, roles? }` and read both off the
 * TOP level, where they are not; four frontends inherited it, `roles` was then always empty, and
 * the switcher hid every `adminOnly` entry from every signed-in operator. On this surface the
 * consequence would be worse than a missing menu entry: `roles` is what tells the shell whether to
 * show the moderation queue, and a moderator who cannot see reports is a square with nobody
 * answering them.
 *
 * There is no flat fallback, on the template's own reasoning: tolerating one would encode a
 * response identity does not send, and the next reader could not tell which of the two is real.
 */
export function readReader(body: unknown): Reader {
  if (typeof body !== 'object' || body === null) return NOBODY
  const nested = (body as MeResponse).user
  if (typeof nested !== 'object' || nested === null) return NOBODY
  return {
    handle: typeof nested.handle === 'string' && nested.handle.length > 0 ? nested.handle : null,
    roles: Array.isArray(nested.roles)
      ? nested.roles.filter((r): r is string => typeof r === 'string')
      : [],
  }
}

/**
 * Fetch the signed-in reader, or `null` when there is nobody.
 *
 * Allowed to fail quietly — an unreachable identity service must not take the public square down
 * with it — which is why the caller gets `null` rather than a rejection for everything except the
 * one case it can act on.
 */
export async function fetchReader(): Promise<Reader | null> {
  const token = getAccessToken()
  if (!token) return null
  try {
    return readReader(await nimbus<unknown>('/auth/me'))
  } catch (err) {
    // Deliberately NOT reported with the caught value: a fetch rejection carries the whole request
    // URL, and this one is built with a bearer in its headers.
    if (err instanceof ApiError && err.status === 401) expireSession()
    return null
  }
}

/* ---- boot and sign-in ---------------------------------------------- */

/**
 * Redeem an SSO hand-off code, if the Account portal sent us back with one.
 *
 * Called once from `main.tsx` BEFORE React renders, so the first paint already knows whether there
 * is a session and no chrome flashes signed-out and then signed-in.
 *
 * The strip-then-exchange ordering inside `consumeAuthCallback` is load-bearing and is documented
 * where it is implemented: the code leaves the address bar before it goes over the wire, so it is
 * never in the history, in a referrer, or in a screenshot taken while the request is in flight.
 * Nothing here may reorder that, and nothing here may re-read `location.hash` afterwards.
 *
 * IDENTITY MUST KNOW THIS ORIGIN OR THE REDEEM IS REFUSED. `identity/src/handoff.ts` checks the
 * caller against `IDENTITY_HANDOFF_ORIGINS`, and `https://agora…` is added to that list in
 * `deploy/compose/docker-compose.estate.yml` in the same change that ships this surface. Without
 * the deploy half a reader who pressed Sign in would come back here and be silently signed out —
 * which reads as a broken account rather than a missing feature.
 */
export async function bootstrapSession(): Promise<boolean> {
  try {
    const tokens = await consumeAuthCallback()
    if (tokens) {
      setTokens(tokens)
      return true
    }
  } catch (err) {
    // A failed exchange is a signed-out boot, not a broken app: the sign-in button is right there.
    // The message and stack only — see the note in `performRefresh`.
    report({
      app: APP_NAME,
      type: 'AuthCallbackFailed',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
    })
  }
  // ── COLLECT A SESSION THIS ORIGIN CANNOT SEE ────────────────────────────────────────────────
  //
  // Tokens live in `localStorage`, scoped to one origin, and every surface in the estate is its own
  // origin — so a reader signed in at the portal arrives here and is shown a signed-out bar. This
  // asks the apex ONCE per tab, and only when the `cf_sso` cookie hint says a session exists
  // somewhere. An anonymous visitor is never redirected: with no hint `attemptSilentSignIn` returns
  // false, so a stranger who followed a link to a post reads it without an identity round trip.
  const local = hasSession()
  if (attemptSilentSignIn(local)) {
    // A navigation has started and this document is going away. Answer "no session" so nothing
    // paints a signed-out shell in the moments before it does.
    return false
  }
  return local
}

/**
 * Send the browser to the Account portal, returning here afterwards.
 *
 * `returnTo` defaults to the CURRENT URL including its path and query, which is what puts a reader
 * who pressed Reply on a post back on that post rather than on the Square.
 */
export function signIn(returnTo?: string): void {
  signInRedirect(returnTo ?? (typeof window === 'undefined' ? undefined : window.location.href))
}

/** Clear this app's tokens FIRST — the portal cannot reach them — then end the shared session. */
export function signOut(returnTo?: string): void {
  clearTokens()
  signOutRedirect(returnTo ?? (typeof window === 'undefined' ? undefined : window.location.origin))
}

/** Reset module state. Tests only. */
export function __resetAuth(): void {
  inflightRefresh = null
  memory.clear()
}
