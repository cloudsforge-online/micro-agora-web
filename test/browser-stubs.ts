/**
 * The smallest browser these tests need.
 *
 * The pure layer of this bundle — `lib/format.ts`, `lib/routes.ts`, `lib/analytics.ts`,
 * `lib/obs.ts`, `lib/api.ts` — touches five globals and they are all stubbed here: `window`,
 * `localStorage`, `sessionStorage`, `document` and `fetch`. Everything else is a function over
 * data, which is why so much of this repository can be proven without a DOM.
 *
 * ── THE DOCUMENT STUB IS THREE METHODS, AND THAT IS DELIBERATE ────────────────────────────────
 *
 * `lib/obs.ts` reads one meta tag and `lib/analytics.ts` reads `document.referrer`. Neither needs a
 * tree, and a whole happy-dom for them would make the observability tests depend on a DOM
 * implementation's idea of what `querySelector` returns for a tag nobody appended. The tests that
 * genuinely need a document — the ones about what a page RENDERS — mount happy-dom themselves.
 *
 * ── WHY `installFetch` RECORDS THE SIGNAL ────────────────────────────────────────────────────
 *
 * `lib/api.ts` gives an abortable request its caller's signal and rethrows `AbortError` untouched,
 * so an abort is not reported to Lantern as a network fault. Proving that means the stub has to
 * behave like a real fetch and reject when the signal fires; a handler that ignores it behaves
 * exactly as it did before.
 */

export interface StubLocation {
  href: string
  origin: string
  hostname: string
  pathname: string
  search: string
  hash: string
  assign: (url: string) => void
}

export interface StubWindow {
  location: StubLocation
  history: { replaceState: (state: unknown, title: string, url: string) => void }
  addEventListener: (type: string, listener: unknown, options?: unknown) => void
  removeEventListener: (type: string, listener: unknown) => void
  dispatchEvent: (event: Event) => boolean
  dataLayer?: IArguments[]
  /**
   * The two stores, read off the WINDOW rather than the global.
   *
   * `@cloudsforge/ui/consent` reads `window.localStorage` and `attemptSilentSignIn` reads
   * `window.sessionStorage`, while this bundle's own modules read the bare globals. Both spellings
   * are the same object in a browser, so both are the same object here — a stub where they differ
   * would let a test pass against a store the code under test never reads.
   */
  readonly localStorage: Storage | undefined
  readonly sessionStorage: Storage | undefined
}

export interface Browser {
  window: StubWindow
  /** Every side effect, in the order it happened. */
  trace: string[]
  /** URLs passed to history.replaceState. */
  replaced: string[]
  /** Event types dispatched on the window — `cf:auth-expired` is the one that matters here. */
  dispatched: string[]
  /** URLs passed to location.assign: where a sign-in redirect would have sent the browser. */
  assigned: string[]
  /** Listeners the code under test attached, by type, so a test can fire one. */
  listeners: Map<string, ((event: unknown) => void)[]>
}

/** Install a window at `url`, returning the record of what the code under test did to it. */
export function installWindow(url: string): Browser {
  const parsed = new URL(url)
  const trace: string[] = []
  const replaced: string[] = []
  const dispatched: string[] = []
  const assigned: string[] = []
  const listeners = new Map<string, ((event: unknown) => void)[]>()

  const location: StubLocation = {
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    assign(next: string) {
      assigned.push(next)
      trace.push(`assign:${next}`)
    },
  }

  const window: StubWindow = {
    location,
    history: {
      replaceState(_state, _title, next) {
        replaced.push(next)
        trace.push(`replaceState:${next}`)
        // A real replaceState updates location too, and every ordering guarantee about the
        // hand-off code leaving the address bar is only meaningful if the hash is genuinely gone.
        const resolved = new URL(next, location.origin)
        location.href = resolved.href
        location.pathname = resolved.pathname
        location.search = resolved.search
        location.hash = resolved.hash
      },
    },
    addEventListener(type: string, listener: unknown) {
      const bucket = listeners.get(type) ?? []
      bucket.push(listener as (event: unknown) => void)
      listeners.set(type, bucket)
    },
    removeEventListener(type: string, listener: unknown) {
      const bucket = (listeners.get(type) ?? []).filter((l) => l !== listener)
      listeners.set(type, bucket)
    },
    dispatchEvent(event: Event) {
      dispatched.push(event.type)
      trace.push(`dispatch:${event.type}`)
      return true
    },
    get localStorage() {
      return (globalThis as { localStorage?: Storage }).localStorage
    },
    get sessionStorage() {
      return (globalThis as { sessionStorage?: Storage }).sessionStorage
    },
  }

  ;(globalThis as unknown as { window?: StubWindow }).window = window
  return { window, trace, replaced, dispatched, assigned, listeners }
}

export function removeWindow(): void {
  delete (globalThis as unknown as { window?: StubWindow }).window
}

export interface StubDocument {
  title: string
  readonly referrer: string
  cookie: string
  visibilityState: 'visible' | 'hidden'
  /** Listeners the code under test attached, so a test can fire `visibilitychange`. */
  readonly listeners: Map<string, ((event: unknown) => void)[]>
  querySelector: (selector: string) => { getAttribute: (attr: string) => string | null } | null
  addEventListener: (type: string, listener: unknown) => void
}

/**
 * A document with the four things this bundle and the design system read off one: a meta tag, the
 * referrer, the cookie jar and `visibilitychange`.
 *
 * `querySelector` is exact-match on the selector string rather than a parser. That is enough for
 * `meta[name="cf-release"]`, which is the only selector `lib/obs.ts` uses, and it fails loudly by
 * returning null if somebody changes the selector without changing this — which is the correct
 * outcome, because the release would then read `unknown` in production too.
 *
 * ── THE COOKIE JAR IS NOT DECORATION ──────────────────────────────────────────────────────────
 *
 * `@cloudsforge/ui/consent` reads its decision from a cookie BEFORE it falls back to
 * `localStorage`, and `signOutRedirect` drops the SSO hint by writing one. Both read
 * `document.cookie` unguarded after the `typeof document` check, so a document without the
 * property does not degrade — `undefined.split(';')` throws, and the throw surfaces as a test
 * failure a long way from the stub that caused it. The jar honours `Max-Age=0` because that is how
 * this estate expires a cookie, and it ignores `Domain` because a stub has no registrable domain
 * to enforce it against.
 */
export function installDocument(
  meta: Record<string, string> = {},
  referrer = '',
  seedCookies: Record<string, string> = {},
): StubDocument {
  const jar = new Map<string, string>(Object.entries(seedCookies))
  const listeners = new Map<string, ((event: unknown) => void)[]>()

  const doc: StubDocument = {
    title: '',
    referrer,
    visibilityState: 'visible',
    listeners,
    get cookie(): string {
      return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    set cookie(next: string) {
      const [pair = '', ...attributes] = next.split(';').map((part) => part.trim())
      const eq = pair.indexOf('=')
      if (eq < 0) return
      const name = pair.slice(0, eq).trim()
      const expired = attributes.some(
        (a) => /^max-age=0$/i.test(a) || /^expires=Thu, 01 Jan 1970/i.test(a),
      )
      if (expired) jar.delete(name)
      else jar.set(name, pair.slice(eq + 1).trim())
    },
    querySelector(selector: string) {
      const name = /^meta\[name="([^"]+)"\]$/.exec(selector)?.[1]
      if (name === undefined || !(name in meta)) return null
      return { getAttribute: (attr: string) => (attr === 'content' ? (meta[name] ?? null) : null) }
    },
    addEventListener(type: string, listener: unknown) {
      const bucket = listeners.get(type) ?? []
      bucket.push(listener as (event: unknown) => void)
      listeners.set(type, bucket)
    },
  }
  ;(globalThis as { document?: unknown }).document = doc
  return doc
}

export function removeDocument(): void {
  delete (globalThis as { document?: unknown }).document
}

/** An in-memory Storage, so the storage path under test is the real one rather than the fallback. */
function memoryStorage(seed: Record<string, string> = {}): {
  storage: Storage
  map: Map<string, string>
} {
  const map = new Map<string, string>(Object.entries(seed))
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as unknown as Storage
  return { storage, map }
}

export function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const { storage, map } = memoryStorage(seed)
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  return map
}

export function removeStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage
}

export function installSessionStorage(seed: Record<string, string> = {}): Map<string, string> {
  const { storage, map } = memoryStorage(seed)
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = storage
  return map
}

export function removeSessionStorage(): void {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage
}

/**
 * A `localStorage` that THROWS on access, which is what Safari does in a private window.
 *
 * The reason `lib/api.ts` probes with a `getItem` inside a `try` rather than trusting `typeof`: the
 * throw happens on ACCESS. A bundle that touched it directly would take the whole square down at
 * import time for a reader who opened a linked post in a private window — a very ordinary way to
 * open a link somebody sent you.
 */
export function installHostileStorage(): void {
  ;(globalThis as { localStorage?: unknown }).localStorage = new Proxy(
    {},
    {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    },
  )
}

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
  signal: AbortSignal | undefined
  /**
   * Recorded because `credentials: 'omit'` is a SECURITY property of every request this bundle
   * makes, not a detail: the estate gateway grants this origin cross-environment CORS, and an
   * `include` would turn that grant into a credentialed one for a cookie nothing reads.
   */
  credentials: RequestCredentials | undefined
  /** `lib/obs.ts` relies on this to get the last batch out of a document that is being discarded. */
  keepalive: boolean | undefined
}

export interface FetchStub {
  calls: FetchCall[]
  restore: () => void
}

/** Replace global fetch with `handler`, recording every call. */
export function installFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
  trace?: string[],
): FetchStub {
  const original = globalThis.fetch
  const calls: FetchCall[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
      credentials: init?.credentials ?? undefined,
      keepalive: init?.keepalive ?? undefined,
    }
    calls.push(call)
    trace?.push(`fetch:${call.url}`)
    return handler(call)
  }) as typeof fetch

  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

export interface Beacon {
  url: string
  bytes: number
  type: string
}

/**
 * A `navigator` carrying `sendBeacon`, which Node has a `navigator` without.
 *
 * `defineProperty` rather than assignment: Node's own `navigator` is an accessor on `globalThis`
 * with no setter, so `globalThis.navigator = …` throws outright. The original descriptor is put
 * back by the returned function, because leaving a stub navigator installed changes what
 * `lib/obs.ts` decides for every later test in the file.
 */
export function installNavigator(): { beacons: Beacon[]; restore: () => void } {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const beacons: Beacon[] = []
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Mozilla/5.0 (stub)',
      sendBeacon(url: string, blob: Blob) {
        beacons.push({ url, bytes: blob.size, type: blob.type })
        return true
      },
    },
  })
  return {
    beacons,
    restore() {
      if (original) Object.defineProperty(globalThis, 'navigator', original)
      else delete (globalThis as { navigator?: unknown }).navigator
    },
  }
}

/** A JSON response, with the request id header every CloudsForge service sets. */
export function json(status: number, body: unknown, requestId = 'req-0000'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  })
}
