/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * AN UNDEFINED CUSTOM PROPERTY DOES NOT FALL BACK. IT DELETES THE DECLARATION.
 *
 * `border: 1px solid var(--cf-does-not-exist)` is invalid at computed-value time, so the whole
 * declaration is discarded and the element inherits or takes its initial value. The border does not
 * become a default border; it disappears. The stylesheet still parses, nothing warns, and the file
 * reviews as correct.
 *
 * The estate has shipped exactly this. `micro-mint-web/src/styles.css` names ten properties that do
 * not exist — `--cf-border`, `--cf-radius-md`, `--cf-space-1` through `--cf-space-5` and
 * `--cf-status-good`/`-warn`/`-crit` — across seventy-two declarations, every one of them inert.
 *
 * A CLASS behaves the same way and is the easier mistake, because a class name is a plausible guess:
 * `cf-card` reads exactly like something a design system would have. When it does not exist the
 * element is simply unstyled, which looks like a layout bug rather than a typo.
 *
 * Both are checked against the design system's own stylesheets, read through the `link:` that
 * package.json already declares — so these assertions run against the bytes the bundle will import,
 * not against a published copy that may be behind them.
 *
 * This file is 2,900 lines of CSS on a surface where nothing else is: no component library of our
 * own, no CSS-in-JS, no build step that would object. It is the single largest untypechecked
 * artefact in the repository, which is why it gets the most tests.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ROOT, read, sourceFiles, stripComments } from './sources.ts'

const UI_CSS_DIR = join(ROOT, 'node_modules/@cloudsforge/ui/src')
const TOKENS_CSS = readFileSync(join(UI_CSS_DIR, 'tokens.css'), 'utf8')
const UI_CSS = readFileSync(join(UI_CSS_DIR, 'ui.css'), 'utf8')
const UPSTREAM = `${TOKENS_CSS}\n${UI_CSS}`

const STYLES = stripComments(read('src/styles.css'), 'css')

/** Every `--cf-*` the design system DECLARES (`--cf-x:`), as opposed to merely mentioning. */
const DECLARED = new Set([...UPSTREAM.matchAll(/(--cf-[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string))

/** Every `cf-*` class the design system defines a rule for. */
const UPSTREAM_CLASSES = new Set(
  [...UPSTREAM.matchAll(/\.(cf-[a-z0-9_-]+)/g)].map((m) => m[1] as string),
)

/** Every class this repository defines for itself. All are `ag-` prefixed; see the test below. */
const LOCAL_CLASSES = new Set(
  [...STYLES.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((m) => m[1] as string),
)

/**
 * Every class name written into a `className` in src/, from all three shapes it is written in.
 *
 * THE THREE PASSES ARE NOT REDUNDANT. Each exists because of a class that would otherwise go
 * unchecked — which on this file means a class that renders unstyled and is never reported:
 *
 *   1. `className="a b"`. The common case.
 *   2. Every TEMPLATE LITERAL in the file, wherever it sits. `className={`…`}` alone would miss the
 *      one on `NavLink`, whose className is a FUNCTION of `isActive` — `ag-nav__item` lives inside a
 *      template literal inside an arrow function, which no `className={` anchor reaches. Non-class
 *      literals are harmless: their words do not begin with a known prefix.
 *   3. Quoted strings that are entirely class names. A `${…}` is dropped by pass 2, and a whole
 *      class chosen at runtime lives in its ternary ARMS — `' ag-post--connected'`. The leading
 *      space matters: an arm is concatenated onto a base class, so it is written with one, and a
 *      pattern anchored tight to the quote silently matches nothing.
 */
function classNamesUsed(): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = []
  const PREFIXED = /^(?:cf|ag)-[a-z0-9_-]+$/
  const push = (path: string, raw: string): void => {
    for (const name of raw.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (name) out.push({ path, name })
    }
  }
  for (const { path, text: raw } of sourceFiles(['.tsx'])) {
    const text = stripComments(raw, 'ts')
    for (const match of text.matchAll(/className="([^"]*)"/g)) {
      push(path, match[1] as string)
    }
    for (const match of text.matchAll(/`([^`]*)`/g)) {
      // An ELEMENT ID takes the same prefix as a class — `ag-search-input`, `ag-set-${label}` —
      // because both namespaces belong to this bundle and both would collide with the estate's
      // otherwise. So a literal that is being assigned to an id, a label's `htmlFor`, an href or a
      // route is skipped: it is not a class list and no rule should exist for it.
      const before = text.slice(Math.max(0, match.index - 32), match.index)
      if (/\b(id|htmlFor|href|to|key|labelledby|controls|describedby)\s*[=:]\s*$/i.test(before)) {
        continue
      }
      for (const word of (match[1] as string).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (PREFIXED.test(word)) out.push({ path, name: word })
      }
    }
    for (const match of text.matchAll(/'((?:\s*(?:cf|ag)-[a-z0-9_-]+)+\s*)'/g)) {
      push(path, match[1] as string)
    }
  }
  return out
}

const USED = classNamesUsed()

test('EVERY --cf-* THIS STYLESHEET READS IS DECLARED BY THE DESIGN SYSTEM', () => {
  const referenced = new Set(
    [...STYLES.matchAll(/var\(\s*(--cf-[a-z0-9-]+)/g)].map((m) => m[1] as string),
  )
  for (const name of [...referenced].sort()) {
    assert.ok(
      DECLARED.has(name),
      `src/styles.css reads var(${name}), which @cloudsforge/ui does not declare. Every ` +
        `declaration using it is silently discarded — the property does not fall back, the rule is ` +
        `deleted. The names that exist: --cf-line/--cf-line-strong for borders, ` +
        `--cf-radius-sm/--cf-radius/--cf-radius-lg for radii, --cf-space-3xs…--cf-space-3xl for ` +
        `spacing, --cf-font-sans/-mono/-display for type.`,
    )
  }
  // A stylesheet that read no tokens at all would pass the loop above trivially. This one reads
  // most of the ramp.
  assert.ok(referenced.size > 25, `only ${referenced.size} tokens referenced; suspiciously few`)
})

test('THERE IS NO var(--token, #fallback) ANYWHERE', () => {
  // A fallback is a hard-coded colour wearing a token's clothes. It stops following the substrate
  // the moment somebody switches the ash ramp and — worse — it makes a MISSING token invisible,
  // because the declaration then renders instead of disappearing. That defeats the test above.
  const withFallback = [...STYLES.matchAll(/var\(\s*--cf-[a-z0-9-]+\s*,[^)]*\)/g)].map((m) => m[0])
  assert.deepEqual(withFallback, [])
})

test('THE LETTER AVATAR IS THE ONLY COMPUTED COLOUR, AND IT IS DOCUMENTED AS ONE', () => {
  // Everything else comes from the ramps, so the page follows data-cf-product, data-cf-substrate
  // and the reader's own light/dark preference.
  //
  // The exception is real and cannot be a token: an avatar's hue is derived from the handle at
  // runtime — `hue()` in lib/format.ts — so there are as many of them as there are people, and a
  // design system cannot enumerate that. It is written as a 22%-opacity wash of a fully saturated
  // hue over whatever the substrate is, which is why it needs no dark-scheme branch: the same
  // declaration reads as a tint on parchment and as a stain on ash.
  const literals = [...STYLES.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)].map((m) => m[0])
  assert.deepEqual(
    literals,
    ['hsl('],
    `src/styles.css names a colour directly. Colours come from the ramps; the single exception is ` +
      `the letter avatar's hsl(var(--ag-avatar-hue) …), and it is argued for in the stylesheet's ` +
      `header.`,
  )
  assert.match(STYLES, /\.ag-avatar--letters\s*\{[^}]*hsl\(var\(--ag-avatar-hue\)/)
})

test('MARK STEP AND TEXT STEP ARE DIFFERENT TOKENS, AND TYPE TAKES THE TEXT STEP', () => {
  // `--cf-accent` and `--cf-warn` are validated at 3:1, the floor for a border, a fill or a stroke.
  // `--cf-accent-text` and `--cf-warn-text` are the 4.5:1 step for type. Using the mark step for
  // `color:` ships text that fails WCAG AA while looking deliberate.
  for (const match of STYLES.matchAll(/(^|[;{\s])color:\s*var\(\s*(--cf-[a-z0-9-]+)\s*\)/gm)) {
    const token = match[2] as string
    assert.ok(
      !/^--cf-(accent|warn|good|critical)$/.test(token),
      `src/styles.css sets color: var(${token}), the 3:1 mark step. Type takes ${token}-text.`,
    )
  }
})

test('EVERY cf- CLASS THIS APP USES EXISTS UPSTREAM', () => {
  // Checked first, because every assertion below is vacuous if the extraction found nothing — and a
  // regex over source text is exactly the kind of check that silently stops matching.
  //
  // The canary is a NAMED class rather than a count. This surface borrows almost nothing from the
  // design system's class layer: what upstream exports mostly styles components upstream also
  // RENDERS — the bar, the footer, the menu, the mining control — and this bundle mounts those as
  // components, not as class names. `cf-num` is the one it writes by hand, on every figure: a reply
  // count, a member count, a character counter.
  const distinct = new Set(USED.filter((u) => u.name.startsWith('cf-')).map((u) => u.name))
  assert.ok(
    distinct.has('cf-num'),
    `the extraction found no cf-num. Every figure on this surface carries it, so finding none means ` +
      `the regex above has stopped matching and every assertion below is passing on an empty list.`,
  )

  for (const { path, name } of USED) {
    if (!name.startsWith('cf-')) continue
    assert.ok(
      UPSTREAM_CLASSES.has(name),
      `${path} uses the class "${name}", which @cloudsforge/ui does not define. The element is ` +
        `simply unstyled, which reads as a layout bug rather than as a typo. Either it is a ` +
        `misremembered name or it belongs in src/styles.css under the ag- prefix.`,
    )
  }
})

test('every local class is ag- prefixed, and every ag- class this app uses is defined here', () => {
  // The prefix is what keeps the two namespaces from silently merging. A local class called
  // `cf-panel` would work today and break the day the design system defines one, in a way that
  // reads as a design-system regression rather than as a collision in this repository.
  //
  // `is-*` is the one exception and it is a deliberate one: a STATE is not a component, it is an
  // adjective applied to one — `.ag-notif.is-unread`, `.ag-tab.is-on`. Prefixing it would give
  // `.ag-notif.ag-is-unread`, which reads as a second component. The safety condition is the test
  // below: a state class is never a selector on its own, so it can never style anything it does
  // not qualify.
  for (const name of LOCAL_CLASSES) {
    assert.ok(
      name.startsWith('ag-') || name.startsWith('cf-') || name.startsWith('is-'),
      `src/styles.css defines ".${name}"; local classes take the ag- prefix so they cannot collide ` +
        `with the design system`,
    )
  }
  // Both directions. The second is the one that catches a renamed class: a rule left behind in the
  // stylesheet is dead weight, but a class NAMED in a component with no rule for it renders as an
  // unstyled element — which reads as a layout bug rather than as a typo.
  const local = USED.filter((u) => u.name.startsWith('ag-'))
  assert.ok(local.length >= 150, `only ${local.length} local classes found; the extraction has broken`)
  for (const { path, name } of local) {
    // A name ending in `-` is the stub left by a class ASSEMBLED from a variable —
    // `ag-avatar--${size}`. No text scan can resolve it, so what is checked is that the family
    // exists at all; the members it can take are checked against the component's own union in the
    // test below. Without this branch the assertion would fail on correct code, which is how a
    // suite gets a `// eslint-disable`-shaped hole punched in it.
    if (name.endsWith('-')) {
      assert.ok(
        [...LOCAL_CLASSES].some((known) => known.startsWith(name) && known !== name),
        `${path} builds a class name beginning "${name}" and src/styles.css defines no member of ` +
          `that family`,
      )
      continue
    }
    assert.ok(
      LOCAL_CLASSES.has(name),
      `${path} uses "${name}" and src/styles.css defines no rule for it`,
    )
  }
})

test('EVERY SIZE THE AVATAR TYPE ALLOWS HAS A RULE', () => {
  // The one class in this bundle assembled from a variable, so the one the scan above cannot
  // resolve. The union and the stylesheet are two lists that have to agree: adding `'xl'` to the
  // type and forgetting the rule produces an avatar with no dimensions, on every row, in a layout
  // that reserves space for one.
  const avatar = stripComments(read('src/components/post.tsx'), 'ts')
  const union = avatar.slice(avatar.indexOf('size?:'), avatar.indexOf('\n}', avatar.indexOf('size?:')))
  const sizes = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1] as string)
  assert.deepEqual(sizes, ['sm', 'md', 'lg'])
  for (const size of sizes) {
    assert.ok(
      LOCAL_CLASSES.has(`ag-avatar--${size}`),
      `AvatarProps allows size="${size}" and src/styles.css has no .ag-avatar--${size}`,
    )
  }
})

test('A STATE CLASS NEVER STANDS ALONE', () => {
  // `.is-open { display: block }` on its own is a rule that reaches every element on the page
  // carrying that word — including one in a component the design system renders, which this
  // bundle does not own. Every state class must be compounded onto the ag- class it qualifies.
  const bare: string[] = []
  for (const match of STYLES.matchAll(/([^{}]+)\{/g)) {
    const selector = (match[1] as string).trim().replace(/\s+/g, ' ')
    if (selector.startsWith('@')) continue
    for (const part of selector.split(/[,\s>+~]+/)) {
      if (/^\.is-/.test(part)) bare.push(selector)
    }
  }
  assert.deepEqual(bare, [], `a state class is used as a selector on its own`)
})

test('this stylesheet does not restyle the design system out from under itself', () => {
  // A `.cf-btn { … }` here would change that component on this surface only, which is how an estate
  // ends up with the same control looking different on six frontends. Local rules may only COMPOSE
  // — an ag- class beside a cf- one — never override.
  const overrides = [...STYLES.matchAll(/^\s*(\.cf-[a-z0-9_-]+[^{]*)\{/gm)].map((m) =>
    (m[1] as string).trim(),
  )
  assert.deepEqual(
    overrides,
    [],
    `src/styles.css writes a rule for a design-system class. Compose with an ag- class instead.`,
  )
})

test('the body actually consumes the tokens it is delivered', () => {
  // tokens.css resolves --cf-bg on :root, but if nothing here ever READS it the document falls all
  // the way through to the UA stylesheet: transparent background, Times, an 8px margin. That defect
  // is invisible to curl (still a 200) and invisible to a happy-dom test (no stylesheet is loaded
  // and nothing cascades), and glaring to the first person who opens the page in a browser.
  const body = STYLES.slice(STYLES.indexOf('body {'))
  assert.match(body, /background:\s*var\(--cf-bg\)/)
  assert.match(body, /color:\s*var\(--cf-fg\)/)
  assert.match(body, /font-family:\s*var\(--cf-font-sans\)/)
  // `color-scheme` is deliberately NOT declared on body: it is inherited, index.html sets
  // data-cf-scheme="auto", and a declaration here would beat the inherited one for the whole page
  // and leave a reader on a light system with dark native controls — the composer's textarea among
  // them, which is the first thing they touch.
  assert.doesNotMatch(body, /color-scheme/)
})

test('THE PRODUCT KEY THIS SURFACE SETS HAS A REAL BLOCK UPSTREAM', () => {
  // Naming a product with no block in tokens.css falls through to the company ember in complete
  // silence: the page renders, it is simply the wrong colour, and nobody who has not seen the
  // orchid knows what it should have been. tokens.css calls that out by name — "a silent
  // fallthrough is a latent bug, so every key an app may set is declared" — and `admin` had the
  // defect while `explorer` still does.
  assert.match(TOKENS_CSS, /\[data-cf-product=['"]agora['"]\]/)
  assert.match(read('index.html'), /data-cf-product="agora"/)
})

test('THE SIGNATURE IS ONE DEVICE, AND THESE ARE THE FOUR PLACES IT IS DRAWN', () => {
  // --ag-mark is the whole visual identity of this surface: a 2px rule, vertical wherever a run of
  // text is a person's voice, and once horizontally where the page addresses the reader. It is
  // enumerated rather than merely bounded, because "used sparingly" is a rule nobody can be caught
  // breaking — every individual addition is defensible and the twentieth one has turned the
  // signature into a border style. A fifth use has to be argued for HERE, in front of the list.
  const rules = [...STYLES.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
    (m[2] as string).includes('var(--ag-mark)'),
  )
  const selectors = rules.map((m) => (m[1] as string).trim().replace(/\s+/g, ' ')).sort()
  assert.deepEqual(
    selectors,
    [
      // this voice continues
      '.ag-post__thread-line',
      // somebody spoke to this reader and has not been answered
      '.ag-notif.is-unread',
      // the reporter's own words, quoted
      '.ag-report__detail',
      // the page addressing the reader
      '.ag-page-title::before',
    ].sort(),
    `--ag-mark is drawn somewhere new. It is the one signature device on this surface; see the ` +
      `argument at the top of src/styles.css before adding to this list.`,
  )
  // And it is 2px. A signature that is 2px in one place and 3px in another is not a signature.
  assert.match(STYLES, /--ag-mark:\s*2px;/)
})

test('THE COMPOSER SITS EXACTLY WHERE THE POST IT BECOMES WILL SIT', () => {
  // A draft that jumps sideways the moment it is posted is the cheapest possible way to make a
  // surface feel unfinished, and it happens whenever the composer and the post row are laid out by
  // two grids that were "kept in step" by hand. They are the same declaration, byte for byte, and
  // this test is what keeps them that way.
  // NOT a /g regex: assert.match calls RegExp.test, which advances lastIndex on a global pattern,
  // so the second assertion below would start searching from where the first one stopped and fail
  // on a file that is correct.
  const grid = /grid-template-columns:\s*var\(--ag-gutter\)\s+minmax\(0,\s*1fr\);/
  const hits = [...STYLES.matchAll(/grid-template-columns:\s*var\(--ag-gutter\)\s+minmax\(0,\s*1fr\);/g)]
  assert.ok(
    hits.length >= 2,
    `.ag-post and .ag-composer must share one grid-template-columns; found ${hits.length} copies ` +
      `of it. If the composer's gutter and the post's gutter drift apart, a draft moves sideways ` +
      `the instant it is sent.`,
  )
  for (const cls of ['.ag-post {', '.ag-composer {']) {
    const rule = STYLES.slice(STYLES.indexOf(cls), STYLES.indexOf('}', STYLES.indexOf(cls)))
    assert.match(rule, grid, `${cls} does not carry the shared gutter grid`)
  }
})

test('POSTS HAVE NO CARD, AND THE ROOM IS THE REASON', () => {
  // Stated as a rule because it is the one direction decision the whole layout rests on: a timeline
  // of cards reads as a feed of content items, and this is meant to read as a room where people are
  // talking. The separator between two posts is a hairline, and when the same person keeps speaking
  // there is not even that. If `.ag-post` ever grows a background, a radius and a shadow, this
  // surface has quietly become every other social product.
  const rule = STYLES.slice(STYLES.indexOf('.ag-post {'), STYLES.indexOf('}', STYLES.indexOf('.ag-post {')))
  assert.doesNotMatch(rule, /box-shadow/)
  assert.doesNotMatch(rule, /border-radius/)
  assert.doesNotMatch(rule, /background:\s*var\(--cf-(surface|raised)/)
})
