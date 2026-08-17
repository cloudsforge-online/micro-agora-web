/**
 * What the reader saved.
 *
 * A BOOKMARK IS NOT A SPARK, and keeping the two apart is one of the few places this surface is
 * deliberately unlike the networks it is modelled on. A Spark is public: it has a count, the author
 * sees it, and it is a small thing said out loud. A bookmark is private, has no visible count, and
 * nobody is told. Most networks blur them — a "like" that is also a reading list — and the result is
 * that people stop saving things they do not want to be seen endorsing.
 *
 * Nothing here is indexed: `robots.txt` disallows it, and it is behind a sign-in besides.
 */
import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { bookmarks, type Post } from '../lib/agora.ts'
import { RequireSession } from '../lib/auth.tsx'
import { usePaged } from '../lib/resource.ts'
import { useTitle } from '../components/shell.tsx'
import { Empty } from '../components/states.tsx'
import { Timeline } from '../components/timeline.tsx'

export default function BookmarksPage() {
  useTitle('Bookmarks')
  return (
    <RequireSession what="keep bookmarks">
      <Saved />
    </RequireSession>
  )
}

function Saved() {
  const posts = usePaged<Post>(
    useCallback(
      (cursor, signal) =>
        bookmarks(cursor, { signal }).then((p) => ({ items: p.posts, nextCursor: p.nextCursor })),
      [],
    ),
    'Your bookmarks did not load.',
  )

  return (
    <Timeline
      empty={
        <Empty
          action={
            <Link className="ag-btn" to="/">
              Read the square
            </Link>
          }
          glyph="⌗"
          hint="Press ⌗ under any post to keep it here. Nobody is told, and there is no count — a bookmark is for you."
          title="Nothing saved yet"
        />
      }
      header={
        <header className="ag-page-head">
          <h1 className="ag-page-title">Bookmarks</h1>
          <p className="ag-page-sub">
            Only you can see this page. Bookmarking is private and the author is not told.
          </p>
        </header>
      }
      loadingLabel="Loading your bookmarks"
      posts={posts}
    />
  )
}
