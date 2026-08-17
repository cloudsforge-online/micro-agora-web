/**
 * One post, everything that led to it, and everything that came after.
 *
 * ── THIS IS THE ADDRESS THE WHOLE SURFACE IS BUILT AROUND ─────────────────────────────────────
 *
 * `/p/<id>` is what somebody pastes into a chat, what a notification links to, and what a stranger
 * opens cold with no session and no idea what CloudsForge is. Everything else on this surface can be
 * reached by pressing things; this one arrives from outside. It is why `nginx.conf` enumerates `p`
 * rather than falling through, why the estate bar is on this page, and why it renders for a
 * signed-out reader.
 *
 * ── THE SERVICE RETURNS THE THREAD FLAT, AND THE TREE IS REBUILT HERE ─────────────────────────
 *
 * `GET /v1/posts/:id/thread` hangs off the ROOT and answers every post in the conversation in one
 * ordered array, whichever post was asked for. That is the right shape for the wire — one query, one
 * page — and it means a reader who followed a link to a reply gets what came BEFORE it as well,
 * which is what makes a reply readable at all. Rebuilding it here costs one pass and turns it into
 * the three things a reader needs to see separately:
 *
 *   THE CHAIN     the ancestors of the focused post, from the root down. Connected by a line,
 *                 because the reason they are on screen is that they are what is being answered.
 *   THE POST      bigger, with an exact timestamp rather than "2h", and never truncated.
 *   THE REPLIES   everything descended from it, oldest first — a conversation reads forwards.
 *
 * Anything in the thread that is neither an ancestor nor a descendant is a sibling branch: somebody
 * else's reply to the same parent. It is deliberately NOT rendered. A reader who came for one reply
 * and got the other forty on the same level cannot tell which of them the link was about.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { thread, type Post, type ThreadView } from '../lib/agora.ts'
import { useResource } from '../lib/resource.ts'
import { excerpt } from '../lib/format.ts'
import { Composer } from '../components/composer.tsx'
import { PostCard } from '../components/post.tsx'
import { useTitle } from '../components/shell.tsx'
import { Empty, Failed, Forbidden, Loading, Missing } from '../components/states.tsx'

export default function ThreadPage() {
  const { id = '' } = useParams()
  const view = useResource<ThreadView>(
    useCallback((signal) => thread(id, { signal }), [id]),
    (data) => data.posts.length,
    'That conversation did not load.',
  )

  const focused = view.data?.posts.find((post) => post.id === id) ?? null
  // The title is what a bookmark and a switched-to tab are called. It carries a handle, which is
  // exactly what `lib/analytics.ts` keeps out of `page_title` — see `useTitle`'s own header.
  useTitle(focused ? `${focused.displayName || `@${focused.handle}`}: ${excerpt(focused.body, 40)}` : 'Post')

  switch (view.state) {
    case 'loading':
      return <Loading label="Loading the conversation" />
    case 'missing':
      return (
        <Missing
          action={
            <Link className="ag-btn" to="/">
              Back to the square
            </Link>
          }
          what="post"
        />
      )
    case 'forbidden':
      return <Forbidden message={view.error?.message} requestId={view.error?.requestId} />
    case 'failed':
      return (
        <Failed message={view.error?.message} onRetry={view.reload} requestId={view.error?.requestId} />
      )
    default:
      break
  }

  if (!view.data || !focused) {
    // The thread loaded and the post asked for is not in it. That is a 404 in every way that
    // matters to a reader, and saying anything more specific would be inventing a reason.
    return (
      <Missing
        action={
          <Link className="ag-btn" to="/">
            Back to the square
          </Link>
        }
        what="post"
      />
    )
  }

  return <Conversation focused={focused} onChanged={view.set} view={view.data} />
}

function Conversation({
  focused,
  onChanged,
  view,
}: {
  focused: Post
  onChanged: (next: ThreadView) => void
  view: ThreadView
}) {
  // Replies published from the composer below, held here rather than refetched. A refetch would
  // re-read the whole conversation to learn one thing this page already has.
  const [added, setAdded] = useState<readonly Post[]>([])

  const posts = useMemo(() => {
    const byId = new Map<string, Post>()
    for (const post of [...view.posts, ...added]) byId.set(post.id, post)
    return byId
  }, [added, view.posts])

  /** Root → … → parent. Walked upwards from the focused post, then reversed. */
  const chain = useMemo(() => {
    const out: Post[] = []
    let cursor = focused.inReplyToId
    // Bounded by the map's size: a cycle in the data would otherwise hang the page, and a thread
    // deep enough to matter is already unreadable long before this bound.
    for (let i = 0; cursor && i < posts.size; i += 1) {
      const parent = posts.get(cursor)
      if (!parent) break
      out.push(parent)
      cursor = parent.inReplyToId
    }
    return out.reverse()
  }, [focused, posts])

  /** Everything descended from the focused post, oldest first. Siblings are not descendants. */
  const replies = useMemo(() => {
    const descendants: Post[] = []
    const inThread = new Set([focused.id])
    // One ordered pass is enough because the service returns the thread in creation order, so a
    // reply is always seen after the post it answers.
    for (const post of [...posts.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (post.id === focused.id) continue
      if (post.inReplyToId && inThread.has(post.inReplyToId)) {
        inThread.add(post.id)
        descendants.push(post)
      }
    }
    return descendants
  }, [focused.id, posts])

  const replace = useCallback(
    (next: Post) => {
      setAdded((current) => current.map((post) => (post.id === next.id ? next : post)))
      onChanged({ ...view, posts: view.posts.map((post) => (post.id === next.id ? next : post)) })
    },
    [onChanged, view],
  )

  const drop = useCallback(
    (id: string) => {
      setAdded((current) => current.filter((post) => post.id !== id))
      onChanged({ ...view, posts: view.posts.filter((post) => post.id !== id) })
    },
    [onChanged, view],
  )

  return (
    <div className="ag-thread">
      {chain.length > 0 && (
        <ol className="ag-thread__chain">
          {chain.map((post) => (
            <li key={post.id}>
              <PostCard connected onChange={replace} onRemove={drop} post={post} />
            </li>
          ))}
        </ol>
      )}

      <PostCard focused onChange={replace} onRemove={drop} post={focused} />

      <section aria-label="Reply" className="ag-thread__reply">
        <Composer
          onPosted={(post) => setAdded((current) => [...current.filter((p) => p.id !== post.id), post])}
          placeholder={`Reply to @${focused.handle}`}
          replyTo={focused}
        />
      </section>

      {replies.length === 0 ? (
        <Empty
          glyph="↩"
          hint="Being the first reply is how most conversations here start."
          title="No replies yet"
        />
      ) : (
        <ol className="ag-thread__replies">
          {replies.map((post) => (
            <li
              className="ag-thread__reply-row"
              key={post.id}
              // Depth is capped so a long back-and-forth does not walk off the right edge on a
              // phone. Past the cap the connector line is what says a reply is nested.
              style={{ '--ag-depth': depthOf(post, posts, focused.id) } as React.CSSProperties}
            >
              <PostCard onChange={replace} onRemove={drop} post={post} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** How far below the focused post this reply sits, capped at three. */
function depthOf(post: Post, posts: Map<string, Post>, rootId: string): number {
  let depth = 0
  let cursor = post.inReplyToId
  for (let i = 0; cursor && cursor !== rootId && i < posts.size; i += 1) {
    depth += 1
    cursor = posts.get(cursor)?.inReplyToId ?? null
  }
  return Math.min(depth, 3)
}
