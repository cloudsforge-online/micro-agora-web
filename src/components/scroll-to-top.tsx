/**
 * Put the reader at the top of the page they just asked for.
 *
 * A browser resets scroll when it loads a document. A client-side router never loads one, so
 * without this the window keeps whatever offset it had and the next page opens part-way down. React
 * Router does not do this for you.
 *
 * Every frontend in the estate was missing it, and on the marketing site it was severe enough to be
 * reported as a routing bug rather than a scrolling one (micro-org#240). ON A TIMELINE IT IS WORSE
 * THAN ANYWHERE ELSE: a reader eight hundred pixels into the Square who presses a post opens the
 * thread eight hundred pixels down, in the middle of the replies, with the post they pressed
 * off-screen above them. That reads as having opened the wrong thing.
 *
 * ── Why this is a per-app file and not a @cloudsforge/ui export ────────────────────────────────
 *
 * It was one, briefly. The hooks below read a context the APPLICATION owns, and the design system
 * is consumed as `link:../ui/packages/ui`, whose working tree has its own `node_modules` — so a
 * router imported from inside that package resolves to a SECOND copy and reads an empty context.
 * Twelve duplicated lines is the cheaper, duller answer than a new class of peer dependency.
 *
 * ── The three behaviours, in precedence order ──────────────────────────────────────────────────
 *
 * POP is left alone: that is Back and Forward, where the reader expects the place they were
 * reading, the browser restores it, and this must not fight it. Coming BACK from a thread to a
 * timeline scrolled to where you were is most of what makes a social surface usable at all.
 *
 * A `#hash` scrolls to its target, so an in-page anchor keeps working.
 *
 * Otherwise the top, instantly — animating a page CHANGE makes every press feel slow.
 */
import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if (navigationType === 'POP') return
    if (hash) {
      const target = document.getElementById(hash.slice(1))
      if (target) {
        target.scrollIntoView()
        return
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash, navigationType])

  return null
}
