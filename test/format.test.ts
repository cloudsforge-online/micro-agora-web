/**
 * The pure layer, and the one function in it that is a security boundary.
 *
 * `tokenize()` is the only place in this bundle where text somebody else wrote is turned into
 * something clickable, so most of this file is about it. The rest — `ago`, `count`, `initials`,
 * `excerpt`, `remaining` — is here because each encodes a decision that reads as arbitrary until it
 * is written down beside the case that made it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ago,
  at,
  count,
  countLabel,
  exact,
  excerpt,
  hash,
  hue,
  initials,
  prettyUrl,
  remaining,
  safeHref,
  tokenize,
  type Token,
} from '../src/lib/format.ts'

const NOW = Date.parse('2026-08-17T12:00:00.000Z')
const minutesAgo = (n: number): string => new Date(NOW - n * 60_000).toISOString()

/* ---- the tokenizer -------------------------------------------------- */

test('A REFUSED SCHEME BECOMES TEXT, AND NEVER A LINK', () => {
  // The attack this surface has that a price page does not. `javascript:` never even reaches
  // `safeHref` — the pattern only matches `http(s)://` — so the characters an author typed are
  // shown as characters, which is both safe and honest.
  for (const hostile of [
    'javascript:alert(1)',
    'JaVaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    const tokens = tokenize(`look ${hostile}`)
    assert.equal(
      tokens.some((t) => t.kind === 'link'),
      false,
      `${hostile} produced a link token`,
    )
    // And nothing was deleted: silently dropping what somebody wrote is worse than showing it,
    // because the reader cannot then see what was posted and decide for themselves.
    assert.equal(
      tokens.map((t) => (t.kind === 'text' ? t.value : '')).join(''),
      `look ${hostile}`,
    )
  }
})

test('a well-formed http(s) URL that will not parse stays text too', () => {
  // `https://.` trims to `https://`, which `new URL()` refuses. The token falls back to TEXT rather
  // than to a link with an empty href, which would be a control that does nothing when clicked.
  const tokens = tokenize('see https://. for details')
  assert.equal(
    tokens.some((t) => t.kind === 'link'),
    false,
  )
})

test('safeHref parses rather than prefix-matches, which is the whole difference', () => {
  // Every one of these defeats `startsWith('javascript:')`. `new URL()` strips the tab and lowercases
  // the scheme before the comparison, so all three are refused by the same single check.
  assert.equal(safeHref('java\tscript:alert(1)'), null)
  assert.equal(safeHref('java\nscript:alert(1)'), null)
  assert.equal(safeHref(' javascript:alert(1)'), null)
  assert.equal(safeHref('JAVASCRIPT:alert(1)'), null)
  assert.equal(safeHref('not a url at all'), null)
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x')
  assert.equal(safeHref('http://example.com/x'), 'http://example.com/x')
})

test('trailing sentence punctuation is not part of the address', () => {
  // A link at the end of a sentence is followed by a full stop the author meant as a full stop, and
  // `…/x.` is a different address from `…/x` — one that generally 404s.
  assert.equal(safeHref('https://example.com/x.'), 'https://example.com/x')
  assert.equal(safeHref('https://example.com/x),'), 'https://example.com/x')
  assert.equal(safeHref('https://example.com/x?a=1!'), 'https://example.com/x?a=1')
  // But punctuation INSIDE the path is left alone — a trailing-only trim, not a strip.
  assert.equal(safeHref('https://example.com/a.b/c'), 'https://example.com/a.b/c')
})

test('a post breaks into the pieces the renderer draws, in order', () => {
  const tokens = tokenize('hey @nefeli look at #mining https://example.com/x nice')
  assert.deepEqual(tokens as Token[], [
    { kind: 'text', value: 'hey ' },
    { kind: 'mention', handle: 'nefeli' },
    { kind: 'text', value: ' look at ' },
    { kind: 'tag', tag: 'mining' },
    { kind: 'text', value: ' ' },
    { kind: 'link', href: 'https://example.com/x', label: 'example.com/x' },
    { kind: 'text', value: ' nice' },
  ])
})

test('an @ inside a word is not a mention, which is what stops every email address', () => {
  // The lookbehind is the reason. Without it every address in every post becomes a link to a
  // profile that does not exist — a false positive, which is the expensive direction of miss here.
  assert.deepEqual(tokenize('write to ops@cloudsforge.online') as Token[], [
    { kind: 'text', value: 'write to ops@cloudsforge.online' },
  ])
  assert.deepEqual(tokenize('a#b') as Token[], [{ kind: 'text', value: 'a#b' }])
})

test('a mention at the very start of a post is still a mention', () => {
  // The `^` half of the alternation. A reply almost always begins with the handle it answers, so
  // this is not an edge case — it is the commonest post on the surface.
  assert.deepEqual(tokenize('@nefeli yes') as Token[], [
    { kind: 'mention', handle: 'nefeli' },
    { kind: 'text', value: ' yes' },
  ])
  assert.deepEqual(tokenize('#mining') as Token[], [{ kind: 'tag', tag: 'mining' }])
})

test('the patterns match what the service will accept, and nothing wider', () => {
  // A handle is 2–32 of `[A-Za-z0-9_]`, which is micro-agora's rule. One character short and it is
  // a word; one character over and it is a word. Both stay text rather than becoming a dead link.
  assert.equal(tokenize('@a').some((t) => t.kind === 'mention'), false)
  assert.equal(tokenize('@ab').some((t) => t.kind === 'mention'), true)
  assert.equal(tokenize(`@${'a'.repeat(32)}`).some((t) => t.kind === 'mention'), true)
  // 33 characters: the first 32 match and the leftover is text, which is the honest outcome — the
  // pattern cannot know whether the author meant a longer handle or a handle then a word.
  const long = tokenize(`@${'a'.repeat(33)}`)
  assert.equal(long.filter((t) => t.kind === 'mention').length, 1)
  assert.equal(tokenize('@néfeli').some((t) => t.kind === 'mention'), false)
})

test('a post that is only text produces exactly one token', () => {
  assert.deepEqual(tokenize('nothing special here') as Token[], [
    { kind: 'text', value: 'nothing special here' },
  ])
  assert.deepEqual(tokenize('') as Token[], [])
})

test('markup in a post body is text, because this function never produces markup', () => {
  // The claim the whole boundary rests on: `tokenize` returns DATA. There is no branch in it that
  // can emit HTML, so `<script>` is five characters that a React text node escapes.
  const body = '<script>alert(1)</script> & <img src=x onerror=alert(1)>'
  assert.deepEqual(tokenize(body) as Token[], [{ kind: 'text', value: body }])
})

test('a link is shown by its host, and truncated rather than allowed to fill a line', () => {
  assert.equal(prettyUrl('https://www.example.com/'), 'example.com')
  assert.equal(prettyUrl('https://example.com/a/b'), 'example.com/a/b')
  const long = prettyUrl(`https://example.com/${'x'.repeat(200)}`)
  assert.equal(long.length, 42)
  assert.ok(long.endsWith('…'))
  // The HOST survives truncation, which is the point — it is the part that tells a reader whether
  // they want to click, and the part a phishing attempt most wants to bury behind a long path.
  assert.ok(long.startsWith('example.com/'))
})

/* ---- time ----------------------------------------------------------- */

test('a clock that is behind the server never says a post arrives in the future', () => {
  // Every browser's clock is a little wrong, and the server stamps the post. Without the floor at
  // "now" a reader whose laptop is thirty seconds slow sees "in 30s" on their own post.
  assert.equal(ago(new Date(NOW + 30_000).toISOString(), NOW), 'now')
  assert.equal(ago(minutesAgo(0.5), NOW), 'now')
})

test('the relative form stops at a week and becomes a date', () => {
  assert.equal(ago(minutesAgo(5), NOW), '5m')
  assert.equal(ago(minutesAgo(150), NOW), '2h')
  assert.equal(ago(minutesAgo(60 * 25), NOW), '1d')
  assert.equal(ago(minutesAgo(60 * 24 * 6), NOW), '6d')
  // "43d" is not a unit anybody converts in their head. Past a week the actual date is the more
  // useful fact, which is the opposite of the usual instinct to keep counting.
  assert.match(ago(minutesAgo(60 * 24 * 43), NOW), /^\d+ \w+$/)
})

test('an unparseable timestamp renders as nothing, not as NaN', () => {
  assert.equal(ago('not a date', NOW), '')
  assert.equal(exact('not a date'), '')
  assert.ok(exact('2026-08-17T12:00:00.000Z').length > 0)
})

/* ---- numbers -------------------------------------------------------- */

test('a count is compact only where the compact form loses nothing anybody wanted', () => {
  assert.equal(count(0), '')
  assert.equal(count(-3), '')
  assert.equal(count(1), '1')
  // 999 rather than "1k" — a threshold at a hundred would trade a real number for a rounded one to
  // save two characters.
  assert.equal(count(999), '999')
  assert.equal(count(1000), '1k')
  assert.equal(count(1200), '1.2k')
  assert.equal(count(12_400), '12k')
  assert.equal(count(1_500_000), '1.5m')
  assert.equal(count(Number.NaN), '')
  assert.equal(count(Number.POSITIVE_INFINITY), '')
})

test('the accessible name says the number in full and agrees on plurality', () => {
  // The visible "1.2k" is a design decision; a screen reader reading "one point two k sparks" is
  // not. The label is the full number, and it is the one a control is actually named by.
  assert.equal(countLabel(1, 'spark', 'sparks'), '1 spark')
  assert.equal(countLabel(0, 'spark', 'sparks'), '0 sparks')
  assert.equal(countLabel(1204, 'spark', 'sparks'), '1,204 sparks')
})

/* ---- names ---------------------------------------------------------- */

test('the punctuation is added, never doubled', () => {
  assert.equal(at('nefeli'), '@nefeli')
  assert.equal(at('@nefeli'), '@nefeli')
  assert.equal(hash('mining'), '#mining')
  assert.equal(hash('#mining'), '#mining')
})

test('an avatar always has something in it', () => {
  assert.equal(initials('Nefeli Papadopoulou', 'nefeli'), 'NP')
  assert.equal(initials('Nefeli', 'nefeli'), 'N')
  // Falls back to the handle, then to `?`. Never to an empty circle, which reads as a broken image
  // rather than as a person who has not uploaded a picture.
  assert.equal(initials('', 'nefeli'), 'N')
  assert.equal(initials('   ', '  '), '?')
})

test('the fallback colour is stable per handle, which is the only property it needs', () => {
  // It does not need to be a good hash. It needs to be the same colour for one person on every page
  // and in every session, or two rows of avatars are two different sets of people.
  assert.equal(hue('nefeli'), hue('nefeli'))
  assert.notEqual(hue('nefeli'), hue('kostas'))
  for (const handle of ['a', 'nefeli', 'x'.repeat(64), '']) {
    const h = hue(handle)
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360, `${handle} produced ${h}`)
  }
})

/* ---- misc ----------------------------------------------------------- */

test('an excerpt breaks on a word, and only claims there is more when there is', () => {
  assert.equal(excerpt('short', 40), 'short')
  // No ellipsis on a complete string: "…" after a finished sentence tells the reader there is more
  // to read when there is not, which is the one thing a preview must not do.
  assert.ok(!excerpt('short', 40).endsWith('…'))
  assert.equal(excerpt('one two three four five', 14), 'one two three…')
  // …but only while the break is not too expensive. Cutting back to the last space at 12 would
  // throw away a third of the preview to avoid a broken word, so the broken word wins — which is
  // what the `max * 0.6` floor decides, and it is the reason it is not simply "break on a space".
  assert.equal(excerpt('one two three four five', 12), 'one two thre…')
  // A single word longer than the limit has no space to break on and is cut mid-word rather than
  // returned whole, because returning it whole is how a preview breaks a layout.
  assert.equal(excerpt('a'.repeat(50), 10), `${'a'.repeat(10)}…`)
  assert.equal(excerpt('  line one\n\nline two  ', 100), 'line one line two')
})

test('THE COUNTER MEASURES WHAT THE SERVICE MEASURES, NOT WHAT WOULD BE KINDER', () => {
  // micro-agora checks `body.length > postMaxChars` — UTF-16 units. Counting code points here would
  // be the humane measure and the wrong one: a counter kinder than the server lets somebody write
  // to what it calls the end of their allowance, press Post, and be refused with room on screen.
  assert.equal(remaining('abc', 500), 497)
  assert.equal(remaining('👋', 500), 498, 'an emoji is two units, and the service counts two')
  // The trim mirrors `normaliseBody`: trailing newlines are stripped before the service measures,
  // so they must not be spent out of the reader's allowance here either.
  assert.equal(remaining('  abc\n\n', 500), 497)
  assert.equal(remaining('a​‍b', 500), 498, 'zero-width characters are stripped first')
  // It goes negative rather than clamping: the composer needs to show how far over somebody is.
  assert.equal(remaining('a'.repeat(10), 5), -5)
})
