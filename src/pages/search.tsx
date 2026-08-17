/**
 * Search — posts on one side, people on the other, paged independently.
 *
 * `GET /v1/search` returns POSTS ONLY. It is not an oversight in the service and it is not worked
 * around here by a client-side merge: people are a different resource with a different ranking and a
 * different privacy rule (`discoverable: false` takes a voice out of the directory without hiding
 * their profile), so they come from `GET /v1/voices?q=` and are rendered as their own list. Merging
 * the two into one relevance-ordered stream would mean inventing a comparison between "a post that
 * mentions mining" and "somebody called @mining", which nothing here is qualified to make.
 *
 * ── THE QUERY IS IN THE URL, AND THE URL IS NOT REPORTED ──────────────────────────────────────
 *
 * `?q=` is what makes a search shareable and re-runnable, which is the whole reason it is a query
 * parameter rather than component state. It is also somebody's search history, so `lib/analytics.ts`
 * and `lib/obs.ts` report the route PATTERN — `/search` — and never the address. `robots.txt`
 * disallows this path outright: the query space is infinite and every crawl of it is a full-text
 * scan of the whole square.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { search, voices, type Post, type Voice } from '../lib/agora.ts'
import { at } from '../lib/format.ts'
import { usePaged } from '../lib/resource.ts'
import { voicePath } from '../lib/routes.ts'
import { Avatar } from '../components/post.tsx'
import { useTitle } from '../components/shell.tsx'
import { Empty, Loading } from '../components/states.tsx'
import { Timeline } from '../components/timeline.tsx'

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  useTitle(q ? `Search: ${q}` : 'Search')

  const [draft, setDraft] = useState(q)
  // The box follows the address, not the other way round: arriving from the rail's search, from a
  // link somebody shared, or from the back button all have to fill it in.
  useEffect(() => setDraft(q), [q])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = draft.trim()
    // `replace` so that typing three queries in a row leaves one entry in history rather than three
    // — the back button should leave the search, not walk back through the reader's own typing.
    setParams(trimmed ? { q: trimmed } : {}, { replace: true })
  }

  return (
    <div className="ag-search-page">
      <header className="ag-page-head">
        <h1 className="ag-page-title">Search</h1>
        <form className="ag-search ag-search--page" onSubmit={submit} role="search">
          <label className="ag-vh" htmlFor="ag-search-page-input">
            Search the square
          </label>
          <input
            autoFocus
            className="ag-input"
            id="ag-search-page-input"
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Posts, people, tags"
            type="search"
            value={draft}
          />
          <button className="ag-btn ag-btn--primary" type="submit">
            Search
          </button>
        </form>
      </header>

      {q === '' ? (
        <Empty
          glyph="⌕"
          hint="Search runs over every public post on this network, and over the people who have chosen to be findable."
          title="Type something to search for"
        />
      ) : (
        <div className="ag-search-page__results">
          <People q={q} />
          <Posts q={q} />
        </div>
      )}
    </div>
  )
}

function Posts({ q }: { q: string }) {
  const posts = usePaged<Post>(
    useCallback(
      (cursor, signal) => search(q, cursor, { signal }).then((p) => ({ items: p.posts, nextCursor: p.nextCursor })),
      [q],
    ),
    'That search did not run.',
  )

  return (
    <section aria-labelledby="ag-search-posts">
      <h2 className="ag-section-title" id="ag-search-posts">
        Posts
      </h2>
      <Timeline
        empty={
          <Empty
            glyph="⌕"
            hint="Try fewer words, or a tag."
            title={`No posts match “${q}”`}
          />
        }
        loadingLabel="Searching"
        posts={posts}
      />
    </section>
  )
}

/**
 * People, from the directory.
 *
 * A voice that has turned off `discoverable` is not here and their profile still works — the
 * distinction is between being listed and being reachable, and it is theirs to make. Nothing on this
 * page says how many were excluded, because saying so would be a count of the people who asked not
 * to be counted.
 */
function People({ q }: { q: string }) {
  const found = usePaged<Voice>(
    useCallback(
      (cursor, signal) =>
        voices(q, cursor, { signal }).then((p) => ({ items: p.voices, nextCursor: p.nextCursor })),
      [q],
    ),
    'The people search did not run.',
  )

  if (found.state === 'loading') return <Loading label="Looking for people" />
  // Silent when there is nobody, and silent when it fails. The posts below are the answer the reader
  // asked for; an error box about the other list would be read as being about them.
  if (found.state !== 'ok') return null

  return (
    <section aria-labelledby="ag-search-people" className="ag-people">
      <h2 className="ag-section-title" id="ag-search-people">
        People
      </h2>
      <ul className="ag-people__list">
        {found.items.map((voice) => (
          <li key={voice.id}>
            <Link className="ag-people__row" to={voicePath(voice.handle)}>
              <Avatar
                avatarUrl={voice.avatarUrl}
                displayName={voice.displayName}
                handle={voice.handle}
                size="sm"
              />
              <span className="ag-people__names">
                <span className="ag-people__name">{voice.displayName || at(voice.handle)}</span>
                <span className="ag-people__handle">{at(voice.handle)}</span>
              </span>
              {voice.bio && <span className="ag-people__bio">{voice.bio}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {found.cursor !== null && (
        <div className="ag-more">
          <button className="ag-btn" disabled={found.loadingMore} onClick={found.more} type="button">
            {found.loadingMore ? 'Loading…' : 'More people'}
          </button>
        </div>
      )}
    </section>
  )
}
