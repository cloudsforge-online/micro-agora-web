/**
 * A post, and everything that renders one.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE RULE: SOMEBODY ELSE'S TEXT BECOMES REACT ELEMENTS, NEVER HTML.
 *
 * `tokenize()` in `lib/format.ts` turns a body into data — text, mentions, tags, links — and this
 * file turns each token into an element. React escapes every string it puts in a text node, so a
 * post containing `<img onerror=…>` renders those characters on the screen. There is no
 * `dangerouslySetInnerHTML` in this repository and `test/no-dangerous-html.test.ts` greps `src/` on
 * every run to keep it that way. The scheme check that stops `javascript:` in an `href` lives in
 * `safeHref()`, beside the tokenizer, for the same reason: one place, tested without a browser.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── OPTIMISTIC, WITH THE ROLLBACK WRITTEN FIRST ───────────────────────────────────────────────
 *
 * Spark, Echo and Bookmark all paint immediately and reconcile afterwards. A reaction that waits
 * 200ms for a round trip feels broken, and this is the interaction a reader performs most. What
 * makes it safe rather than a lie is that the failure path is explicit: the previous state is
 * captured before the write, restored on rejection, and the reader is told. A silent revert would
 * be worse than no optimism at all — the button would appear to un-press itself.
 *
 * The routes are `PUT` and `DELETE`, never a toggle, precisely so this is safe: a retry of PUT is
 * the same state, whereas a retry of a toggle undoes the first attempt.
 */
import { Link } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
import { useSession } from '../lib/auth.tsx'
import {
  bookmark,
  deletePost,
  echo,
  fileReport,
  spark,
  type Engagement,
  type Media,
  type Post,
  type ReportReason,
} from '../lib/agora.ts'
import { ago, at, count, countLabel, exact, hue, initials, tokenize } from '../lib/format.ts'
import { postPath, tagPath, voicePath } from '../lib/routes.ts'

/* ---- the person ----------------------------------------------------- */

export interface AvatarProps {
  handle: string
  displayName: string
  avatarUrl: string | null
  size?: 'sm' | 'md' | 'lg' | undefined
}

/**
 * A face, or two letters in a colour derived from the handle.
 *
 * The fallback is never an empty circle: that reads as a broken image rather than as a person who
 * has not uploaded a picture, and on a square with no real users yet it would be nearly every row.
 *
 * `loading="lazy"` and explicit dimensions are both load-bearing on a timeline of fifty rows —
 * without the dimensions every avatar that arrives shifts the text beneath it, which on a list
 * somebody is reading is the most annoying possible layout shift.
 */
export function Avatar({ handle, displayName, avatarUrl, size = 'md' }: AvatarProps) {
  const px = size === 'sm' ? 28 : size === 'lg' ? 76 : 44
  if (avatarUrl) {
    return (
      <img
        alt=""
        className={`ag-avatar ag-avatar--${size}`}
        height={px}
        loading="lazy"
        src={avatarUrl}
        width={px}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`ag-avatar ag-avatar--${size} ag-avatar--letters`}
      style={{ '--ag-avatar-hue': hue(handle) } as React.CSSProperties}
    >
      {initials(displayName, handle)}
    </span>
  )
}

/** Name and handle, linked to the voice. The whole pair is one link — two would double the tab stops. */
export function VoiceName({
  handle,
  displayName,
  compact,
}: {
  handle: string
  displayName: string
  compact?: boolean | undefined
}) {
  return (
    <Link className="ag-voice-name" to={voicePath(handle)}>
      <span className="ag-voice-name__display">{displayName || at(handle)}</span>
      {!compact && <span className="ag-voice-name__handle">{at(handle)}</span>}
    </Link>
  )
}

/* ---- the body ------------------------------------------------------- */

/**
 * A post body, tokenized.
 *
 * `lang` comes from the author's browser at compose time and is set on the element rather than
 * discarded: a screen reader announcing Greek text with an English voice is unintelligible, and
 * this estate has readers writing in both.
 */
export function Body({ body, lang }: { body: string; lang: string }) {
  const tokens = useMemo(() => tokenize(body), [body])
  return (
    <p className="ag-post__body" lang={lang || undefined}>
      {tokens.map((token, i) => {
        switch (token.kind) {
          case 'mention':
            return (
              <Link className="ag-tok ag-tok--mention" key={i} to={voicePath(token.handle)}>
                {at(token.handle)}
              </Link>
            )
          case 'tag':
            return (
              <Link className="ag-tok ag-tok--tag" key={i} to={tagPath(token.tag)}>
                #{token.tag}
              </Link>
            )
          case 'link':
            return (
              <a
                className="ag-tok ag-tok--link"
                href={token.href}
                key={i}
                // `noopener` is the security half — without it the opened page gets a handle on
                // this window through `window.opener` and can navigate it somewhere that looks
                // like a sign-in page. `nofollow ugc` is the other half: this is user-generated
                // content, and a public square that passes its PageRank to whatever anybody pastes
                // is a public square that fills up with people pasting.
                rel="noopener noreferrer nofollow ugc"
                target="_blank"
                title={token.href}
              >
                {token.label}
              </a>
            )
          default:
            // A plain string child. React escapes it; nothing here builds markup.
            return <span key={i}>{token.value}</span>
        }
      })}
    </p>
  )
}

/* ---- attachments ---------------------------------------------------- */

/**
 * Images and video.
 *
 * `alt` is required by the composer and passed through verbatim here; when an author left it empty
 * the image is marked decorative rather than given an invented description, because a made-up alt
 * is worse than none — it tells a screen reader user something that may not be true.
 *
 * `bytesUrl` IS NULL when this deployment has no `STUDIO_PUBLIC_URL` — the service returns null
 * rather than guessing a hostname, so that a client can render something honest instead of a broken
 * image icon. What is rendered is the description: an attachment whose bytes cannot be reached is
 * still a thing the author attached and said something about, and the alt text is the something.
 */
function MediaGrid({ media }: { media: readonly Media[] }) {
  if (media.length === 0) return null
  return (
    <div className={`ag-media ag-media--${Math.min(media.length, 4)}`}>
      {media.map((item) => {
        if (!item.bytesUrl) {
          return (
            <p className="ag-media__item ag-media__item--absent" key={item.id}>
              {item.alt || 'An attachment that cannot be shown here.'}
            </p>
          )
        }
        if (item.kind === 'video') {
          // No autoplay, ever. A timeline that starts playing sound is a timeline people close.
          return (
            <video
              className="ag-media__item"
              controls
              key={item.id}
              preload="metadata"
              src={item.bytesUrl}
            >
              {item.alt}
            </video>
          )
        }
        return (
          <img
            alt={item.alt}
            className="ag-media__item"
            key={item.id}
            loading="lazy"
            src={item.bytesUrl}
          />
        )
      })}
    </div>
  )
}

/* ---- one post ------------------------------------------------------- */

export interface PostCardProps {
  post: Post
  /** Called with the server's post after a reaction. The list writes it back in place. */
  onChange?: ((next: Post) => void) | undefined
  /** Called after a successful delete, so the list can drop the row. */
  onRemove?: ((id: string) => void) | undefined
  /** True on the focused post of a thread: bigger type, exact timestamp, no truncation. */
  focused?: boolean | undefined
  /** Draw the connector to the reply below. Threads only. */
  connected?: boolean | undefined
}

export function PostCard({ post, onChange, onRemove, focused, connected }: PostCardProps) {
  const { status, signIn: go } = useSession()
  const signedIn = status === 'in'
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const now = Date.now()

  const viewer = post.viewer
  const hidden = post.sensitive && !revealed

  /**
   * One reaction, painted first and reconciled after.
   *
   * ── THE SERVER SENDS A NUMBER, NOT A POST ───────────────────────────────────────────────────
   *
   * `spark`, `echo` and `bookmark` answer `{changed, count}` — `engagementRoute` in the service
   * builds exactly that — so there is nothing here to swap the rendered post for. The count is
   * applied ONTO the post this card already holds, which is also the more correct behaviour: it
   * touches the one number that changed and leaves the body, the media and everybody else's counts
   * exactly as they were rather than replacing a row mid-read.
   *
   * `changed: false` is not a failure. It means the state was already what was asked for — a
   * double-press, or a retry after a lost response — and the reader gets the count either way.
   *
   * Bookmarks have no visible count and pass `countKey: null`; their `count` is the reader's own
   * total and is deliberately not shown next to a button nobody else can see the result of.
   *
   * `onChange` is called TWICE on the happy path: once with the guess and once with the confirmed
   * number, which is what corrects a count somebody else was incrementing at the same moment. On
   * failure it is called a third time, with the original.
   */
  const react = useCallback(
    async (
      key: 'sparked' | 'echoed' | 'bookmarked',
      countKey: 'sparkCount' | 'echoCount' | null,
      write: (id: string, on: boolean) => Promise<Engagement>,
    ) => {
      if (!signedIn) {
        go()
        return
      }
      if (busy || post.deleted) return
      const before = post
      const on = !(viewer?.[key] ?? false)
      const withViewer = (next: Post, count: number | null): Post => ({
        ...next,
        viewer: {
          sparked: false,
          echoed: false,
          bookmarked: false,
          mine: false,
          ...viewer,
          [key]: on,
        },
        ...(countKey && count !== null ? { [countKey]: Math.max(0, count) } : {}),
      })
      setBusy(true)
      setFailure(null)
      onChange?.(withViewer(post, countKey ? post[countKey] + (on ? 1 : -1) : null))
      try {
        const { count } = await write(post.id, on)
        onChange?.(withViewer(post, count))
      } catch {
        // The rollback is the whole reason this is safe to do optimistically. Silence here would
        // leave a button that appears to have un-pressed itself.
        onChange?.(before)
        setFailure('That did not go through.')
      } finally {
        setBusy(false)
      }
    },
    [busy, go, onChange, post, signedIn, viewer],
  )

  const remove = useCallback(async () => {
    setMenuOpen(false)
    setBusy(true)
    try {
      await deletePost(post.id)
      onRemove?.(post.id)
    } catch {
      setFailure('The post was not deleted.')
    } finally {
      setBusy(false)
    }
  }, [onRemove, post.id])

  if (post.deleted) {
    // Still rendered, because a reply under nothing reads as a non-sequitur. See `Post.deleted`.
    return (
      <article className={`ag-post ag-post--gone${connected ? ' ag-post--connected' : ''}`}>
        <p className="ag-post__gone">This post was deleted.</p>
      </article>
    )
  }

  return (
    <article
      className={[
        'ag-post',
        focused ? 'ag-post--focused' : '',
        connected ? 'ag-post--connected' : '',
        busy ? 'is-busy' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="ag-post__gutter">
        <Link aria-label={`${post.displayName || post.handle}'s posts`} to={voicePath(post.handle)}>
          <Avatar
            avatarUrl={post.avatarUrl}
            displayName={post.displayName}
            handle={post.handle}
            size={focused ? 'lg' : 'md'}
          />
        </Link>
        {connected && <span aria-hidden="true" className="ag-post__thread-line" />}
      </div>

      <div className="ag-post__main">
        <header className="ag-post__head">
          <VoiceName displayName={post.displayName} handle={post.handle} />
          <span aria-hidden="true" className="ag-post__dot">
            ·
          </span>
          {/*
            The permalink is the TIMESTAMP, which is the convention every reader of every social
            surface already knows. `<time>` carries the machine-readable value so a copy into a
            calendar or a screen reader announcement gets the real instant, not "2h".
          */}
          <Link className="ag-post__when" to={postPath(post.id)}>
            <time dateTime={post.createdAt} title={exact(post.createdAt)}>
              {focused ? exact(post.createdAt) : ago(post.createdAt, now)}
            </time>
          </Link>
          {post.editedAt && (
            <span className="ag-post__edited" title={`Edited ${exact(post.editedAt)}`}>
              edited
            </span>
          )}
          {post.visibility !== 'public' && <VisibilityBadge visibility={post.visibility} />}
          <span className="ag-post__spacer" />
          <div className="ag-post__menu">
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="More"
              className="ag-icon-btn"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              ⋯
            </button>
            {menuOpen && (
              <ul className="ag-menu" role="menu">
                <li role="none">
                  <button
                    className="ag-menu__item"
                    onClick={() => {
                      void navigator.clipboard?.writeText(
                        `${window.location.origin}${postPath(post.id)}`,
                      )
                      setMenuOpen(false)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    Copy link
                  </button>
                </li>
                {viewer?.mine ? (
                  <li role="none">
                    <button className="ag-menu__item ag-menu__item--danger" onClick={remove} role="menuitem" type="button">
                      Delete
                    </button>
                  </li>
                ) : (
                  <li role="none">
                    <button
                      className="ag-menu__item"
                      onClick={() => {
                        setMenuOpen(false)
                        if (!signedIn) {
                          go()
                          return
                        }
                        setReporting(true)
                      }}
                      role="menuitem"
                      type="button"
                    >
                      Report
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </header>

        {hidden ? (
          <div className="ag-post__warned">
            <p className="ag-post__warning">{post.contentWarning || 'The author marked this as sensitive.'}</p>
            <button className="ag-btn ag-btn--quiet" onClick={() => setRevealed(true)} type="button">
              Show anyway
            </button>
          </div>
        ) : (
          <>
            <Body body={post.body} lang={post.lang} />
            <MediaGrid media={post.media} />
          </>
        )}

        {reporting && <ReportForm postId={post.id} onDone={() => setReporting(false)} />}

        <footer className="ag-post__actions">
          <Action
            active={false}
            count={post.replyCount}
            icon="↩"
            label="replies"
            to={postPath(post.id)}
            word="Reply"
          />
          <Action
            active={viewer?.echoed ?? false}
            count={post.echoCount}
            icon="⇄"
            label="echoes"
            onClick={() => void react('echoed', 'echoCount', echo)}
            word="Echo"
          />
          <Action
            active={viewer?.sparked ?? false}
            count={post.sparkCount}
            icon="✦"
            label="sparks"
            onClick={() => void react('sparked', 'sparkCount', spark)}
            word="Spark"
          />
          <Action
            active={viewer?.bookmarked ?? false}
            count={0}
            icon="⌗"
            label="bookmarks"
            onClick={() => void react('bookmarked', null, bookmark)}
            word="Bookmark"
          />
        </footer>

        {/*
          `role="status"` rather than `alert`: a failed Spark is worth telling somebody about and is
          not worth interrupting them mid-sentence for.
        */}
        {failure && (
          <p className="ag-post__failure" role="status">
            {failure}
          </p>
        )}
      </div>
    </article>
  )
}

/**
 * One action under a post.
 *
 * The accessible name is always the full sentence — "Spark, 12 sparks" — because the visible label
 * is an icon and a bare number, and "12" on its own tells a screen reader user nothing. `aria-
 * pressed` is what conveys that the reader has already sparked it; colour alone would not.
 */
function Action({
  active,
  count: n,
  icon,
  label,
  onClick,
  to,
  word,
}: {
  active: boolean
  count: number
  icon: string
  label: string
  onClick?: (() => void) | undefined
  to?: string | undefined
  word: string
}) {
  const text = n > 0 ? count(n) : ''
  const name = n > 0 ? `${word}, ${countLabel(n, label.replace(/e?s$/, ''), label)}` : word
  const inner = (
    <>
      <span aria-hidden="true" className="ag-action__icon">
        {icon}
      </span>
      {text && <span className="ag-action__count cf-num">{text}</span>}
    </>
  )
  if (to) {
    return (
      <Link aria-label={name} className="ag-action" to={to}>
        {inner}
      </Link>
    )
  }
  return (
    <button
      aria-label={name}
      aria-pressed={active}
      className={`ag-action${active ? ' ag-action--on' : ''}`}
      onClick={onClick}
      type="button"
    >
      {inner}
    </button>
  )
}

/**
 * Who can see this. Rendered only when the answer is not "everyone".
 *
 * Three visibilities and no more — the service's `VISIBILITIES` set is `public`, `followers`,
 * `circle`. There is no unlisted post on this square, and a badge for one would be a promise about
 * a setting the composer cannot offer.
 */
function VisibilityBadge({ visibility }: { visibility: Post['visibility'] }) {
  const text = visibility === 'followers' ? 'Followers' : visibility === 'circle' ? 'Circle' : ''
  if (!text) return null
  return (
    <span className="ag-badge" title={`Visible to: ${text.toLowerCase()}`}>
      {text}
    </span>
  )
}

/* ---- reporting ------------------------------------------------------ */

/**
 * The reasons, in the words a reader would use.
 *
 * A subset of the service's seven: `impersonation`, `self_harm` and `misinformation` all exist and
 * all deserve their own handling, and offering them from a two-line inline form beside a post would
 * be offering a triage this form cannot do — `self_harm` in particular needs a response, not a
 * dropdown entry. They are reachable from the fuller report flow; "Something else" carries the rest
 * here with the detail box beneath it.
 */
const REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'abuse', label: 'Harassment or abuse' },
  { value: 'impersonation', label: 'Pretending to be someone' },
  { value: 'illegal', label: 'Illegal content' },
  { value: 'other', label: 'Something else' },
]

/**
 * Report a post, inline.
 *
 * Inline rather than in a modal on purpose: a reader reporting a post should be able to see the
 * post while they describe what is wrong with it. A dialog that covers the thing being reported
 * makes somebody write the report from memory.
 *
 * ── IT NEVER SAYS WHETHER A MODERATOR AGREED ──────────────────────────────────────────────────
 *
 * The route answers 202 `{status:'received'}` with no id and no outcome, and this says "received"
 * to match. Telling the reporter what happened next would tell them whether the person they
 * reported was actioned, which is the reported person's business. A duplicate answers identically,
 * so a second report of the same post reads as accepted rather than as an argument about whether
 * the first one was seen.
 *
 * A FAILURE IS SHOWN AS A FAILURE. An earlier draft caught the rejection and claimed success
 * anyway, on the reasoning that a reporter should not be burdened with our plumbing — which gets it
 * exactly backwards: somebody who reported abuse and was told it was received, when it was not,
 * stops watching for a response that will never come.
 */
function ReportForm({ postId, onDone }: { postId: string; onDone: () => void }) {
  const [reason, setReason] = useState<ReportReason>(REASONS[0]!.value)
  const [detail, setDetail] = useState('')
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  if (sent) {
    return (
      <p className="ag-report ag-report--done" role="status">
        Received. A moderator will look at it.
      </p>
    )
  }

  return (
    <form
      className="ag-report"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        setFailed(false)
        void fileReport({
          subjectKind: 'post',
          subjectId: postId,
          reason,
          ...(detail.trim() ? { detail: detail.trim() } : {}),
        })
          .then(() => setSent(true))
          .catch(() => setFailed(true))
          .finally(() => setBusy(false))
      }}
    >
      <label className="ag-field">
        <span className="ag-field__label">Why are you reporting this?</span>
        <select
          className="ag-select"
          onChange={(e) => setReason(e.target.value as ReportReason)}
          value={reason}
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="ag-field">
        <span className="ag-field__label">Anything to add? (optional)</span>
        <textarea
          className="ag-textarea ag-textarea--short"
          maxLength={1000}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          value={detail}
        />
      </label>
      {failed && (
        <p className="ag-report__failure" role="alert">
          That report did not reach us. Try again.
        </p>
      )}
      <div className="ag-report__actions">
        <button className="ag-btn ag-btn--quiet" onClick={onDone} type="button">
          Cancel
        </button>
        <button className="ag-btn ag-btn--primary" disabled={busy} type="submit">
          Send report
        </button>
      </div>
    </form>
  )
}
