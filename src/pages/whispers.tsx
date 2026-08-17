/**
 * Private messages.
 *
 * ── ONE ADDRESS, TWO PANES ────────────────────────────────────────────────────────────────────
 *
 * `/whispers?t=<threadId>` and not `/whispers/<threadId>` — see `lib/routes.ts::whisperPath`. A path
 * segment is what a browser puts in its history, in a referrer and in the address bar of a screen
 * somebody is sharing; the id of a private conversation belongs in neither. The list is the chooser,
 * the parameter is the choice, and `robots.txt` disallows the whole path besides.
 *
 * ── THE NEWEST MESSAGE IS AT THE BOTTOM, WHICH THE SERVICE DOES NOT DO ────────────────────────
 *
 * `GET /v1/whispers/:id` pages NEWEST FIRST, like every other list in this service, because that is
 * what a cursor over `created_at DESC` gives you. A conversation read newest-first is unreadable, so
 * this page reverses what it holds for display and keeps "load more" meaning "further back". The
 * reversal is at the render, not in the store: the cursor still walks the direction the service
 * pages in, and inverting the store would put the seam in the wrong place.
 *
 * ── AND A RETRY CAN DOUBLE-SEND ───────────────────────────────────────────────────────────────
 *
 * `POST /v1/whispers` reads no idempotency key. There is therefore no safe automatic retry, and the
 * send control is disabled until the request settles rather than offering a Try again that could
 * deliver the same sentence twice. Documented on `sendWhisper` in `lib/agora.ts`.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  deleteWhisper,
  leaveThread,
  markThreadRead,
  sendWhisper,
  threads as fetchThreads,
  whispers as fetchWhispers,
  type Thread,
  type Whisper,
} from '../lib/agora.ts'
import { RequireSession, useVoice } from '../lib/auth.tsx'
import { ago, at, exact } from '../lib/format.ts'
import { usePaged, useResource } from '../lib/resource.ts'
import { voicePath } from '../lib/routes.ts'
import { Avatar } from '../components/post.tsx'
import { useTitle } from '../components/shell.tsx'
import { Empty, Failed, Loading, Suspended } from '../components/states.tsx'
import { viewedNetwork } from '../lib/viewed.ts'

export default function WhispersPage() {
  useTitle('Whispers')
  return (
    <RequireSession what="send and read whispers">
      <Whispers />
    </RequireSession>
  )
}

function Whispers() {
  const [params, setParams] = useSearchParams()
  const chosen = params.get('t')

  const list = useResource(
    useCallback((signal) => fetchThreads({ signal }), []),
    (data) => data.threads.length,
    'Your whispers did not load.',
  )

  const open = (id: string) => setParams({ t: id }, { replace: true })

  // Read once for the whole list rather than once per row — see the note on `ago` in lib/format.ts.
  const now = Date.now()

  return (
    <div className={`ag-whispers${chosen ? ' is-open' : ''}`}>
      <aside className="ag-whispers__list">
        <header className="ag-page-head ag-page-head--tight">
          <h1 className="ag-page-title">Whispers</h1>
          <p className="ag-page-sub">Only the two of you can read these.</p>
        </header>

        {list.state === 'loading' && <Loading label="Loading your whispers" />}
        {list.state === 'failed' && (
          <Failed message={list.error?.message} onRetry={list.reload} requestId={list.error?.requestId} />
        )}
        {list.state === 'empty' && (
          <Empty
            action={
              <Link className="ag-btn" to="/">
                Find somebody to talk to
              </Link>
            }
            glyph="✉"
            hint="Open somebody's profile and press Whisper. Who may whisper you is your choice, in settings."
            title="No whispers yet"
          />
        )}
        {list.state === 'ok' && list.data && (
          <ul className="ag-thread-list">
            {list.data.threads.map((thread) => (
              <li key={thread.id}>
                <ThreadRow
                  chosen={thread.id === chosen}
                  now={now}
                  onOpen={() => open(thread.id)}
                  thread={thread}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="ag-whispers__pane">
        {chosen === null ? (
          <Empty
            glyph="✉"
            hint="Pick a conversation on the left."
            title="Nothing open"
          />
        ) : (
          <Conversation
            // Remount on a thread change rather than reacting to it. The pane holds a draft, a
            // scroll position and a page of messages, and every one of them belongs to one thread.
            key={chosen}
            onLeft={() => {
              setParams({}, { replace: true })
              list.reload()
            }}
            onRead={list.reload}
            thread={list.data?.threads.find((t) => t.id === chosen) ?? null}
            threadId={chosen}
          />
        )}
      </section>
    </div>
  )
}

function ThreadRow({
  thread,
  chosen,
  now,
  onOpen,
}: {
  thread: Thread
  chosen: boolean
  now: number
  onOpen: () => void
}) {
  return (
    // `ag-convo-row`, NOT `ag-thread`. A whisper thread and a reply thread are different things with
    // the same English name, and `pages/thread.tsx` already owns `.ag-thread` for the conversation
    // PAGE. Two blocks under one class name in one stylesheet is a rule written for one of them
    // landing on the other, which is the kind of defect that gets fixed by adding a scope and then
    // re-broken by the next person who moves the markup.
    <button
      className={`ag-convo-row${chosen ? ' is-on' : ''}${thread.unread > 0 ? ' is-unread' : ''}`}
      onClick={onOpen}
      type="button"
    >
      <Avatar
        avatarUrl={thread.other.avatarUrl}
        displayName={thread.other.displayName}
        handle={thread.other.handle}
        size="md"
      />
      <span className="ag-convo-row__who">
        <span className="ag-convo-row__name">
          {thread.other.displayName || at(thread.other.handle)}
        </span>
        <span className="ag-convo-row__preview">{thread.preview}</span>
      </span>
      <span className="ag-convo-row__meta">
        <time dateTime={thread.lastPostAt} title={exact(thread.lastPostAt)}>
          {ago(thread.lastPostAt, now)}
        </time>
        {thread.unread > 0 && <span className="ag-convo-row__unread cf-num">{thread.unread}</span>}
      </span>
    </button>
  )
}

function Conversation({
  threadId,
  thread,
  onRead,
  onLeft,
}: {
  threadId: string
  thread: Thread | null
  onRead: () => void
  onLeft: () => void
}) {
  const { me, set, suspended } = useVoice()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const foot = useRef<HTMLDivElement | null>(null)

  const messages = usePaged<Whisper>(
    useCallback(
      (cursor, signal) =>
        fetchWhispers(threadId, cursor, { signal }).then((p) => ({
          items: p.whispers,
          nextCursor: p.nextCursor,
        })),
      [threadId],
    ),
    'That conversation did not load.',
  )

  // Opening a thread IS reading it — unlike the notifications page, where the rows are separate
  // things and opening the list is not opening any of them. The badge is corrected from the count
  // the list already reported rather than being zeroed.
  const unread = thread?.unread ?? 0
  useEffect(() => {
    if (unread === 0) return
    void markThreadRead(threadId)
      .then(() => {
        onRead()
        if (me) {
          set({
            ...me,
            unread: { ...me.unread, whispers: Math.max(0, me.unread.whispers - unread) },
          })
        }
      })
      .catch(() => {})
    // `me`/`set`/`onRead` are deliberately absent: this runs once per thread open. Including `me`
    // would re-run it on every unrelated voice reload and mark the thread read repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, unread])

  // The newest message is at the bottom, so an opened conversation starts scrolled to it. `auto`
  // rather than `smooth`: this is the arrival position, not a movement the reader asked for.
  useEffect(() => {
    if (messages.state === 'ok') foot.current?.scrollIntoView({ block: 'end' })
  }, [messages.state])

  const send = (event: FormEvent) => {
    event.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setFailure(null)
    void sendWhisper(thread?.other.handle ?? threadId, body)
      .then(({ whisper }) => {
        setDraft('')
        messages.prepend(whisper, (a, b) => a.id === b.id)
        onRead()
        window.requestAnimationFrame(() => foot.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }))
      })
      .catch((err: unknown) =>
        setFailure(
          err instanceof Error
            ? `${err.message} Your message is still in the box — check the conversation before sending it again.`
            : 'That did not send.',
        ),
      )
      .finally(() => setSending(false))
  }

  const mine = me?.voice.id ?? null
  // Reversed for display only — see the file header.
  const shown = [...messages.items].reverse()
  const now = Date.now()

  return (
    <div className="ag-convo">
      <header className="ag-convo__head">
        {thread ? (
          <Link className="ag-convo__who" to={voicePath(thread.other.handle)}>
            <Avatar
              avatarUrl={thread.other.avatarUrl}
              displayName={thread.other.displayName}
              handle={thread.other.handle}
              size="sm"
            />
            <span className="ag-convo__name">{thread.other.displayName || at(thread.other.handle)}</span>
            <span className="ag-convo__handle">{at(thread.other.handle)}</span>
          </Link>
        ) : (
          <span className="ag-convo__name">Conversation</span>
        )}
        <button
          className="ag-btn ag-btn--quiet"
          onClick={() => void leaveThread(threadId).then(onLeft).catch(() => {})}
          // Said in full rather than as "Delete": this removes the thread from the reader's list
          // and from nowhere else, and a control labelled Delete would be read as removing it for
          // both people — which it does not do.
          title="Removes it from your list. The other person keeps their copy."
          type="button"
        >
          Leave this conversation
        </button>
      </header>

      {messages.state === 'loading' && <Loading label="Loading the conversation" />}
      {messages.state === 'failed' && (
        <Failed
          message={messages.error?.message}
          onRetry={messages.reload}
          requestId={messages.error?.requestId}
        />
      )}
      {(messages.state === 'ok' || messages.state === 'empty') && (
        <div className="ag-convo__body">
          {messages.cursor !== null && (
            <div className="ag-more ag-more--up">
              <button className="ag-btn" disabled={messages.loadingMore} onClick={messages.more} type="button">
                {messages.loadingMore ? 'Loading…' : 'Earlier messages'}
              </button>
            </div>
          )}
          {messages.state === 'empty' && (
            <Empty glyph="✉" hint="Say the first thing." title="Nothing said yet" />
          )}
          <ol className="ag-convo__list">
            {shown.map((whisper) => (
              <li key={whisper.id}>
                <Bubble
                  mine={whisper.voiceId === mine}
                  now={now}
                  onDeleted={() => messages.replace((w) => w.id === whisper.id, { ...whisper, deleted: true, body: '' })}
                  whisper={whisper}
                />
              </li>
            ))}
          </ol>
          <div ref={foot} />
        </div>
      )}

      {suspended ? (
        <Suspended network={viewedNetwork() === 'testnet' ? 'Testnet' : 'Mainnet'} />
      ) : (
        <form className="ag-convo__compose" onSubmit={send}>
          <label className="ag-vh" htmlFor="ag-whisper-body">
            Your message
          </label>
          <textarea
            className="ag-textarea ag-textarea--short"
            id="ag-whisper-body"
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(e)
            }}
            placeholder="Say something"
            rows={2}
            value={draft}
          />
          <button className="ag-btn ag-btn--primary" disabled={sending || draft.trim() === ''} type="submit">
            {sending ? 'Sending…' : 'Send'}
          </button>
          {failure && (
            <p className="ag-convo__failure" role="alert">
              {failure}
            </p>
          )}
        </form>
      )}
    </div>
  )
}

/**
 * One message.
 *
 * A DELETED message leaves its bubble behind, saying so. Removing the row entirely would renumber
 * a conversation somebody is reading and hide that anything was there — and the service keeps the
 * row for exactly that reason. Deleting is offered on the reader's own messages only, because
 * `DELETE /v1/whispers/messages/:id` refuses anybody else's.
 */
function Bubble({
  whisper,
  mine,
  now,
  onDeleted,
}: {
  whisper: Whisper
  mine: boolean
  now: number
  onDeleted: () => void
}) {
  if (whisper.deleted) {
    return (
      <p className={`ag-bubble ag-bubble--gone${mine ? ' is-mine' : ''}`}>
        <span className="ag-bubble__gone">This message was deleted</span>
      </p>
    )
  }
  return (
    <div className={`ag-bubble${mine ? ' is-mine' : ''}`}>
      {/* Plain text. There is no markup in a whisper and never has been — see `post.tsx::Body`. */}
      <p className="ag-bubble__body">{whisper.body}</p>
      <p className="ag-bubble__meta">
        <time dateTime={whisper.createdAt} title={exact(whisper.createdAt)}>
          {ago(whisper.createdAt, now)}
        </time>
        {mine && (
          <button
            className="ag-bubble__delete"
            onClick={() => void deleteWhisper(whisper.id).then(onDeleted).catch(() => {})}
            type="button"
          >
            Delete
          </button>
        )}
      </p>
    </div>
  )
}
