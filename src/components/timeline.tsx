/**
 * A list of posts, in all six of its states, written once.
 *
 * Seven screens on this surface render a paged list of posts — the Square, Home, a voice, a tag, a
 * circle, bookmarks, search. They differ in what they FETCH and in what they say when there is
 * nothing, and in nothing else. Every one of them written by hand would be seven places for the
 * loading state to be right and the 403 state to be wrong.
 *
 * ── THE EMPTY STATE IS A PROP WITH NO DEFAULT, ON PURPOSE ─────────────────────────────────────
 *
 * There are no real users on this estate yet, so an empty timeline is the ORDINARY case rather than
 * the edge, and a generic "No posts" would be the most-seen sentence on the surface. Forcing each
 * caller to write its own means the Square says something a stranger can act on, Home says something
 * about following people, and bookmarks says what a bookmark is for — three different facts that a
 * shared default would have flattened into one non-statement.
 *
 * ── AND THE OPTIMISM IS WIRED THROUGH HERE ────────────────────────────────────────────────────
 *
 * `PostCard` reports a changed post through `onChange` and a deleted one through `onRemove`;
 * `usePaged` exposes `replace`/`remove` for exactly that. Wiring it here rather than in each page is
 * what stops a Spark on the Square repainting and a Spark on a tag page silently not.
 */
import type { ReactNode } from 'react'
import type { Post } from '../lib/agora.ts'
import type { Paged } from '../lib/resource.ts'
import { Failed, Forbidden, Loading, Missing } from './states.tsx'
import { PostCard } from './post.tsx'

export interface TimelineProps {
  posts: Paged<Post>
  /** What this list says when it is empty. No default — see the header. */
  empty: ReactNode
  /** The word under a spinner: "Loading the square", "Loading replies". */
  loadingLabel?: string | undefined
  /** Rendered above the first post — a composer, a heading, a circle's about box. */
  header?: ReactNode | undefined
  /** What a 403 says here. Circles need their own; everywhere else the default is right. */
  forbidden?: ReactNode | undefined
  /** The noun for a 404: "post", "voice", "circle". */
  missing?: string | undefined
}

export function Timeline({
  posts,
  empty,
  loadingLabel,
  header,
  forbidden,
  missing,
}: TimelineProps) {
  const body = (() => {
    switch (posts.state) {
      case 'loading':
        return <Loading label={loadingLabel ?? 'Loading'} />
      case 'forbidden':
        return forbidden ?? (
          <Forbidden
            message={posts.error?.message}
            requestId={posts.error?.requestId}
          />
        )
      case 'missing':
        return <Missing what={missing ?? 'page'} />
      case 'failed':
        return (
          <Failed
            message={posts.error?.message}
            onRetry={posts.reload}
            requestId={posts.error?.requestId}
          />
        )
      case 'empty':
        return <>{empty}</>
      default:
        return (
          <ol className="ag-timeline">
            {posts.items.map((post) => (
              <li key={post.id}>
                <PostCard
                  onChange={(next) => posts.replace((p) => p.id === next.id, next)}
                  onRemove={(id) => posts.remove((p) => p.id === id)}
                  post={post}
                />
              </li>
            ))}
          </ol>
        )
    }
  })()

  return (
    <>
      {header}
      {body}
      {/*
        The button is rendered from the cursor, not from a page count: `nextCursor === null` is the
        service saying there is no more, and it is the only thing that knows. A later page that
        failed leaves the posts on screen and puts its message HERE, beside the control that caused
        it, rather than replacing the list that loaded perfectly well.
      */}
      {posts.state === 'ok' && posts.cursor !== null && (
        <div className="ag-more">
          <button
            className="ag-btn"
            disabled={posts.loadingMore}
            onClick={posts.more}
            type="button"
          >
            {posts.loadingMore ? 'Loading…' : 'Load more'}
          </button>
          {posts.error && (
            <p className="ag-more__failure" role="status">
              {posts.error.message}
            </p>
          )}
        </div>
      )}
    </>
  )
}
