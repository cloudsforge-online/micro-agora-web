/**
 * Writing something.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE IDEMPOTENCY KEY IS MINTED ON THE FIRST KEYSTROKE AND HELD UNTIL A POST SUCCEEDS.
 *
 * Not minted at submit. A key minted at submit is a key that changes on every press, so the second
 * press after a request that timed out — which is the press every human makes — publishes a second
 * copy of the same paragraph. And a duplicate post is not a duplicate charge somebody can reverse:
 * it is visible to everybody who was reading, it cannot be un-seen, and the author looks like they
 * are shouting.
 *
 * So the key is minted when the reader starts typing this particular thing, survives every failure
 * and every retry of it, and is thrown away only when the service has said 201 (or 200 — an
 * idempotency hit answers with the post that already exists, which is the same good outcome and is
 * exactly what makes the retry safe).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── THE AUDIENCE CONTROL IS SMALLER THAN IT LOOKS, AND DELIBERATELY ──────────────────────────────
 *
 * micro-agora enforces three rules this component must not contradict, because contradicting them
 * produces a control that offers something the server then refuses:
 *
 *   A REPLY CANNOT BE MORE PUBLIC THAN WHAT IT ANSWERS. `posts.ts` refuses it outright — replying
 *   publicly to a followers-only post publishes the fact of the conversation to people who cannot
 *   read half of it. So a reply has NO audience control at all: it inherits the parent's audience
 *   and its circle, and says so in one line above the box.
 *
 *   ONLY A PUBLIC POST CAN BE QUOTED. Quoting is republishing, and a followers-only post quoted
 *   into a public one is that post made public by somebody who was trusted with it. The quote
 *   control therefore only ever appears on a public post; nothing here needs to re-check it.
 *
 *   A CIRCLE POST NEEDS A CIRCLE, AND ONLY A CIRCLE POST MAY NAME ONE. Both directions are errors.
 *   Choosing "A circle" without choosing which one leaves Post disabled rather than sending a
 *   request that cannot succeed.
 *
 * ── AND IT DOES NOT UPLOAD ANYTHING ──────────────────────────────────────────────────────────────
 *
 * `media: []`, always. micro-agora has no upload route — bytes enter the estate through
 * micro-studio and arrive here as an asset id — so there is no honest attach button to draw yet.
 * Drawing one that opened a file picker and then failed would be worse than not drawing it. Text
 * posting is complete without it, which is why this surface ships now rather than waiting.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { newIdempotencyKey, noticeFor } from '../lib/api.ts'
import { useSession, useVoice } from '../lib/auth.tsx'
import {
  myCircles,
  publish,
  type Circle,
  type DraftPost,
  type Post,
  type Visibility,
} from '../lib/agora.ts'
import { excerpt, remaining } from '../lib/format.ts'
import { viewedNetwork } from '../lib/viewed.ts'
import { Avatar } from './post.tsx'
import { Suspended } from './states.tsx'

/**
 * The limit, matching `MAX_POST_CHARS` in `agora/src/text.ts`.
 *
 * A DEPLOYMENT MAY SET IT LOWER — `AGORA_POST_MAX_CHARS` is read from the environment and capped at
 * this number, never raised above it — and this bundle has no way to read that value, because the
 * service does not publish its limits and inventing a config endpoint for one integer would be a
 * new route to keep in step forever. So this counter is the CEILING: it is right on every
 * deployment that has not lowered the limit, and on one that has, the service refuses with the
 * exact number in the message and that message is shown verbatim. Being wrong in the direction of
 * "the server explained it" beats being wrong in the direction of a counter nobody can act on.
 */
export const POST_LIMIT = 4_000

/** The counter appears here rather than at zero. Above this it is noise beside a two-line post. */
const COUNTER_FROM = 400

/** `content_warning` is truncated to 200 by the insert, so the box stops there. */
const WARNING_LIMIT = 200

export interface ComposerProps {
  /**
   * The post being replied to. Its audience is inherited; there is no control to widen it.
   */
  replyTo?: Post | undefined
  /** The post being quoted. Always a public one — see the header. */
  quoteOf?: Post | undefined
  /** Composing inside a circle: the audience is that circle and is not chosen again. */
  circle?: Circle | undefined
  /** Handed the published post. The caller puts it at the top of the list it is showing. */
  onPosted: (post: Post) => void
  /** Rendered as a Cancel button when present — a reply box that cannot be closed is a trap. */
  onCancel?: (() => void) | undefined
  autoFocus?: boolean | undefined
  placeholder?: string | undefined
}

export function Composer({
  replyTo,
  quoteOf,
  circle,
  onPosted,
  onCancel,
  autoFocus,
  placeholder,
}: ComposerProps) {
  const { status, signIn: go } = useSession()
  const { me, suspended, reload } = useVoice()

  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState<Visibility>(circle ? 'circle' : 'public')
  const [circleId, setCircleId] = useState<string>(circle?.id ?? '')
  const [sensitive, setSensitive] = useState(false)
  const [warning, setWarning] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ message: string; requestId: string | undefined } | null>(
    null,
  )

  // See the header. Minted on the first keystroke of THIS draft, cleared on success.
  const key = useRef<string | null>(null)
  const box = useRef<HTMLTextAreaElement | null>(null)
  const fieldId = useId()

  const left = remaining(body, POST_LIMIT)
  const over = left < 0
  const empty = body.trim().length === 0
  // A circle post with no circle chosen is refused by the service, so it is refused here first.
  const needsCircle = visibility === 'circle' && !circleId
  const canPost = !empty && !over && !needsCircle && !busy

  const write = useCallback((next: string) => {
    if (key.current === null && next.trim().length > 0) key.current = newIdempotencyKey()
    setBody(next)
  }, [])

  const send = useCallback(async () => {
    if (!canPost) return
    if (status !== 'in') {
      go()
      return
    }
    setBusy(true)
    setFailure(null)
    const draft: DraftPost = {
      body: body.trim(),
      // The browser's own language, declared rather than guessed at read time. It becomes `lang` on
      // the rendered paragraph, which is what stops a screen reader announcing Greek in English.
      lang: typeof navigator === 'undefined' ? '' : navigator.language,
      media: [],
      ...(replyTo
        ? {
            inReplyToId: replyTo.id,
            // Inherited, both of them. The service refuses a wider reply and refuses a circle post
            // with no circle, so a reply to a circle post must carry the parent's circle.
            visibility: replyTo.visibility,
            ...(replyTo.circleId ? { circleId: replyTo.circleId } : {}),
          }
        : {
            visibility,
            ...(visibility === 'circle' ? { circleId } : {}),
          }),
      ...(quoteOf ? { quoteOfId: quoteOf.id } : {}),
      ...(sensitive ? { sensitive: true } : {}),
      ...(sensitive && warning.trim() ? { contentWarning: warning.trim() } : {}),
    }
    try {
      const { post } = await publish(draft, key.current ?? newIdempotencyKey())
      // Only now. Everything above this line is retried under the same key; past it, the next thing
      // the reader writes is a different thing and gets a key of its own.
      key.current = null
      setBody('')
      setSensitive(false)
      setWarning('')
      onPosted(post)
      // The post count on the reader's own profile just changed, and it is on screen in two places.
      reload()
    } catch (err) {
      const notice = noticeFor(err, 'That did not post.')
      setFailure({ message: notice.message, requestId: notice.requestId })
    } finally {
      setBusy(false)
    }
  }, [body, canPost, circleId, go, onPosted, quoteOf, reload, replyTo, sensitive, status, visibility, warning])

  /* A suspension takes away writing and nothing else — never the page. See `states.tsx`. */
  if (suspended) return <Suspended network={viewedNetwork() === 'testnet' ? 'Testnet' : 'Mainnet'} />

  if (status === 'out') {
    return (
      <div className="ag-composer ag-composer--gate">
        <p className="ag-composer__gate-text">
          {replyTo ? 'Sign in to reply.' : 'Sign in with your CloudsForge account to post here.'}
        </p>
        <button className="ag-btn ag-btn--primary" onClick={() => go()} type="button">
          Sign in
        </button>
      </div>
    )
  }
  // `unknown` renders the box in its disabled shape rather than a sign-in prompt: showing the
  // prompt for the 200ms before `/auth/me` answers tells a signed-in reader they were signed out.

  return (
    <form
      className={`ag-composer${replyTo ? ' ag-composer--reply' : ''}`}
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <div className="ag-composer__gutter">
        {me && (
          <Avatar
            avatarUrl={me.voice.avatarUrl}
            displayName={me.voice.displayName}
            handle={me.voice.handle}
            size="md"
          />
        )}
      </div>

      <div className="ag-composer__main">
        {replyTo && <InheritedAudience post={replyTo} />}
        {quoteOf && <QuotedPreview post={quoteOf} />}

        <label className="ag-composer__label" htmlFor={fieldId}>
          {replyTo ? `Your reply to @${replyTo.handle}` : 'What do you want to say?'}
        </label>
        <textarea
          autoFocus={autoFocus}
          className="ag-textarea ag-composer__box"
          id={fieldId}
          onChange={(e) => write(e.target.value)}
          onKeyDown={(event) => {
            // The shortcut every writing box on the internet has. Without it, a reader who has just
            // typed four hundred words has to leave the keyboard to find a button.
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void send()
            }
          }}
          placeholder={placeholder ?? (replyTo ? 'Say something back' : 'Say something')}
          ref={box}
          rows={replyTo ? 2 : 3}
          value={body}
        />

        {sensitive && (
          <label className="ag-field ag-composer__warning">
            <span className="ag-field__label">What should people know before they look?</span>
            <input
              className="ag-input"
              maxLength={WARNING_LIMIT}
              onChange={(e) => setWarning(e.target.value)}
              placeholder="A short reason"
              type="text"
              value={warning}
            />
          </label>
        )}

        <div className="ag-composer__controls">
          {!replyTo && !circle && (
            <AudienceSelect
              circleId={circleId}
              onCircle={setCircleId}
              onVisibility={setVisibility}
              visibility={visibility}
            />
          )}
          {circle && (
            <p className="ag-composer__audience">
              Posting to <strong>{circle.name}</strong>
            </p>
          )}

          <button
            aria-pressed={sensitive}
            className={`ag-btn ag-btn--quiet${sensitive ? ' is-on' : ''}`}
            onClick={() => setSensitive((on) => !on)}
            title="Hide this behind a warning until somebody presses to see it"
            type="button"
          >
            {sensitive ? 'Warned' : 'Add a warning'}
          </button>

          <span className="ag-composer__spacer" />

          {/*
            The counter appears near the end rather than always. `role="status"` and `aria-live` on
            a number that changes every keystroke would announce every keystroke, so it is polite
            and only becomes assertive — via `alert` — once the post can no longer be sent.
          */}
          {left <= COUNTER_FROM && (
            <span
              className={`ag-composer__count cf-num${over ? ' is-over' : ''}`}
              role={over ? 'alert' : 'status'}
            >
              {left}
            </span>
          )}

          {onCancel && (
            <button className="ag-btn ag-btn--quiet" onClick={onCancel} type="button">
              Cancel
            </button>
          )}
          <button className="ag-btn ag-btn--primary" disabled={!canPost} type="submit">
            {busy ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
          </button>
        </div>

        {needsCircle && (
          <p className="ag-composer__hint" role="status">
            Choose which circle this goes to.
          </p>
        )}

        {failure && (
          <p className="ag-composer__failure" role="alert">
            {failure.message}
            {failure.requestId && (
              <>
                {' '}
                <span className="ag-composer__ref">
                  Reference <code>{failure.requestId}</code>
                </span>
              </>
            )}{' '}
            {/*
              Said out loud, because it is the one thing that makes pressing Post again safe and
              nobody would assume it. The draft is still in the box and the key is still held.
            */}
            <span className="ag-composer__safe">Your words are still here — pressing Post again
            will not publish it twice.</span>
          </p>
        )}
      </div>
    </form>
  )
}

/* ---- the audience ---------------------------------------------------- */

/**
 * Who will be able to read this.
 *
 * Three options, matching the service's `VISIBILITIES` exactly. There is no "unlisted" and no
 * "mentioned people only", because offering either would be promising a setting the database has no
 * column for.
 *
 * The circle list is fetched ONLY when somebody chooses "A circle". Loading every reader's
 * membership list on every page that has a composer would be a request per page view for a control
 * most readers never open — and this is the composer that sits at the top of the Square, which is
 * the most-loaded page on the surface.
 */
function AudienceSelect({
  circleId,
  onCircle,
  onVisibility,
  visibility,
}: {
  circleId: string
  onCircle: (id: string) => void
  onVisibility: (v: Visibility) => void
  visibility: Visibility
}) {
  const [circles, setCircles] = useState<readonly Circle[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (visibility !== 'circle' || circles !== null) return
    const controller = new AbortController()
    myCircles({ signal: controller.signal })
      .then((page) => {
        if (!controller.signal.aborted) setCircles(page.circles)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [circles, visibility])

  // Archived circles are still listed by `myCircles` — they are still a membership — but nothing
  // new can go into one, so they are not offered as a destination.
  const open = useMemo(() => (circles ?? []).filter((c) => !c.archived), [circles])

  return (
    <>
      <label className="ag-composer__audience">
        <span className="ag-vh">Who can see this</span>
        <select
          className="ag-select ag-select--quiet"
          onChange={(e) => onVisibility(e.target.value as Visibility)}
          value={visibility}
        >
          <option value="public">Everyone</option>
          <option value="followers">People who follow you</option>
          <option value="circle">A circle</option>
        </select>
      </label>

      {visibility === 'circle' && (
        <label className="ag-composer__audience">
          <span className="ag-vh">Which circle</span>
          <select
            className="ag-select ag-select--quiet"
            onChange={(e) => onCircle(e.target.value)}
            value={circleId}
          >
            <option value="">Choose a circle…</option>
            {open.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {visibility === 'circle' && circles !== null && open.length === 0 && !failed && (
        <p className="ag-composer__hint">
          You are not in a circle yet. <Link to="/circles">Find one</Link>.
        </p>
      )}
      {failed && <p className="ag-composer__hint">Your circles did not load.</p>}
    </>
  )
}

/**
 * What a reply inherits, stated rather than implied.
 *
 * A reader replying to a followers-only post needs to know that their reply is followers-only too,
 * BEFORE they write it — not after they have said something they would have phrased differently in
 * public, or in private. There is no control here because the service does not permit one.
 */
function InheritedAudience({ post }: { post: Post }) {
  if (post.visibility === 'public') {
    return <p className="ag-composer__audience-note">Replying to @{post.handle}. Anyone can see it.</p>
  }
  return (
    <p className="ag-composer__audience-note">
      Replying to @{post.handle}.{' '}
      {post.visibility === 'circle'
        ? 'Your reply goes to the same circle and nowhere else.'
        : 'Your reply is visible to the same people as the post, not to everyone.'}
    </p>
  )
}

/** The post being quoted, shown small, so nobody quotes the wrong thing. */
function QuotedPreview({ post }: { post: Post }) {
  return (
    <blockquote className="ag-quoted ag-quoted--draft">
      <cite className="ag-quoted__who">@{post.handle}</cite>
      <p className="ag-quoted__body">{excerpt(post.body, 180)}</p>
    </blockquote>
  )
}
