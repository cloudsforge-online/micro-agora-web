/**
 * The route table, the router and the web server, cross-checked as text.
 *
 * ── WHY THIS IS A TEXT TEST RATHER THAN A RENDER TEST ─────────────────────────────────────────
 *
 * Three separate artefacts decide which addresses this bundle answers, and only two of them are
 * JavaScript:
 *
 *   `src/lib/routes.ts`  — `ROUTES`, which the navigation, the redaction and this cross-check use
 *   `src/app.tsx`        — the `<Route>` elements the router actually mounts
 *   `nginx.conf`         — the enumerated `location` block, which decides the HTTP STATUS
 *
 * A render test can see the first two disagree. Nothing that runs in this process can see the third
 * at all: nginx is not imported and not typechecked, and a route added to the router without a
 * matching `location` renders perfectly in every other test here. It fails only in production and
 * it fails QUIETLY — the address answers 404, `error_page` serves the shell under it, React draws
 * the right page, and the only symptom is that a crawler and an uptime check both believe a working
 * page is missing.
 *
 * On this surface that is not an abstract cost. `/p/<id>` is the address somebody pastes into a
 * conversation, and it is how most strangers arrive.
 *
 * ── AND THE REDACTION IS PART OF THE SAME TABLE ───────────────────────────────────────────────
 *
 * `routePattern()` is what `lib/analytics.ts` and `lib/obs.ts` report in place of the path, so a
 * route added without a pattern is a handle sent to Google. It is tested here, beside the table it
 * reads, rather than in each reporter.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  NAV,
  NON_INDEX_SEGMENTS,
  ROUTES,
  circlePath,
  postPath,
  routePattern,
  searchPath,
  tagPath,
  voicePath,
  whisperPath,
} from '../src/lib/routes.ts'
import { read, stripComments } from './sources.ts'

const nginx = stripComments(read('nginx.conf'), 'nginx')
const app = stripComments(read('src/app.tsx'), 'ts')

/** Every `path=` on a `<Route>` in app.tsx, plus `''` for the index route. */
function routerPaths(): string[] {
  const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1] ?? '')
  if (/<Route\s+index\b/.test(app)) paths.unshift('')
  return paths
}

test('THE ROUTER MOUNTS EXACTLY THE TABLE, IN BOTH DIRECTIONS', () => {
  const mounted = routerPaths().filter((p) => p !== '*')
  assert.deepEqual(
    [...mounted].sort(),
    ROUTES.map((r) => r.path).sort(),
    'src/app.tsx and ROUTES disagree. A route in the table that nothing mounts is a nav entry ' +
      'leading to the not-found page; a route mounted without a table entry has no nginx location, ' +
      'so it answers 404 in production while passing every render test in this directory.',
  )
  // The catch-all is not a route, it is what happens when none matched — and it has to exist, or an
  // unknown address renders an empty shell with no way back out.
  assert.ok(routerPaths().includes('*'), 'src/app.tsx mounts no catch-all')
})

test('NGINX ENUMERATES EVERY FIRST SEGMENT, AND THE INDEX IS EXACT', () => {
  // `location = /agora` and not `location /agora`: the prefix form matches every address under the
  // mount and turns the whole "an unknown path answers 404" argument in nginx.conf's header into a
  // comment. BOTH spellings of the front door are required — a folder has a trailing-slash form
  // that a hostname root never had, and the 301 from the retired hostname lands on it.
  assert.match(nginx, /location\s*=\s*\/agora\s*\{/, 'nginx.conf has no exact-match location for the index')
  assert.match(nginx, /location\s*=\s*\/agora\/\s*\{/, 'nginx.conf does not serve the trailing-slash front door')

  const alternation = /location\s+~\s+\^\/agora\/\(([^)]+)\)\(\/\|\$\)/.exec(nginx)?.[1]
  assert.ok(alternation, 'nginx.conf has no enumerated route location, or its shape has changed')
  assert.deepEqual(
    alternation.split('|').sort(),
    [...NON_INDEX_SEGMENTS].sort(),
    'nginx.conf and NON_INDEX_SEGMENTS disagree. A segment missing there answers 404 for an ' +
      'address the app HAS; a stale one answers 200 for an address it does not, which is the ' +
      '"every address is a success" failure the enumeration exists to stop.',
  )
})

test('THE SPA FALLBACK IS ABSENT AND error_page IS PRESENT', () => {
  // The single most important line in nginx.conf, asserted as an absence because it is the default
  // everybody reaches for. `try_files $uri /index.html` answers 200 for every address in existence,
  // which makes a "page not found" screen a success: crawlers index it, uptime checks call it
  // healthy, and a deploy that drops a route looks exactly like a deploy that did not.
  assert.doesNotMatch(
    nginx,
    /try_files\s+\$uri\s+(\$uri\/\s+)?\/index\.html/,
    'nginx.conf has the SPA fallback — see its own header for why it must not',
  )
  // Mounted: the shell is `/agora/index.html`, and `error_page 404 /index.html` would point at a
  // file the document root no longer holds — nginx would then serve its own 404 page, which is the
  // "the visitor gets nginx's error page, not NotFoundPage" half of the rule above.
  assert.match(nginx, /error_page\s+404\s+\/agora\/index\.html/)
})

test('every route location restates the security headers', () => {
  // nginx's `add_header` is ALL-OR-NOTHING per level: a location that declares any `add_header`
  // inherits NONE from its parent. `location /assets/` did exactly this in the web template and
  // stripped `nosniff` from every hashed script in every frontend cut from it.
  const blocks = [...nginx.matchAll(/location[^\n{]*\{([\s\S]*?)\n {4}\}/g)].map((m) => m[1] ?? '')
  assert.ok(blocks.length >= 6, 'the location blocks are not being parsed; this check reads them')
  for (const block of blocks) {
    if (!/add_header/.test(block)) continue
    for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']) {
      assert.match(
        block,
        new RegExp(header),
        `a location declares add_header without restating ${header}, so it serves without it`,
      )
    }
  }
})

test('THE FRAME POLICY IS DENY, WHICH THIS SURFACE IS THE ONE THAT EARNS', () => {
  // Every other public frontend in the estate is a reference page another CloudsForge site has a
  // reason to embed. This one carries authenticated write controls — a composer, a Spark button, a
  // Follow button — on pages a stranger's link opens, which is the shape clickjacking needs.
  assert.match(nginx, /X-Frame-Options "DENY"/)
  assert.doesNotMatch(nginx, /SAMEORIGIN/)
})

test('the navigation is derived from the table and every entry is an address nginx serves', () => {
  assert.deepEqual(
    NAV.map((item) => item.to),
    ROUTES.filter((r) => r.label !== null).map((r) => `/${r.path}`),
  )
  for (const item of NAV) {
    const segment = item.to.replace(/^\//, '').split('/')[0] ?? ''
    assert.ok(
      segment === '' || NON_INDEX_SEGMENTS.includes(segment),
      `the nav links to ${item.to}, which nginx does not serve`,
    )
  }
  // A nav row that lists every address the router knows is a sitemap rather than a menu: the three
  // parameterised routes and the two with their own controls in the chrome are deliberately absent.
  assert.deepEqual(
    ROUTES.filter((r) => r.label === null).map((r) => r.path),
    ['p/:id', 'v/:handle', 'tag/:tag', 'circles/:slug', 'search', 'settings', 'moderation'],
  )
})

test('THE MODERATION QUEUE IS SERVED AND GUARDED SOMEWHERE ELSE', () => {
  // The one entry in the alternation that looks like a mistake. Serving the shell at an address
  // only an operator may use is not a leak: the page renders, micro-agora's `requireOperator`
  // refuses every request it makes, and the reader sees a 403 panel. Leaving it out would answer
  // 404 for an address the app HAS and break the bookmark of the one person who works the queue.
  assert.ok(NON_INDEX_SEGMENTS.includes('moderation'))
  assert.ok(ROUTES.some((r) => r.path === 'moderation' && r.private && r.label === null))
})

test('a private route is private in the table, and there is no guard in the router', () => {
  // The six private routes wrap their own bodies in `RequireSession`, which renders a panel and
  // KEEPS the address. A guard in the route table would have to redirect, and a reader opening a
  // bookmarked `/whispers` in a fresh browser session would land on the Square with no explanation
  // and no way back to where they were going.
  assert.deepEqual(
    ROUTES.filter((r) => r.private).map((r) => r.path),
    ['home', 'notifications', 'whispers', 'bookmarks', 'settings', 'moderation'],
  )
  for (const forbidden of ['ProtectedRoute', 'RequireAuth', 'redirectToLogin', 'loader=']) {
    assert.ok(
      !app.includes(forbidden),
      `src/app.tsx references ${forbidden}; the private routes guard their own bodies instead`,
    )
  }
})

test('THE PUBLIC ROUTES ARE PUBLIC, WHICH IS WHY THE INDEX IS THE SQUARE', () => {
  // A stranger who lands here should be reading within a second rather than looking at a sign-in
  // wall. Every other network's front page is a sign-up form; this estate already has the account.
  const square = ROUTES.find((r) => r.path === '')
  assert.ok(square && !square.private && square.label === 'Square')
  for (const path of ['p/:id', 'v/:handle', 'tag/:tag', 'circles', 'circles/:slug', 'guidelines']) {
    assert.equal(ROUTES.find((r) => r.path === path)?.private, false, `${path} is not public`)
  }
})

test('THE REDACTION COVERS EVERY ROUTE, AND CARRIES NOTHING BACK', () => {
  // What `lib/analytics.ts` and `lib/obs.ts` report in place of the path. A route whose pattern is
  // not derived here is a handle sent to Google — so every route in the table is walked with a
  // concrete value substituted for each parameter, and the result must be the pattern.
  const concrete: Record<string, string> = {
    ':id': '9f2c1f7e-0b3a-4d5e-8a11-2c3d4e5f6a7b',
    ':handle': 'nefeli',
    ':tag': 'mining',
    ':slug': 'the-forge',
  }
  for (const route of ROUTES) {
    const path = route.path
      .split('/')
      .map((seg) => (seg.startsWith(':') ? (concrete[seg] ?? 'x') : seg))
      .join('/')
    assert.equal(routePattern(`/${path}`), path === '' ? '/' : `/${route.path}`)
  }
  // An address that matches nothing becomes `/unknown` rather than being passed through — the
  // fallback is exactly where an unexpected path would leak.
  assert.equal(routePattern('/v/nefeli/followers/secret'), '/unknown')
  assert.equal(routePattern('/../etc/passwd'), '/unknown')
  // Segment count is compared before the literals, so a childless route cannot swallow a child.
  assert.equal(routePattern('/circles'), '/circles')
  assert.equal(routePattern('/circles/the-forge'), '/circles/:slug')
})

test('a link builder encodes, and strips the punctuation that is not part of the id', () => {
  assert.equal(postPath('9f2c/1f7e'), '/p/9f2c%2F1f7e')
  // The `@` and the `#` are punctuation, not identifiers — stored values carry neither, and a
  // builder handed the displayed form must not double them.
  assert.equal(voicePath('@nefeli'), '/v/nefeli')
  assert.equal(voicePath('nefeli'), '/v/nefeli')
  assert.equal(tagPath('#mining'), '/tag/mining')
  assert.equal(circlePath('the forge'), '/circles/the%20forge')
  assert.equal(searchPath('a b&c'), '/search?q=a%20b%26c')
})

test('A WHISPER THREAD IS A QUERY ON /whispers, NOT AN ADDRESS OF ITS OWN', () => {
  // A path segment is what a browser puts in history, in a referrer, and in the address bar of a
  // screen somebody is sharing. A thread id names a private conversation with one other person.
  assert.equal(whisperPath('t-123'), '/whispers?t=t-123')
  assert.ok(!NON_INDEX_SEGMENTS.includes('whisper'))
  assert.equal(
    ROUTES.filter((r) => r.path.startsWith('whispers')).length,
    1,
    'a second whispers route exists; the thread id belongs in the query',
  )
})

test('routes.ts imports nothing, so this test can read it without a bundler', () => {
  // The module's own claim, checked. An import of a `.css` or of `@cloudsforge/ui` here would make
  // it unloadable outside vite, and this whole cross-check would quietly stop running.
  assert.doesNotMatch(read('src/lib/routes.ts'), /^\s*import\s/m)
})
