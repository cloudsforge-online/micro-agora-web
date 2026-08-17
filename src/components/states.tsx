/**
 * The six states a panel here can be in, as six visibly different things.
 *
 * `lib/resource.ts` decides WHICH one; this file decides what each looks like and, more
 * importantly, what each one SAYS. The sentences are the point — a state component that renders
 * "Error" is a state component that has told the reader nothing they did not already know.
 *
 *   LOADING    — waiting is the correct action.
 *   EMPTY      — the square answered, with nothing. NOTHING IS WRONG, and on this estate that is
 *                the ordinary case rather than the edge: there are no real users yet, so every
 *                timeline starts empty and stays that way until somebody writes. Every empty state
 *                here is therefore written as an invitation with something to press, never as an
 *                absence to apologise for.
 *   FAILED     — the read did not come back. Retrying may help, and the request id is printed so a
 *                reader can quote the one thing that finds their exact request in the logs.
 *   FORBIDDEN  — understood and refused. Retrying cannot help; being somebody else might.
 *   MISSING    — 404, which on this surface is the common one. A deleted post, a circle the reader
 *                is not in, an id somebody mistyped — micro-agora answers all three identically on
 *                purpose, so this copy must not claim to know which it was.
 *   GONE QUIET — a voice that exists and has barred the reader, or vice versa. Stated plainly
 *                rather than rendered as an empty profile, which reads as a bug.
 *
 * ── NOTHING HERE PRINTS AN EXCEPTION ──────────────────────────────────────────────────────────
 *
 * The copy is fixed text chosen by the caller, plus a `message` that came from a CloudsForge error
 * envelope and was written to be read. There is deliberately no prop through which a caught
 * `Error` can arrive: a fetch rejection carries the full request URL, every authenticated request
 * on this surface is built with a bearer, and that is how a credential has leaked in this estate
 * twice already.
 */
import type { ReactNode } from 'react'

/** Printed under every failure. The one string that finds a request across every service at once. */
function RequestId({ id }: { id: string | undefined }) {
  if (!id) return null
  return (
    <p className="ag-state__ref">
      Reference <code className="ag-state__ref-code">{id}</code>
    </p>
  )
}

export function Loading({ label = 'Loading' }: { label?: string | undefined }) {
  return (
    <div className="ag-state ag-state--loading" role="status" aria-live="polite">
      {/*
        Three dots rather than a spinner. A spinner on a timeline that loads in 200ms is a flash of
        motion the reader registers as something going wrong; this reads as the square thinking.
      */}
      <span className="ag-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p className="ag-state__title">{label}</p>
    </div>
  )
}

export function Empty({
  title,
  hint,
  action,
  glyph = '◇',
}: {
  /** What was asked and that the answer was nothing — not "no data", which describes the screen. */
  title: string
  hint?: string | undefined
  action?: ReactNode | undefined
  glyph?: string | undefined
}) {
  return (
    <div className="ag-state ag-state--empty" role="status">
      <span className="ag-state__glyph" aria-hidden="true">
        {glyph}
      </span>
      <p className="ag-state__title">{title}</p>
      {hint && <p className="ag-state__hint">{hint}</p>}
      {action && <div className="ag-state__action">{action}</div>}
    </div>
  )
}

export function Failed({
  title = 'That did not load',
  message,
  requestId,
  onRetry,
}: {
  title?: string | undefined
  /** The sentence the service sent. Already written for a reader; shown as it arrived. */
  message?: string | undefined
  requestId?: string | undefined
  onRetry?: (() => void) | undefined
}) {
  return (
    <div className="ag-state ag-state--failed" role="alert">
      <span className="ag-state__glyph" aria-hidden="true">
        ■
      </span>
      <p className="ag-state__title">{title}</p>
      {message && <p className="ag-state__hint">{message}</p>}
      <RequestId id={requestId} />
      {onRetry && (
        <div className="ag-state__action">
          <button className="ag-btn" onClick={onRetry} type="button">
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Understood, and refused.
 *
 * No Retry button, and its absence is the message: pressing it would produce the same 403 forever.
 * The two things that CAN change the answer are being a different person and asking to join, so
 * `action` is where a caller puts the join button on a circle page.
 */
export function Forbidden({
  title = 'This is not open to you',
  message,
  requestId,
  action,
}: {
  title?: string | undefined
  message?: string | undefined
  requestId?: string | undefined
  action?: ReactNode | undefined
}) {
  return (
    <div className="ag-state ag-state--refused" role="alert">
      <span className="ag-state__glyph" aria-hidden="true">
        ⊘
      </span>
      <p className="ag-state__title">{title}</p>
      <p className="ag-state__hint">
        {message ??
          'Whoever posted this chose who can see it, and it is not shared with you. Nothing is broken.'}
      </p>
      <RequestId id={requestId} />
      {action && <div className="ag-state__action">{action}</div>}
    </div>
  )
}

/**
 * 404 — and the copy must not guess which kind.
 *
 * micro-agora answers 404 identically for a post that was deleted, a post inside a circle the
 * reader is not a member of, and an id that is not a UUID at all. That is a deliberate privacy
 * property: if the three answers differed, anybody could probe ids and learn which private posts
 * exist. Copy that said "this post was deleted" would undo it in the one place a reader looks —
 * so this says what is actually known, which is that there is nothing here for this address.
 */
export function Missing({
  what = 'page',
  action,
}: {
  /** The noun, lower case: "post", "voice", "circle". Goes straight into the sentence. */
  what?: string | undefined
  action?: ReactNode | undefined
}) {
  return (
    <div className="ag-state ag-state--missing" role="status">
      <span className="ag-state__glyph" aria-hidden="true">
        ⌀
      </span>
      <p className="ag-state__title">There is no {what} at this address</p>
      <p className="ag-state__hint">
        It may have been deleted, or it may never have been public. Either way there is nothing here
        to show you.
      </p>
      {action && <div className="ag-state__action">{action}</div>}
    </div>
  )
}

/**
 * Two people who have chosen not to see each other.
 *
 * Rendered instead of a profile, in both directions, and it says which direction it is — a reader
 * who barred somebody months ago and forgot needs to know that the emptiness is their own doing,
 * and a reader who has been barred is owed the truth rather than a page that appears broken.
 */
export function Barred({ handle, byThem }: { handle: string; byThem: boolean }) {
  return (
    <div className="ag-state ag-state--quiet" role="status">
      <span className="ag-state__glyph" aria-hidden="true">
        ◐
      </span>
      <p className="ag-state__title">
        {byThem ? `@${handle} has barred you` : `You have barred @${handle}`}
      </p>
      <p className="ag-state__hint">
        {byThem
          ? 'Their posts do not appear for you and yours do not appear for them.'
          : 'You will not see their posts and they will not see yours. You can undo this in your settings.'}
      </p>
    </div>
  )
}

/**
 * The reader's own voice is suspended on this network.
 *
 * Rendered where a composer would be, never in place of the page. A suspension takes away writing
 * and nothing else: the reader still reads, their posts stay up, and their followers are still
 * theirs. Replacing the square with a wall would tell them they had been removed, which is a
 * different and much larger thing than what happened.
 *
 * It says WHICH NETWORK, because it is per-network — the same account can be suspended in one
 * square and in good standing in the other, and a reader who does not know that reads the sentence
 * as being about their CloudsForge account.
 */
export function Suspended({ network }: { network: string }) {
  return (
    <div className="ag-state ag-state--refused" role="status">
      <span className="ag-state__glyph" aria-hidden="true">
        ⊘
      </span>
      <p className="ag-state__title">Your voice is suspended on {network}</p>
      <p className="ag-state__hint">
        You can read the square and everything you have written is still here, but you cannot post,
        reply or whisper while the suspension stands. Write to an operator if you think this is
        wrong.
      </p>
    </div>
  )
}
