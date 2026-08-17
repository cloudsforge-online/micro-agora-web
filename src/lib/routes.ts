/**
 * The route table, as data.
 *
 * This module imports NOTHING. Three separate things have to agree about which addresses this app
 * answers — this table, `src/app.tsx`, and the enumerated `location` block in `nginx.conf` — and
 * `test/routes.test.ts` reads all three as text and cross-checks them. It can only do that if this
 * file is readable without a bundler.
 *
 * The nginx side is the half that fails quietly. `try_files $uri /index.html` answers 200 for every
 * address in existence, including the ones this router does not know, so a typo in a link becomes a
 * blank page with a successful status and a crawler indexes every one of them. The routes are
 * therefore enumerated there, and `error_page 404 /index.html` is what serves the shell UNDER the
 * real status.
 *
 * ── AND ONE MORE CONSUMER, WHICH IS WHY `pattern` IS A FIELD RATHER THAN A COMMENT ────────────
 *
 * `lib/analytics.ts` and `lib/obs.ts` report the PATTERN — `/v/:handle` — where every other surface
 * in the estate reports the path. On this surface the path is the private part: `/v/nefeli` in a
 * Google Analytics property says which browser reads which person, and `/p/<uuid>` says which
 * conversation. Both redactors call {@link routePattern} below, so the list of addresses that get
 * redacted is this table rather than a regex somebody maintains twice.
 */

export interface AppRoute {
  /** The router path, without a leading slash. The index route is the empty string. */
  readonly path: string
  /**
   * What the primary navigation calls it, or null when it is reachable but not a nav destination.
   *
   * `/p/:id`, `/v/:handle` and `/circles/:slug` are null because you do not navigate to "a post",
   * you navigate to a post. `/search` and `/settings` are null because they have their own controls
   * in the chrome — a nav row that lists every address the router knows is a sitemap, not a menu.
   */
  readonly label: string | null
  /** True when this route needs a signed-in reader to mean anything. Decides the nav and the guard. */
  readonly private: boolean
}

/**
 * Every address this app answers.
 *
 * The shape follows the two things people actually do here — read a conversation, and read a
 * person — and each of those is a first-class address rather than a state of the timeline:
 *
 *   `''`             — the Square. The public timeline of the viewed network, readable signed out.
 *                      It is the index because a stranger who lands here should be reading within a
 *                      second, not looking at a sign-in wall. Every other network's front page is a
 *                      sign-up form; this estate already has the account.
 *   `home`           — the reader's own timeline: the voices they follow and the circles they are
 *                      in. Separate from `''` rather than a tab of it because they are different
 *                      resources, and because a reader who signs out mid-scroll should land on
 *                      something readable rather than on an empty version of their own feed.
 *   `p/:id`          — one post and its thread. THE address of this surface: it is what somebody
 *                      pastes into a chat, and the one a stranger opens cold. Everything about the
 *                      nginx enumeration and the 404 status exists so that this survives a refresh.
 *   `v/:handle`      — one voice. By HANDLE, not by id: a link somebody types by hand or reads out
 *                      loud has to be the handle, and the id is a uuid nobody can carry.
 *   `tag/:tag`       — one topic. The way a reader finds a conversation they were not linked to.
 *   `circles`        — the directory of public circles. Indexed; it is the honest answer to "what
 *                      is discussed here" without naming a single person.
 *   `circles/:slug`  — one circle: its purpose, its members, its posts.
 *   `notifications`  — what happened to the reader while they were away.
 *   `whispers`       — private messages. Its own address, and Disallowed in robots.txt.
 *   `bookmarks`      — what the reader saved. Private, and deliberately not "likes": a Spark is
 *                      public and a bookmark is not, which is a distinction most networks blur.
 *   `search`         — posts, voices and tags. Disallowed in robots.txt because the query space is
 *                      infinite and every crawl of it is a full-text scan.
 *   `settings`       — the reader's own voice, their email preferences, and the two controls that
 *                      matter more than the rest of the page put together: who may whisper them,
 *                      and whether their posts are visible to people who do not follow them.
 *   `guidelines`     — what is and is not allowed here, and what happens when somebody reports a
 *                      post. Public and indexed, because a square with no published rules is a
 *                      square where the rules are whatever the operator felt like that day.
 *   `moderation`     — the report queue. An ADDRESS rather than a panel inside settings, because
 *                      the people who work it work it repeatedly and a queue you cannot bookmark is
 *                      a queue somebody navigates to through three screens every time. It is
 *                      `private: true` and the nav entry is hidden from everybody but an operator,
 *                      and neither of those is the control: micro-agora's `requireOperator` refuses
 *                      the routes behind it, so a reader who types the address gets an empty page
 *                      and a 403, not somebody else's reports.
 */
export const ROUTES: readonly AppRoute[] = [
  { path: '', label: 'Square', private: false },
  { path: 'home', label: 'Home', private: true },
  { path: 'p/:id', label: null, private: false },
  { path: 'v/:handle', label: null, private: false },
  { path: 'tag/:tag', label: null, private: false },
  { path: 'circles', label: 'Circles', private: false },
  { path: 'circles/:slug', label: null, private: false },
  { path: 'notifications', label: 'Notifications', private: true },
  { path: 'whispers', label: 'Whispers', private: true },
  { path: 'bookmarks', label: 'Bookmarks', private: true },
  { path: 'search', label: null, private: false },
  { path: 'settings', label: null, private: true },
  { path: 'guidelines', label: 'Guidelines', private: false },
  { path: 'moderation', label: null, private: true },
]

/** The primary navigation, in order. Derived, so a route cannot be added without deciding this. */
export const NAV: readonly {
  readonly to: string
  readonly label: string
  readonly private: boolean
}[] = ROUTES.filter((route): route is AppRoute & { label: string } => route.label !== null).map(
  (route) => ({ to: `/${route.path}`, label: route.label, private: route.private }),
)

/**
 * The FIRST SEGMENT of every non-index route, deduplicated.
 *
 * This is the list nginx enumerates, and it is first segments rather than full paths because the
 * server block matches `^/(…)(/|$)` — one entry covers `/circles` and `/circles/:slug` both. The
 * test splits the alternation in `nginx.conf` on `|` and compares the two sets in BOTH directions:
 * a route added here and forgotten there answers the fallback, which is a 404 for an address the
 * app has; a segment left there after a route is deleted is a 200 for an address it does not.
 */
export const NON_INDEX_SEGMENTS: readonly string[] = [
  ...new Set(
    ROUTES.filter((route) => route.path !== '').map((route) => route.path.split('/')[0] ?? ''),
  ),
]

/* ---- links ---------------------------------------------------------- */

/** One post and its thread. */
export const postPath = (id: string): string => `/p/${encodeURIComponent(id)}`

/** One voice, by handle. The `@` is never part of the address — it is punctuation, not an id. */
export const voicePath = (handle: string): string =>
  `/v/${encodeURIComponent(handle.replace(/^@/, ''))}`

/** One topic. The `#` is likewise punctuation. */
export const tagPath = (tag: string): string => `/tag/${encodeURIComponent(tag.replace(/^#/, ''))}`

/** One circle, by slug. */
export const circlePath = (slug: string): string => `/circles/${encodeURIComponent(slug)}`

/** A search, pre-filled. A query belongs in the query string: it is a draft, not an identity. */
export const searchPath = (q: string): string => `/search?q=${encodeURIComponent(q)}`

/**
 * One whisper thread. A QUERY PARAMETER rather than `/whispers/:id`, on purpose.
 *
 * A path segment is what a browser puts in history, in a referrer, and in the address bar of a
 * screen somebody is sharing. A thread id names a private conversation with one other person, and
 * the list page is where that conversation is chosen — so the id is a parameter of the list rather
 * than an address of its own, and `/whispers` is the only whisper address that exists.
 */
export const whisperPath = (threadId: string): string =>
  `/whispers?t=${encodeURIComponent(threadId)}`

/* ---- redaction ------------------------------------------------------ */

/**
 * A concrete pathname to the route PATTERN that produced it: `/v/nefeli` → `/v/:handle`.
 *
 * This is what `lib/analytics.ts` and `lib/obs.ts` report in place of the real path, and it is a
 * pure function over {@link ROUTES} so that adding a route adds its redaction at the same time. An
 * address that matches nothing becomes `/unknown` rather than being passed through: the fallback is
 * exactly where an unexpected path would leak, and "some browser opened an address we do not have"
 * is the whole of what a counter needs to know about it.
 *
 * Segment count is compared first, so `/circles` and `/circles/:slug` cannot be confused, and the
 * literal segments must match exactly — only a `:param` segment is a wildcard.
 */
export function routePattern(pathname: string): string {
  const parts = pathname.split('/').filter((s) => s.length > 0)
  if (parts.length === 0) return '/'
  for (const route of ROUTES) {
    if (route.path === '') continue
    const shape = route.path.split('/')
    if (shape.length !== parts.length) continue
    const matches = shape.every((seg, i) => seg.startsWith(':') || seg === parts[i])
    if (matches) return `/${route.path}`
  }
  return '/unknown'
}
