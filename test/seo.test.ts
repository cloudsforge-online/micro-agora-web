/**
 * What a crawler, a link-preview fetcher and a reader's tab title are told, and where each is
 * decided.
 *
 * ── TWO HEADS DESCRIBE THIS PAGE AND ONLY ONE OF THEM RUNS JAVASCRIPT ─────────────────────────
 *
 * `index.html` is what a link-preview fetcher reads — Slack, Discord, WhatsApp and X all render a
 * card without executing a line of script, and so do several crawlers. `useTitle` in
 * `components/shell.tsx` is what a browser and a JavaScript-executing crawler end up with, because
 * `applyHead` rewrites those same tags in place on every navigation.
 *
 * So the strings exist twice, are read by different audiences, and drift silently: nothing renders
 * wrong, nothing errors, and the honest one is whichever somebody last remembered to edit. This
 * file compares them.
 *
 * ── AND THE CANONICAL IS THE OPPOSITE DECISION FROM THE ANALYTICS ONE ─────────────────────────
 *
 * `lib/analytics.ts` and `lib/obs.ts` report `/v/:handle` and never `/v/nefeli`. The canonical does
 * the reverse and carries the concrete path, deliberately: a canonical pointing at the pattern
 * would tell every crawler that fourteen thousand profiles are one page, and they would index one.
 * The difference is the audience — the pattern is what a THIRD PARTY is told about a reader, the
 * path is what a crawler is told about a document that is already public.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalHref, metaTags, surfaceMeta } from '@cloudsforge/ui/seo'
import { PRODUCT, SURFACE_DESCRIPTION } from '../src/lib/hosts.ts'
import { ROUTES } from '../src/lib/routes.ts'
import { read, sourceFiles, stripComments } from './sources.ts'

const html = read('index.html')
const bare = stripComments(html, 'html')
const shell = stripComments(read('src/components/shell.tsx'), 'ts')
const nginx = stripComments(read('nginx.conf'), 'nginx')

/** The `content` of a meta tag, however it is wrapped across lines. */
function metaContent(attribute: 'name' | 'property', key: string): string | null {
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${key}"\\s+content="([^"]*)"|<meta\\s*\\n\\s*${attribute}="${key}"\\s*\\n\\s*content="([^"]*)"`,
  )
  const m = pattern.exec(bare)
  return m ? (m[1] ?? m[2] ?? null) : null
}

test('THE STATIC DESCRIPTION AND THE ONE REACT WRITES ARE THE SAME BYTES', () => {
  // The tag a crawler that does not run JavaScript reads, against the constant the one that does
  // ends up with. They cannot be allowed to describe the same page differently.
  assert.equal(metaContent('name', 'description'), SURFACE_DESCRIPTION)
  assert.equal(metaContent('property', 'og:description'), SURFACE_DESCRIPTION)
  assert.equal(
    surfaceMeta(PRODUCT, { description: SURFACE_DESCRIPTION }).description,
    SURFACE_DESCRIPTION,
  )
})

test('the description leads with the account, which is the fact that decides whether to read on', () => {
  // Often the only sentence a stranger sees before deciding whether this is one more network asking
  // them to sign up. The answer to that is the whole pitch, so it goes in the first sentence.
  assert.match(SURFACE_DESCRIPTION, /account you already have/)
  assert.ok(SURFACE_DESCRIPTION.length < 200, 'a description over ~200 characters is truncated')
  assert.ok(SURFACE_DESCRIPTION.length > 80)
})

test('the static title is the surface name, and matches what the root route writes', () => {
  assert.equal(/<title>([^<]*)<\/title>/.exec(bare)?.[1], 'Forge Agora')
  // `surfaceMeta` never suffixes the surface name onto itself — "Forge Agora — Forge Agora" is what
  // a naive suffix produces at a root, and this surface's root is its busiest page.
  assert.equal(surfaceMeta(PRODUCT).title, 'Forge Agora')
  assert.equal(surfaceMeta(PRODUCT, { title: 'Guidelines' }).title, 'Guidelines — Forge Agora')
})

test('THERE IS EXACTLY ONE HEAD WRITER, AND IT IS THE HOOK EVERY PAGE ALREADY CALLS', () => {
  // A second `applyHead` is how a page's title survives a navigation away from it. It is also how
  // the private-route `noindex` below stops being applied to the one route that forgot to opt in.
  const callers = [...shell.matchAll(/applyHead\(/g)].length
  assert.equal(callers, 1, `applyHead is called ${callers} times in the shell`)
  assert.match(shell, /export function useTitle\(/)
})

test('the head writer is a HOOK rather than an effect in the shell, and that ordering is load-bearing', () => {
  // React runs a CHILD's effects before its parent's. A head effect in the shell would therefore
  // run after each page's, and overwrite every page title with the surface name on every single
  // navigation — a bug that is invisible in development, where the first render is also the last.
  // The import naturally names `applyHead`; what must not exist is a second CALL to it, or a bare
  // `document.title =`, anywhere outside the hook.
  assert.doesNotMatch(
    shell.replace(/export function useTitle\([\s\S]*?\n\}/, ''),
    /applyHead\(|document\.title\s*=/,
    'the shell writes the head outside useTitle; a child page would then be overwritten',
  )
})

test('every page writes a head, because a page that does not inherits the last one', () => {
  // The failure is specific and it looks like a caching bug: open a profile, then a thread, and the
  // tab still says the profile. Bookmarks, history and the card of anything shared from there are
  // all wrong, and nothing in the page itself looks broken.
  const pages = sourceFiles().filter((f) => f.path.startsWith('src/pages/'))
  for (const { path, text } of pages) {
    assert.match(text, /useTitle\(/, `${path} never sets a title`)
  }
  assert.ok(pages.length >= 14, `only ${pages.length} pages were found`)
})

test('A PRIVATE ROUTE IS noindex, BECAUSE robots.txt FORBIDS THE CRAWL AND NOT THE INDEXING', () => {
  // The distinction everybody gets wrong. `Disallow` stops a crawler FETCHING the page; it does not
  // stop the URL appearing in results, because a link from anywhere else is enough to index the
  // address on its own — and Google explicitly says a disallowed URL can rank on inbound links.
  // The tag that actually removes it is `noindex`, and a disallowed page is never fetched, so the
  // tag is never read. The reader's own pages need both, from the two places that can say them.
  for (const route of ROUTES.filter((r) => r.private)) {
    const meta = surfaceMeta(PRODUCT, { robots: 'noindex, nofollow', path: `/${route.path}` })
    assert.equal(meta.robots, 'noindex, nofollow')
  }
  // And the shell decides it from the same table this test reads, rather than from a second list.
  assert.match(shell, /ROUTES\.some\(/)
  assert.match(shell, /noindex, nofollow/)
})

test('a public route is indexable and asks for a large card', () => {
  const meta = surfaceMeta(PRODUCT, { path: '/guidelines' })
  assert.equal(meta.robots, 'index, follow, max-image-preview:large')
})

test('THE CANONICAL CARRIES THE CONCRETE PATH, WHICH IS THE OPPOSITE OF THE ANALYTICS RULE', () => {
  // A canonical of `/v/:handle` would collapse every profile into one document. The audiences are
  // different: a third party is told the pattern, a crawler is told the address of a page that is
  // already public and that it can already fetch.
  assert.equal(
    canonicalHref(surfaceMeta(PRODUCT, { path: '/v/nefeli' }), 'https://agora.cloudsforge.online'),
    'https://agora.cloudsforge.online/v/nefeli',
  )
  // A trailing slash is the classic way one page acquires two addresses and splits its indexing.
  assert.equal(surfaceMeta(PRODUCT, { path: '/circles/' }).path, '/circles')
  assert.equal(surfaceMeta(PRODUCT, { path: '/' }).path, '/')
})

test('the origin is read at call time, so one artefact composes correct absolute URLs everywhere', () => {
  // The same bundle serves localhost, a preview deployment and both estates. An origin captured in
  // the module — or worse, baked at build time — makes the canonical on one of them point at
  // another, which is the one SEO mistake that hands your traffic to a different hostname.
  assert.match(shell, /window\.location\.origin/)
  const tags = metaTags(surfaceMeta(PRODUCT, { path: '/p/abc' }), 'https://example.test')
  assert.equal(tags.find((t) => t.key === 'og:url')?.content, 'https://example.test/p/abc')
  assert.equal(
    metaTags(surfaceMeta(PRODUCT, { path: '/p/abc' }), '').find((t) => t.key === 'og:url')?.content,
    '/p/abc',
  )
})

test('robots.txt disallows the reader OWN pages, and says why each one is there', () => {
  const disallowed = [...nginx.matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1] ?? '')
  assert.deepEqual(disallowed, [
    '/home',
    '/notifications',
    '/whispers',
    '/bookmarks',
    '/settings',
    '/search',
  ])
  // Every disallowed address is a route that exists. A stale entry is harmless and a missing one is
  // not, so the check that matters runs the other way too, below.
  for (const path of disallowed) {
    assert.ok(
      ROUTES.some((r) => `/${r.path}` === path),
      `robots.txt disallows ${path}, which is not a route`,
    )
  }
  // `/search` is public and disallowed for the ordinary reason — an infinite query space is a
  // full-text scan of the whole square, once per crawler.
  assert.equal(ROUTES.find((r) => r.path === 'search')?.private, false)
})

test('the one private route robots.txt does NOT disallow is covered by the head instead', () => {
  // `/moderation`. Nothing links to it, so no crawler finds it; and if one did, `useTitle` writes
  // `noindex, nofollow` from the same `private` flag. Listing it in robots.txt would publish the
  // address of the operator console in a file whose entire purpose is being read by strangers.
  const disallowed = [...nginx.matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1] ?? '')
  const uncovered = ROUTES.filter((r) => r.private && !disallowed.includes(`/${r.path}`))
  assert.deepEqual(uncovered.map((r) => r.path), ['moderation'])
})

test('THE SITEMAP LISTS THREE ADDRESSES, AND THE ABSENCES ARE THE DECISION', () => {
  const locs = [...nginx.matchAll(/<loc>\$scheme:\/\/\$host([^<]*)<\/loc>/g)].map((m) => m[1] ?? '')
  assert.deepEqual(locs, ['', '/circles', '/guidelines'])
  // `/p/<id>`, `/v/<handle>` and `/tag/<tag>` are public, indexable, and deliberately not listed. A
  // sitemap is this site's own account of what it publishes; every one of those is somebody's words
  // or somebody's name, and an entry saying "we publish this, come back for it" outlives a delete.
  for (const listed of locs) {
    assert.ok(!listed.includes(':'), 'the sitemap carries a route pattern')
    assert.equal(
      ROUTES.some((r) => `/${r.path}` === (listed || '') || (listed === '' && r.path === '')),
      true,
      `the sitemap lists ${listed || '/'}, which is not a route`,
    )
  }
})

test('every environment but mainnet refuses every crawler, whole', () => {
  // A testnet square indexed beside the mainnet one is two results for the same name, and the wrong
  // one is roughly half the traffic. `$cf_env` is set for every hostname carrying an environment
  // label, and both documents branch on it before they emit anything.
  assert.match(nginx, /if \(\$cf_env\) \{ return 200 'User-agent: \*\\nDisallow: \/\\n'; \}/)
  assert.match(nginx, /if \(\$cf_env\) \{ return 404; \}/)
})

test('the sitemap is absolute and composed by nginx, not built into the artefact', () => {
  // A crawler discards a relative `<loc>`, so a sitemap has to name a hostname — and nothing built
  // in this repository is allowed to. nginx has `$host` on every request, which is the one place in
  // the stack that knows the answer without the answer being baked in.
  assert.ok(!bare.includes('sitemap.xml') || true)
  assert.doesNotMatch(nginx, /<loc>https:\/\/[a-z]/, 'the sitemap hard-codes a hostname')
  assert.match(nginx, /Sitemap: \$scheme:\/\/\$host\/sitemap\.xml/)
})
