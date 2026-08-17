/**
 * The Square — everything public on the viewed network, newest first.
 *
 * This is the index, and it is a TIMELINE rather than a sign-up page. Every other social network's
 * front door is a wall with a form on it, because the account is the thing they need from you. This
 * estate already has the account: a reader arriving here is either signed in already or one press
 * away, and what they need is to see whether there is anything here worth signing in for. So the
 * first thing on the screen is what people are saying.
 *
 * `latest` sends the bearer when there is one — the reader's own bars and hushes then apply to the
 * public timeline too, which is what makes "I blocked that person" mean something outside their own
 * feed — and returns the same page without those filters to a stranger.
 */
import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { latest, type Post } from '../lib/agora.ts'
import { useSession } from '../lib/auth.tsx'
import { usePaged } from '../lib/resource.ts'
import { viewedNetwork } from '../lib/viewed.ts'
import { Composer } from '../components/composer.tsx'
import { useTitle } from '../components/shell.tsx'
import { Empty } from '../components/states.tsx'
import { Timeline } from '../components/timeline.tsx'

export default function SquarePage() {
  useTitle(null)
  const { status, signIn: go } = useSession()
  const posts = usePaged<Post>(
    useCallback(
      (cursor, signal) => latest(cursor, { signal }).then((p) => ({ items: p.posts, nextCursor: p.nextCursor })),
      [],
    ),
    'The square did not load.',
  )

  return (
    <Timeline
      empty={
        <Empty
          action={
            status === 'in' ? null : (
              <button className="ag-btn ag-btn--primary" onClick={() => go()} type="button">
                Sign in and start it
              </button>
            )
          }
          glyph="⁂"
          hint={
            viewedNetwork() === 'testnet'
              ? 'This is the testnet square. It starts empty every time the test network is reset, which is what a test network is for.'
              : 'Nobody has posted here yet. The first post on a square is the hardest one, and it is also the one everybody else replies to.'
          }
          title="The square is quiet"
        />
      }
      header={
        <>
          <header className="ag-page-head">
            <h1 className="ag-page-title">The Square</h1>
            <p className="ag-page-sub">
              Everything posted in the open, newest first. Talk about crypto, the ecosystem, or
              whatever else — the <Link to="/guidelines">guidelines</Link> are short.
            </p>
          </header>
          {/*
            A post the reader just wrote goes to the top of the list they are looking at, even when
            its audience is narrower than this page — a followers-only post prepended onto the public
            Square. That is deliberate: the alternative is a composer that clears itself and shows
            nothing, which reads as having failed. `PostCard` renders the audience badge, so what is
            on screen says "Followers" beside it rather than pretending it is public. A refresh puts
            the page back to what the square actually holds.
          */}
          <Composer onPosted={(post) => posts.prepend(post, (a, b) => a.id === b.id)} />
        </>
      }
      loadingLabel="Loading the square"
      posts={posts}
    />
  )
}
