/**
 * Every animated thing on this surface has an answer for a reader who asked their system for less.
 *
 * `prefers-reduced-motion` is not a preference about taste. For a reader with a vestibular disorder
 * a moving interface causes nausea, and for a reader with photosensitive epilepsy it is worse than
 * that. The estate's shared `ui.css` carries the block for its own components; this file's `--ag-*`
 * classes are ones the design system has never seen, so this repository has to carry the local half.
 *
 * The check is a text check because CSS is not typechecked, not imported by any test, and fails
 * INVISIBLY: adding a `transition:` to a new class breaks nothing, renders correctly for everybody,
 * and is only wrong for the readers least able to complain about it. Nothing but a grep will notice.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { read, stripComments } from './sources.ts'

const css = stripComments(read('src/styles.css'), 'css')

const REDUCED = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\n\}/.exec(css)?.[1] ?? ''
/** The stylesheet with the reduced-motion block cut out, so its own declarations are not scanned. */
const rest = css.replace(REDUCED, '')

/** Every rule as {selector, body}. Flat, which is all this stylesheet needs — it nests nothing. */
function rules(source: string): { selector: string; body: string }[] {
  return [...source.matchAll(/(^|\})\s*([^{}@]+?)\s*\{([^{}]*)\}/gm)].map((m) => ({
    selector: (m[2] ?? '').replace(/\s+/g, ' ').trim(),
    body: m[3] ?? '',
  }))
}

test('the reduced-motion block exists and is being parsed', () => {
  // Every assertion below is vacuous if this regex stops matching, which is the standard way a
  // stylesheet grep rots into a test that passes by finding nothing.
  assert.ok(REDUCED.length > 0, 'no @media (prefers-reduced-motion: reduce) block was found')
  assert.ok(rules(css).length > 100, `only ${rules(css).length} rules were parsed`)
})

test('EVERY TRANSITION HAS A MATCHING SELECTOR IN THE REDUCED-MOTION BLOCK', () => {
  const animated = rules(rest)
    .filter((r) => /(^|[\s;])transition:/.test(r.body))
    .flatMap((r) => r.selector.split(',').map((s) => s.trim()))
  assert.ok(animated.length >= 8, `only ${animated.length} transitions were found`)

  for (const selector of animated) {
    // The base selector without any state — `.ag-btn:hover` is turned off by naming `.ag-btn`.
    const base = selector.replace(/:{1,2}[a-z-]+(\([^)]*\))?/g, '').trim()
    assert.ok(
      new RegExp(`(^|[\\s,])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s,{]|$)`, 'm').test(
        REDUCED,
      ),
      `${selector} carries a transition that the reduced-motion block does not turn off`,
    )
  }
})

test('every keyframe animation is turned off too, not merely slowed', () => {
  // A slower pulse is still a pulse. `animation: none` with a dimmed opacity leaves the loading
  // dots legibly "waiting", which is the entire message they carry.
  const animated = rules(rest)
    .filter((r) => /(^|[\s;])animation:/.test(r.body))
    .flatMap((r) => r.selector.split(',').map((s) => s.trim()))
  for (const selector of animated) {
    assert.ok(REDUCED.includes(selector), `${selector} animates with no reduced-motion answer`)
  }
  assert.match(REDUCED, /animation:\s*none/)
})

test('the reduced-motion block only ever removes motion', () => {
  // A block that reduced motion by introducing a different one would be worse than nothing. It may
  // set `none`, and it may set opacity so that a stopped indicator still reads as an indicator.
  for (const rule of rules(`}${REDUCED}}`)) {
    for (const declaration of rule.body.split(';').map((d) => d.trim()).filter(Boolean)) {
      const [property = '', value = ''] = declaration.split(':').map((p) => p.trim())
      assert.ok(
        ['transition', 'animation', 'opacity', 'scroll-behavior', 'transform'].includes(property),
        `the reduced-motion block sets ${property}, which is not a motion property`,
      )
      if (property !== 'opacity') {
        assert.ok(
          value === 'none' || value === 'auto',
          `the reduced-motion block sets ${property}: ${value} rather than removing the motion`,
        )
      }
    }
  }
})

test('no duration is written as a literal, so the estate can slow the whole ecosystem at once', () => {
  // `--cf-speed` and `--cf-ease` are the design system's, and a hard-coded `0.2s` here is a value
  // that ignores every future change to them. It also hides from this file's other check, because
  // a transition on a class nobody remembered is exactly what a literal duration reads like.
  for (const rule of rules(rest)) {
    const transition = /transition:([^;]*)/.exec(rule.body)?.[1] ?? ''
    if (!transition.trim()) continue
    assert.match(
      transition,
      /var\(--cf-speed\)/,
      `${rule.selector} sets its own duration instead of var(--cf-speed)`,
    )
  }
})

test('nothing on this surface scrolls the reader somewhere smoothly', () => {
  // `scroll-behavior: smooth` set globally is the one motion a reduced-motion block usually misses,
  // because it is not a transition and not an animation. This surface restores scroll position on
  // navigation — see components/scroll-to-top.tsx — and doing that smoothly is a moving page under
  // somebody who pressed Back.
  assert.doesNotMatch(rest, /scroll-behavior:\s*smooth/)
})
