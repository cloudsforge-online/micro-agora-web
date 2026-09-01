/**
 * Turning data into words, and one tokenizer that decides what a post is allowed to become.
 *
 * Every function here is pure and imports nothing, so `test/format.test.ts` can prove each one
 * without a browser. That matters most for {@link tokenize}, which is the only place in this bundle
 * where somebody else's text is turned into something clickable.
 */

/* ---- time ----------------------------------------------------------- */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The three-letter month names, written out rather than asked of the runtime.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **`month: 'short'` IS NOT THREE LETTERS IN en-GB, AND THE MONTH IT IS NOT IS SEPTEMBER.**
 *
 * `new Date('2026-09-01').toLocaleDateString('en-GB', { month: 'short' })` is `Sept`. Every other
 * month is three characters; September is four. That is CLDR's en-GB data rather than a bug in any
 * runtime, and it means {@link ago} silently changes width for the thirty days of September in a
 * timeline where every other entry is `5m`, `2h` or `6d` — short, aligned, and scanned rather than
 * read.
 *
 * It shipped because it cannot be found by reading: eleven months out of twelve agree with the
 * intent. `hub-web` hit it first, on 2026-08-31, when a suite that built its expectation from a
 * date thirty days out finally landed in September; this bundle's own case was `/^\d+ \w+$/`,
 * which `Sept` satisfies perfectly.
 *
 * The fix is not a different locale. `en-US` happens to give `Sep` today, which would make the
 * format depend on the CLDR revision the runtime was built with and on whether it is a full-icu
 * build at all — a small-icu Node falls back to `en-US` whatever is asked for, so the same bundle
 * would render two different strings on two hosts. A literal table is the same twelve answers
 * everywhere, for ever.
 *
 * {@link exact} keeps `month: 'long'` deliberately: it is prose in a tooltip rather than a column,
 * `17 September 2026` is what a reader expects there, and no width depends on it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/**
 * How long ago, in the shortest honest form.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the function is testable and so a list
 * of fifty posts computes it once instead of fifty times.
 *
 * It stops being relative after a week and becomes a date. "43d" is not a unit anybody converts in
 * their head, and past a certain distance the actual date is the more useful fact — which is the
 * opposite of the usual instinct to keep counting.
 */
export function ago(iso: string, now: number): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const delta = now - then
  // A clock that is a little behind the server's must not produce "in 3 seconds".
  if (delta < MINUTE) return 'now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`
  const at = new Date(then)
  return `${at.getDate()} ${SHORT_MONTHS[at.getMonth()]}`
}

/**
 * The full timestamp, for the `title` and `dateTime` of a `<time>` element.
 *
 * The relative form above is the readable one and the exact one is always one hover or one screen
 * reader away. A timeline that shows only "2h" and nothing else is a timeline where nobody can tell
 * whether a conversation happened this afternoon or last Tuesday.
 */
export function exact(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  return new Date(then).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/* ---- numbers -------------------------------------------------------- */

/**
 * A count beside a button.
 *
 * Compact above a thousand, and the threshold is high on purpose: "1.2k" where "1,204" would fit is
 * a loss of information for the sake of a look. Zero renders as an empty string — a row of buttons
 * each labelled 0 is noise, and the absence says the same thing.
 */
export function count(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.floor(k)}k`
  }
  const m = n / 1_000_000
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.floor(m)}m`
}

/** The same number, said in full, for the accessible name of the control it sits on. */
export function countLabel(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
}

/* ---- names ---------------------------------------------------------- */

/** A handle, always with its `@`. The `@` is punctuation and is never part of the stored value. */
export const at = (handle: string): string => `@${handle.replace(/^@/, '')}`

/** A tag, always with its `#`, same reasoning. */
export const hash = (tag: string): string => `#${tag.replace(/^#/, '')}`

/**
 * The two initials an avatar falls back to.
 *
 * Falls back to the handle when the display name is empty, and to `?` when both are — never to an
 * empty circle, which reads as a broken image rather than as a person without a picture.
 */
export function initials(displayName: string, handle: string): string {
  const source = displayName.trim() || handle.trim()
  if (!source) return '?'
  const words = source.split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? ''
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + second).toUpperCase() || '?'
}

/**
 * A colour for that fallback, derived from the handle.
 *
 * A hue rather than a token, because the whole point is that two people beside each other look
 * different; every other property comes from the accent ramp so it still reads as this surface. The
 * hash is trivial and does not need to be good — it needs to be STABLE, so one person is the same
 * colour on every page and in every session.
 */
export function hue(handle: string): number {
  let h = 0
  for (let i = 0; i < handle.length; i += 1) h = (h * 31 + handle.charCodeAt(i)) % 360
  return h
}

/* ---- the tokenizer -------------------------------------------------- */

export type Token =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; handle: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'link'; href: string; label: string }

/**
 * Break a post body into the pieces that get rendered.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS THE SECURITY BOUNDARY OF THE WHOLE SURFACE, AND IT IS A BOUNDARY BY BEING A TOKENIZER.
 *
 * A post is text somebody else wrote, shown to everybody. The entire class of attack this surface
 * has that a price page does not is: what if the text is not text. The defence is not sanitisation
 * — it is that NOTHING HERE EVER PRODUCES HTML. This function returns data; `components/post.tsx`
 * renders each token as a React element, and React escapes every string it puts in a text node. So
 * `<script>` in a post body is five characters that appear on the screen, because there is no path
 * from this data to `innerHTML`. There is no `dangerouslySetInnerHTML` anywhere in this repository
 * and `test/no-dangerous-html.test.ts` greps `src/` to keep it that way.
 *
 * ── THE SCHEME CHECK IS THE OTHER HALF ────────────────────────────────────────────────────────
 *
 * Escaping stops `<script>`. It does NOT stop `javascript:alert(1)` in an `href`, because that is
 * not markup — it is a perfectly well-formed attribute value that React will happily pass through,
 * and clicking it runs script in this origin with the reader's session in localStorage. So a link
 * token is only ever produced for `http:` and `https:`, checked by PARSING the URL rather than by
 * matching a prefix: `java\tscript:` and `JaVaScript:` both defeat a prefix check and both are
 * normalised by `new URL()`. Anything else stays a text token and is shown as the characters the
 * author typed.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The three patterns are deliberately conservative — a handle is what micro-agora will accept as a
 * handle, a tag is letters and digits — because a false positive here is a link to a page that does
 * not exist, and a false negative is a word that stays a word. The second is much the cheaper miss.
 */
const PATTERN =
  /(https?:\/\/[^\s<>"']+)|(?:^|(?<=\s))@([A-Za-z0-9_]{2,32})|(?:^|(?<=\s))#([A-Za-z0-9_]{1,64})/g

export function tokenize(body: string): readonly Token[] {
  const tokens: Token[] = []
  let last = 0

  for (const match of body.matchAll(PATTERN)) {
    const index = match.index
    if (index > last) tokens.push({ kind: 'text', value: body.slice(last, index) })
    last = index + match[0].length

    const [, url, handle, tag] = match
    if (url !== undefined) {
      const safe = safeHref(url)
      // A refused scheme becomes TEXT, not a dropped token. Silently deleting what somebody wrote
      // is worse than showing it: the reader can see exactly what was posted and decide.
      tokens.push(safe === null ? { kind: 'text', value: url } : { kind: 'link', href: safe, label: prettyUrl(safe) })
    } else if (handle !== undefined) {
      tokens.push({ kind: 'mention', handle })
    } else if (tag !== undefined) {
      tokens.push({ kind: 'tag', tag })
    }
  }

  if (last < body.length) tokens.push({ kind: 'text', value: body.slice(last) })
  return tokens
}

/**
 * A URL this surface is willing to make clickable, or null.
 *
 * PARSED, not prefix-matched — see the header. `new URL()` throws on anything that is not a URL and
 * normalises the scheme, which is what makes `JaVaScript:` and `java\tscript:` both fail the
 * comparison below rather than slip past it.
 *
 * Trailing punctuation is trimmed first: a link at the end of a sentence is followed by a full stop
 * that the author meant as a full stop, and `https://example.com/x.` is a different address.
 */
export function safeHref(raw: string): string | null {
  const trimmed = raw.replace(/[.,;:!?)\]}'"]+$/, '')
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * What a link looks like on screen: the host, and enough of the path to be recognisable.
 *
 * The full URL is on the `title` and in the address bar on hover. A timeline where every link is
 * two hundred characters of tracking parameters is a timeline nobody can read, and the host is the
 * part that tells a reader whether they want to click — which is also the part a phishing attempt
 * most wants to hide behind a long path.
 */
export function prettyUrl(href: string): string {
  try {
    const url = new URL(href)
    const host = url.host.replace(/^www\./, '')
    const path = url.pathname === '/' ? '' : url.pathname
    const shown = `${host}${path}`
    return shown.length > 42 ? `${shown.slice(0, 41)}…` : shown
  } catch {
    return href
  }
}

/* ---- misc ----------------------------------------------------------- */

/**
 * The first line of something, for a preview.
 *
 * Breaks on a word rather than mid-syllable, and appends the ellipsis only when something was
 * actually removed — "…" after a complete sentence claims there is more to read when there is not.
 */
export function excerpt(body: string, max: number): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * The characters left in the composer.
 *
 * ── IT COUNTS UTF-16 UNITS, WHICH IS NOT THE NICER ANSWER ─────────────────────────────────────
 *
 * Counting CODE POINTS is the humane measure — an emoji is one thing a person typed, and
 * `String.length` calls it two, or eleven for a family with skin tones. An earlier version of this
 * function did that, and asserted that micro-agora measured the same way. IT DOES NOT:
 * `posts.ts` checks `body.length > deps.postMaxChars` on the normalised string, which is units.
 *
 * A counter that is KINDER than the service is the worst of the three options. It lets somebody
 * write to what it says is the end of their allowance, press Post, and be refused by the server
 * with a counter on screen saying there is room — and the more emoji they used, the further from
 * the truth it was. So this matches the rule that actually decides, and the disagreement is
 * recorded here rather than smoothed over: if the service moves to code points, this moves with it,
 * and `test/format.test.ts` pins the unit so the two cannot drift silently.
 *
 * The trim matters for the same reason — `normaliseBody` strips outer whitespace and zero-width
 * characters before measuring, so trailing newlines are not spent out of the reader's allowance.
 */
export function remaining(body: string, limit: number): number {
  return limit - body.trim().replace(/[​-‍﻿]/g, '').length
}
