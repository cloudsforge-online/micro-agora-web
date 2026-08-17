/**
 * Home — the voices the reader follows and the circles they are in.
 *
 * A separate ADDRESS from the Square rather than a tab of it, because they are different resources
 * and because of what happens at the edges of a session: a reader who signs out mid-scroll on `/`
 * keeps reading, and one who signs out here lands on a page that is honestly about them and can say
 * so. A tab would have had to decide which of those two things it was.
 *
 * It is chronological and it has no ranking. On a square this size a ranking model would be
 * re-ordering forty posts by twelve people, and the cost of that — that a reader can no longer tell
 * whether they have seen everything — is paid immediately while the benefit never arrives.
 */
import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { home, type Post } from '../lib/agora.ts'
import { RequireSession } from '../lib/auth.tsx'
import { usePaged } from '../lib/resource.ts'
import { Composer } from '../components/composer.tsx'
import { useTitle } from '../components/shell.tsx'
import { Empty } from '../components/states.tsx'
import { Timeline } from '../components/timeline.tsx'

export default function HomePage() {
  useTitle('Home')
  return (
    <RequireSession what="see your own timeline">
      <Feed />
    </RequireSession>
  )
}

function Feed() {
  const posts = usePaged<Post>(
    useCallback(
      (cursor, signal) => home(cursor, { signal }).then((p) => ({ items: p.posts, nextCursor: p.nextCursor })),
      [],
    ),
    'Your timeline did not load.',
  )

  return (
    <Timeline
      empty={
        <Empty
          action={
            <div className="ag-state__actions">
              <Link className="ag-btn ag-btn--primary" to="/">
                Read the square
              </Link>
              <Link className="ag-btn" to="/circles">
                Find a circle
              </Link>
            </div>
          }
          glyph="◈"
          hint="This fills up as you follow people and join circles. Until then the Square has everything that is public."
          title="Nothing here yet"
        />
      }
      header={
        <>
          <header className="ag-page-head">
            <h1 className="ag-page-title">Home</h1>
            <p className="ag-page-sub">The people you follow and the circles you are in.</p>
          </header>
          <Composer onPosted={(post) => posts.prepend(post, (a, b) => a.id === b.id)} />
        </>
      }
      loadingLabel="Loading your timeline"
      posts={posts}
    />
  )
}
