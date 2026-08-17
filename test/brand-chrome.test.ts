/**
 * The favicons, the card and the accent — held to micro-brand rather than to whatever was copied in.
 *
 * ── WHY THE BYTES, AND NOT THE FILENAMES ──────────────────────────────────────────────────────
 *
 * A frontend repository is the one place brand assets must never be GENERATED, and it is exactly
 * where they always end up being regenerated: somebody needs a 192px icon, the 512 is to hand, and
 * a resample lands in `public/` looking close enough. Six months later four surfaces carry four
 * slightly different marks and nobody can say which is the real one. Comparing bytes with
 * `../brand/assets/site/` makes the answer a fact rather than an opinion.
 *
 * When micro-brand is not checked out the comparison SKIPS rather than fails. A missing sibling is
 * a fact about the machine, not about this repository, and a test that goes red on a developer's
 * laptop for that reason is a test that gets deleted.
 *
 * ── AND THE ACCENT IS THE OTHER HALF ──────────────────────────────────────────────────────────
 *
 * `index.html` names `data-cf-product="agora"`, which selects an accent ramp from the design
 * system's `tokens.css`. Naming a product with NO block there does not error and does not warn — it
 * falls through to the company ember, in silence, and the surface simply looks like a different
 * product. `admin` had that defect and `explorer` still does.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ACCENT_SURFACE, PRODUCT } from '../src/lib/hosts.ts'
import { ROOT, SIBLINGS, read, readSibling, stripComments } from './sources.ts'

const html = read('index.html')
const bare = stripComments(html, 'html')
const BRAND_SITE = join(SIBLINGS, 'brand', 'assets', 'site')
const brandCheckedOut = existsSync(BRAND_SITE)

/** The chrome this surface serves, and the file in micro-brand each copy must equal. */
const CHROME = [
  'favicon-32x32.png',
  'favicon-192x192.png',
  'favicon-512x512.png',
  'og-1200x630.png',
] as const

test('EVERY PIECE OF CHROME IS BYTE-IDENTICAL TO micro-brand', { skip: !brandCheckedOut }, () => {
  for (const name of CHROME) {
    const ours = readFileSync(join(ROOT, 'public', name))
    const theirs = readFileSync(join(BRAND_SITE, name))
    assert.ok(
      ours.equals(theirs),
      `public/${name} differs from brand/assets/site/${name}. Brand assets are generated in ` +
        'micro-brand and copied; a resample made here is how four surfaces end up with four marks.',
    )
  }
})

test('THE COMPANY CARD IS BORROWED ON PURPOSE, AND A TEST WILL SAY WHEN TO STOP', () => {
  // micro-brand has no `agora` set. Something has to be borrowed, and every candidate except the
  // parent is ANOTHER PRODUCT'S mark — Forge Worlds' card on a Forge Agora link preview does not
  // read as "no card yet", it reads as Forge Worlds. The day micro-brand generates one, this fails
  // and tells somebody to come back here.
  const agoraSet = join(SIBLINGS, 'brand', 'assets', 'agora')
  if (!brandCheckedOut) return
  assert.ok(
    !existsSync(agoraSet),
    'brand/assets/agora/ now exists — this surface should carry its own mark, not the company one',
  )
  const plan = readSibling(join('brand', 'plan.ts'))
  if (plan !== null) {
    assert.ok(!/['"]agora['"]/.test(plan), "micro-brand's plan now has an agora entry")
  }
})

test('every icon the page references is actually served', () => {
  // A 404 on a favicon is invisible in development, where the browser has the previous one cached,
  // and shows up as a blank tab on everybody else's machine.
  const referenced = [...bare.matchAll(/href="\/([^"]+\.png)"/g)].map((m) => m[1] ?? '')
  assert.ok(referenced.length >= 4, `only ${referenced.length} icons were referenced`)
  for (const name of [...referenced, 'og-1200x630.png']) {
    assert.ok(existsSync(join(ROOT, 'public', name)), `index.html references /${name}, which is absent`)
  }
})

test('THE ACCENT THIS PAGE NAMES IS A REAL BLOCK IN tokens.css', () => {
  // The silent one. A product key with no block falls through to the company ember and the whole
  // surface quietly wears somebody else's colour.
  const tokens = readSibling(join('ui', 'packages', 'ui', 'src', 'tokens.css'))
  if (tokens === null) return
  assert.match(
    tokens,
    new RegExp(`\\[data-cf-product=['"]${ACCENT_SURFACE}['"]\\]`),
    `tokens.css has no [data-cf-product='${ACCENT_SURFACE}'] block; this page would wear the ember`,
  )
})

test('the html element names the product, the substrate and an automatic scheme', () => {
  // Set STATICALLY here rather than by React: a page that paints before the attributes land flashes
  // the default ember and then changes colour, which is worse than being the wrong colour.
  assert.match(bare, new RegExp(`data-cf-product="${ACCENT_SURFACE}"`))
  assert.equal(ACCENT_SURFACE, PRODUCT, 'the accent block and the registry key have diverged')
  assert.match(bare, /data-cf-substrate="warm"/)
  // `auto` follows the reader's system. It matters more here than on a reference page: this is a
  // surface somebody reads for twenty minutes, and a page of text that ignores dark mode at
  // midnight is a page they close.
  assert.match(bare, /data-cf-scheme="auto"/)
  assert.match(bare, /<html lang="en-GB"/)
})

test('color-scheme is spelled the way the standard spells it', () => {
  // Not a registered meta name under any other spelling, so a misspelling is INERT rather than
  // wrong. explorer-web shipped `colour-scheme` for months and drew light form controls on a dark
  // page the whole time — and the first thing on this surface's front page is a <textarea>.
  assert.match(bare, /<meta name="color-scheme" content="dark light" \/>/)
  assert.doesNotMatch(bare, /colour-scheme/)
})

test('EACH OPEN GRAPH PROPERTY IS DECLARED EXACTLY ONCE', () => {
  // foresight-web declares og:type, og:title and og:description twice. The second set silently wins
  // in every crawler and the first is dead text that somebody goes on editing.
  for (const property of ['og:type', 'og:title', 'og:description', 'og:image']) {
    const declarations = [...bare.matchAll(new RegExp(`property="${property}"`, 'g'))]
    assert.equal(declarations.length, 1, `${property} is declared ${declarations.length} times`)
  }
  for (const name of ['description', 'color-scheme', 'cf-release', 'cf-analytics', 'viewport']) {
    const declarations = [...bare.matchAll(new RegExp(`name="${name}"`, 'g'))]
    assert.equal(declarations.length, 1, `${name} is declared ${declarations.length} times`)
  }
})

test('the card image is a relative path, like every other address in this bundle', () => {
  // So it resolves against whichever origin served the page. An absolute one would make a preview
  // deployment's card point at production, which is the same class of mistake as a baked-in API.
  assert.match(bare, /property="og:image" content="\/og-1200x630\.png"/)
})

test('THERE IS NO ANALYTICS SCRIPT TAG, AND THE MEASUREMENT ID IS NOT ONE', () => {
  // The stock GA snippet fetches the tag and sets a cookie ON LOAD — before a banner has been drawn
  // let alone answered. Under ePrivacy Art. 5(3) that is a violation a banner underneath does not
  // cure. `@cloudsforge/ui/consent` injects the tag from exactly one place: the Accept button.
  assert.doesNotMatch(bare, /<script[^>]*src=["']https?:\/\//)
  assert.doesNotMatch(bare, /googletagmanager|google-analytics|gtag\(/)
  assert.match(bare, /<meta name="cf-analytics" content="G-[A-Z0-9]+" \/>/)
  // One module script, ours.
  const scripts = [...bare.matchAll(/<script/g)].length
  assert.equal(scripts, 1, `index.html carries ${scripts} script tags`)
})

test('the release is a meta tag with an honest default, and the Dockerfile rewrites that exact text', () => {
  // `lib/obs.ts` reads this to pin an error report to the deploy that introduced it. It is an
  // IDENTITY rather than a configuration — it names the artefact, it does not tell it where it runs.
  assert.match(bare, /<meta name="cf-release" content="dev" \/>/)
  const dockerfile = read('Dockerfile')
  // The stamping is a `sed` over this file, so the pattern it matches has to be in it — a rename
  // here that misses the Dockerfile leaves every production error report labelled `dev`, silently.
  const pattern = /sed -i "s\|name=\\"cf-release\\" content=\\"dev\\"\|/
  assert.match(dockerfile, pattern, 'the Dockerfile no longer rewrites the cf-release meta tag')
})
