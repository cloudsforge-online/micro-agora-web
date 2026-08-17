/**
 * What happened while the reader was away.
 *
 * ── READING THE PAGE IS NOT MARKING IT READ ───────────────────────────────────────────────────
 *
 * Most networks clear the badge the instant the list paints. It is convenient and it loses things:
 * somebody who opens the page on a phone, reads two lines and locks the screen has just been told
 * they have seen everything, and the eleven notifications they did not read are now indistinguishable
 * from the ones they did. So this page marks a row read when the reader OPENS it, and offers "Mark
 * all read" as a deliberate press. The badge in the chrome goes down when something is actually
 * dealt with.
 *
 * ── THE UNREAD COUNT IS CORRECTED, NOT GUESSED ────────────────────────────────────────────────
 *
 * `PUT /v1/notifications/read` answers `{marked}` — how many rows it actually changed. That number
 * is subtracted from `me.unread.notifications` rather than the badge being set to zero, because a
 * notification that arrived between the fetch and the press is still unread and a zeroed badge would
 * hide it until the next reload.
 */
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  answerFollowRequest,
  markNotificationsRead,
  notifications,
  type Notification,
  type NotificationKind,
} from '../lib/agora.ts'
import { RequireSession, useVoice } from '../lib/auth.tsx'
import { ago, at, exact } from '../lib/format.ts'
import { usePaged } from '../lib/resource.ts'
import { circlePath, postPath, voicePath, whisperPath } from '../lib/routes.ts'
import { Avatar } from '../components/post.tsx'
import { useTitle } from '../components/shell.tsx'
import { Empty, Failed, Loading } from '../components/states.tsx'

export default function NotificationsPage() {
  useTitle('Notifications')
  return (
    <RequireSession what="see your notifications">
      <List />
    </RequireSession>
  )
}

function List() {
  const { me, set } = useVoice()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [marking, setMarking] = useState(false)

  const rows = usePaged<Notification>(
    useCallback(
      (cursor, signal) =>
        notifications(cursor, unreadOnly, { signal }).then((p) => ({
          items: p.notifications,
          nextCursor: p.nextCursor,
        })),
      [unreadOnly],
    ),
    'Your notifications did not load.',
  )

  // Once for the whole page — see the note on `ago` in lib/format.ts.
  const now = Date.now()

  /** Subtract what the service says it changed, floored at zero. Never set to a guessed number. */
  const countDown = (marked: number) => {
    if (!me || marked === 0) return
    set({
      ...me,
      unread: {
        ...me.unread,
        notifications: Math.max(0, me.unread.notifications - marked),
      },
    })
  }

  const markOne = (row: Notification) => {
    if (row.readAt !== null) return
    // Optimistic: the row goes grey immediately. A failure leaves the badge alone rather than
    // rolling the row back — the reader has read it either way, and a row that un-greys itself
    // under the cursor is more alarming than a count that is one too high until the next load.
    rows.replace((r) => r.id === row.id, { ...row, readAt: new Date().toISOString() })
    void markNotificationsRead(row.id)
      .then(({ marked }) => countDown(marked))
      .catch(() => {})
  }

  const markAll = () => {
    setMarking(true)
    void markNotificationsRead()
      .then(({ marked }) => {
        countDown(marked)
        rows.reload()
      })
      .catch(() => {})
      .finally(() => setMarking(false))
  }

  const unread = me?.unread.notifications ?? 0

  return (
    <div className="ag-notifications">
      <header className="ag-page-head">
        <h1 className="ag-page-title">Notifications</h1>
        <div className="ag-notifications__controls">
          <div className="ag-tabs" role="tablist">
            <button
              aria-selected={!unreadOnly}
              className={`ag-tab${unreadOnly ? '' : ' is-on'}`}
              onClick={() => setUnreadOnly(false)}
              role="tab"
              type="button"
            >
              Everything
            </button>
            <button
              aria-selected={unreadOnly}
              className={`ag-tab${unreadOnly ? ' is-on' : ''}`}
              onClick={() => setUnreadOnly(true)}
              role="tab"
              type="button"
            >
              Unread{unread > 0 && <span className="ag-tab__count cf-num"> {unread}</span>}
            </button>
          </div>
          <button className="ag-btn" disabled={marking || unread === 0} onClick={markAll} type="button">
            {marking ? 'Marking…' : 'Mark all read'}
          </button>
        </div>
      </header>

      {rows.state === 'loading' && <Loading label="Loading your notifications" />}
      {rows.state === 'failed' && (
        <Failed message={rows.error?.message} onRetry={rows.reload} requestId={rows.error?.requestId} />
      )}
      {rows.state === 'empty' && (
        <Empty
          action={
            unreadOnly ? (
              <button className="ag-btn" onClick={() => setUnreadOnly(false)} type="button">
                Show everything
              </button>
            ) : (
              <Link className="ag-btn" to="/">
                Read the square
              </Link>
            )
          }
          glyph="◉"
          hint={
            unreadOnly
              ? 'Everything here has been read.'
              : 'When somebody replies to you, follows you or mentions you, it turns up here.'
          }
          title={unreadOnly ? 'Nothing unread' : 'Nothing yet'}
        />
      )}
      {rows.state === 'ok' && (
        <ol className="ag-notif-list">
          {rows.items.map((row) => (
            <li key={row.id}>
              <Row
                now={now}
                onAnswered={() => {
                  markOne(row)
                  rows.reload()
                }}
                onOpen={() => markOne(row)}
                row={row}
              />
            </li>
          ))}
        </ol>
      )}
      {rows.state === 'ok' && rows.cursor !== null && (
        <div className="ag-more">
          <button className="ag-btn" disabled={rows.loadingMore} onClick={rows.more} type="button">
            {rows.loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}

function Row({
  row,
  now,
  onOpen,
  onAnswered,
}: {
  row: Notification
  now: number
  onOpen: () => void
  onAnswered: () => void
}) {
  const who = row.actor?.displayName || (row.actor ? at(row.actor.handle) : 'CloudsForge')
  const to = destination(row)

  const inner = (
    <>
      <span aria-hidden="true" className={`ag-notif__glyph ag-notif__glyph--${row.kind}`}>
        {GLYPH[row.kind]}
      </span>
      {row.actor ? (
        <Avatar
          avatarUrl={row.actor.avatarUrl}
          displayName={row.actor.displayName}
          handle={row.actor.handle}
          size="sm"
        />
      ) : (
        <span aria-hidden="true" className="ag-notif__estate">
          ⁂
        </span>
      )}
      <span className="ag-notif__said">
        <span className="ag-notif__who">{who}</span> {SENTENCE[row.kind]}
        {/*
          `detail` is a sentence the service wrote — the moderator's reason, the circle's name, the
          first line of what was said. Rendered as text, never as markup, and never invented here
          when it is empty (which it is for most kinds).
        */}
        {row.detail && <span className="ag-notif__detail">{row.detail}</span>}
      </span>
      <time className="ag-notif__when" dateTime={row.createdAt} title={exact(row.createdAt)}>
        {ago(row.createdAt, now)}
      </time>
    </>
  )

  return (
    <div className={`ag-notif${row.readAt === null ? ' is-unread' : ''}`}>
      {to === null ? (
        // Nothing to open — a moderation outcome with no subject the reader may read. Marking it
        // read still has to be possible, so the row itself is the control.
        <button className="ag-notif__body" onClick={onOpen} type="button">
          {inner}
        </button>
      ) : (
        <Link className="ag-notif__body" onClick={onOpen} to={to}>
          {inner}
        </Link>
      )}

      {/*
        A follow request is the one notification with a decision inside it. Answering from here is
        the whole point: the alternative is going to the person's profile, which is three presses
        away and shows a page that does not mention the request at all.
      */}
      {row.kind === 'follow_request' && row.actor && (
        <span className="ag-notif__actions">
          <button
            className="ag-btn ag-btn--primary ag-btn--quiet"
            onClick={() =>
              void answerFollowRequest(row.actor?.handle ?? '', true).then(onAnswered).catch(() => {})
            }
            type="button"
          >
            Let them follow
          </button>
          <button
            className="ag-btn ag-btn--quiet"
            onClick={() =>
              void answerFollowRequest(row.actor?.handle ?? '', false).then(onAnswered).catch(() => {})
            }
            type="button"
          >
            Refuse
          </button>
        </span>
      )}
    </div>
  )
}

/**
 * Where a notification takes you.
 *
 * A post id wins over everything else — a reply, a mention, a quote and a spark are all about a
 * post, and the reader wants the conversation rather than the person. `moderation` deliberately
 * falls through to null when it names nothing the reader may open.
 */
function destination(row: Notification): string | null {
  if (row.postId) return postPath(row.postId)
  if (row.threadId) return whisperPath(row.threadId)
  if (row.circleId) return circlePath(row.circleId)
  if (row.actor) return voicePath(row.actor.handle)
  return null
}

/** One glyph per kind. The same marks the post footer uses, so the two read as one language. */
const GLYPH: Record<NotificationKind, string> = {
  reply: '↩',
  quote: '❞',
  echo: '↻',
  spark: '✧',
  mention: '@',
  follow: '＋',
  follow_request: '?',
  follow_accepted: '✓',
  whisper: '✉',
  circle_invite: '◍',
  circle_request: '◍',
  circle_accepted: '◍',
  moderation: '⚖',
}

/**
 * What happened, in words, with the actor's name already said before it.
 *
 * Past tense and no full stop: the row ends with a timestamp, and a sentence that closes itself
 * before the time reads as two separate statements.
 */
const SENTENCE: Record<NotificationKind, string> = {
  reply: 'replied to you',
  quote: 'quoted your post',
  echo: 'echoed your post',
  spark: 'sparked your post',
  mention: 'mentioned you',
  follow: 'followed you',
  follow_request: 'asked to follow you',
  follow_accepted: 'accepted your follow',
  whisper: 'whispered to you',
  circle_invite: 'invited you to a circle',
  circle_request: 'asked to join your circle',
  circle_accepted: 'let you into a circle',
  moderation: 'acted on something of yours',
}
