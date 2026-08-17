/**
 * The circle directory.
 *
 * The honest answer to "what is discussed here" without naming a single person, which is why it is
 * public and indexed while the timelines around it are not. A stranger deciding whether this square
 * is for them learns more from six circle names than from forty posts.
 *
 * NOT PAGED, because the service does not page it: `listCircles` takes a limit and answers an array
 * with no cursor. There are dozens of circles on this estate and not thousands, and a cursor for a
 * list that fits on one screen is a cursor nobody ever exercises and therefore nobody ever finds
 * broken. `q` narrows it, server-side.
 */
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { circles as fetchCircles, createCircle, type Circle, type CircleVisibility } from '../lib/agora.ts'
import { useSession } from '../lib/auth.tsx'
import { count } from '../lib/format.ts'
import { useResource } from '../lib/resource.ts'
import { circlePath } from '../lib/routes.ts'
import { useTitle } from '../components/shell.tsx'
import { Empty, Failed, Loading } from '../components/states.tsx'

export default function CirclesPage() {
  useTitle('Circles')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const { status, signIn: go } = useSession()

  const list = useResource(
    useCallback((signal) => fetchCircles(q.trim() || null, { signal }), [q]),
    (data) => data.circles.length,
    'The circles did not load.',
  )

  return (
    <div className="ag-circles">
      <header className="ag-page-head">
        <h1 className="ag-page-title">Circles</h1>
        <p className="ag-page-sub">
          Rooms inside the square. A circle post goes to its members and to nobody else — which is
          what makes a circle different from a tag.
        </p>
        <div className="ag-circles__controls">
          <form
            className="ag-search ag-search--inline"
            onSubmit={(event) => {
              event.preventDefault()
              list.reload()
            }}
            role="search"
          >
            <label className="ag-vh" htmlFor="ag-circles-q">
              Search circles
            </label>
            <input
              className="ag-input"
              id="ag-circles-q"
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a circle"
              type="search"
              value={q}
            />
            <button className="ag-btn" type="submit">
              Search
            </button>
          </form>
          <button
            className="ag-btn ag-btn--primary"
            onClick={() => (status === 'in' ? setCreating((on) => !on) : go())}
            type="button"
          >
            {creating ? 'Cancel' : 'Start a circle'}
          </button>
        </div>
      </header>

      {creating && <NewCircle onDone={() => { setCreating(false); list.reload() }} />}

      {list.state === 'loading' && <Loading label="Loading circles" />}
      {list.state === 'failed' && (
        <Failed message={list.error?.message} onRetry={list.reload} requestId={list.error?.requestId} />
      )}
      {list.state === 'empty' && (
        <Empty
          action={
            <button className="ag-btn ag-btn--primary" onClick={() => (status === 'in' ? setCreating(true) : go())} type="button">
              Start the first one
            </button>
          }
          glyph="◍"
          hint={q ? 'Nothing matches that. Try a shorter word.' : 'A circle is a room with its own members and its own posts. Somebody has to make the first one.'}
          title={q ? 'No circles match' : 'No circles yet'}
        />
      )}
      {list.state === 'ok' && list.data && (
        <ul className="ag-circle-grid">
          {list.data.circles.map((c) => (
            <li key={c.id}>
              <CircleCard circle={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CircleCard({ circle }: { circle: Circle }) {
  return (
    <Link className={`ag-circle-card${circle.archived ? ' is-archived' : ''}`} to={circlePath(circle.slug)}>
      <span className="ag-circle-card__head">
        {circle.avatarUrl ? (
          <img alt="" className="ag-circle-card__avatar" loading="lazy" src={circle.avatarUrl} />
        ) : (
          <span aria-hidden="true" className="ag-circle-card__avatar ag-circle-card__avatar--none">
            ◍
          </span>
        )}
        <span className="ag-circle-card__name">{circle.name}</span>
      </span>
      {circle.purpose && <span className="ag-circle-card__purpose">{circle.purpose}</span>}
      <span className="ag-circle-card__facts">
        <span className="cf-num">{count(circle.members) || '0'}</span>{' '}
        {circle.members === 1 ? 'member' : 'members'}
        <span aria-hidden="true"> · </span>
        <DoorLabel visibility={circle.visibility} />
        {circle.archived && <span className="ag-badge ag-badge--quiet">Archived</span>}
      </span>
    </Link>
  )
}

/** The door, in words rather than in the enum's. `closed` still admits — by invitation. */
function DoorLabel({ visibility }: { visibility: CircleVisibility }) {
  return (
    <span className="ag-circle-card__door">
      {visibility === 'open'
        ? 'Anyone can join'
        : visibility === 'request'
          ? 'A steward admits members'
          : 'By invitation'}
    </span>
  )
}

/**
 * Make one.
 *
 * THE SLUG IS ASKED FOR, not derived. The service requires it and does not mint one from the name,
 * and that division is correct: the slug is the permanent address of the circle, and a name-derived
 * slug produces `/circles/mining--rigs-2` the first time somebody types a stray character or picks a
 * name that is already taken. So it is suggested from the name, shown, and editable before the
 * circle exists — after which it cannot be changed.
 */
function NewCircle({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [touchedSlug, setTouchedSlug] = useState(false)
  const [purpose, setPurpose] = useState('')
  const [visibility, setVisibility] = useState<CircleVisibility>('open')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const suggested = touchedSlug ? slug : slugify(name)

  return (
    <form
      className="ag-panel ag-new-circle"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        setFailure(null)
        void createCircle({
          slug: suggested,
          name: name.trim(),
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
          visibility,
        })
          .then(onDone)
          .catch((err: unknown) => setFailure(err instanceof Error ? err.message : 'That did not work.'))
          .finally(() => setBusy(false))
      }}
    >
      <h2 className="ag-panel__title">Start a circle</h2>

      <label className="ag-field">
        <span className="ag-field__label">What is it called?</span>
        <input
          className="ag-input"
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          required
          type="text"
          value={name}
        />
      </label>

      <label className="ag-field">
        <span className="ag-field__label">Its address</span>
        <span className="ag-field__prefix">
          /circles/
          <input
            className="ag-input ag-input--slug"
            maxLength={48}
            onChange={(e) => {
              setTouchedSlug(true)
              setSlug(slugify(e.target.value))
            }}
            pattern="[a-z0-9][a-z0-9-]*"
            required
            type="text"
            value={suggested}
          />
        </span>
        <span className="ag-field__hint">This cannot be changed later. The name can.</span>
      </label>

      <label className="ag-field">
        <span className="ag-field__label">What is it for? (optional)</span>
        <textarea
          className="ag-textarea ag-textarea--short"
          maxLength={280}
          onChange={(e) => setPurpose(e.target.value)}
          rows={2}
          value={purpose}
        />
      </label>

      <fieldset className="ag-field">
        <legend className="ag-field__label">Who can join?</legend>
        {(
          [
            ['open', 'Anyone', 'They press Join and they are in.'],
            ['request', 'People a steward admits', 'Joining asks; you decide.'],
            ['closed', 'Only people you invite', 'Nobody can ask.'],
          ] as const
        ).map(([value, label, hint]) => (
          <label className="ag-radio" key={value}>
            <input
              checked={visibility === value}
              name="visibility"
              onChange={() => setVisibility(value)}
              type="radio"
              value={value}
            />
            <span className="ag-radio__label">{label}</span>
            <span className="ag-radio__hint">{hint}</span>
          </label>
        ))}
      </fieldset>

      {failure && (
        <p className="ag-panel__failure" role="alert">
          {failure}
        </p>
      )}

      <div className="ag-panel__actions">
        <button className="ag-btn ag-btn--primary" disabled={busy || !name.trim() || !suggested} type="submit">
          {busy ? 'Creating…' : 'Create the circle'}
        </button>
      </div>
    </form>
  )
}

/** A name to an address: lower case, words joined by hyphens, nothing else. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
