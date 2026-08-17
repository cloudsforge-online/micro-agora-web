/**
 * One topic.
 *
 * How somebody finds a conversation they were not linked to and do not follow anybody in. On a
 * square this size it does more work than search does: there are not enough posts for a full-text
 * query to be the natural way in, and a tag is a thing people press rather than type.
 *
 * The hush control is here rather than only in settings because this is where somebody decides they
 * have had enough of a topic — beside the topic, in the moment, not three screens away afterwards.
 */
import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { hushTag, tagTimeline, unhushTag, type Post } from '../lib/agora.ts'
import { useSession } from '../lib/auth.tsx'
import { hash } from '../lib/format.ts'
import { usePaged } from '../lib/resource.ts'
import { useTitle } from '../components/shell.tsx'
import { Empty } from '../components/states.tsx'
import { Timeline } from '../components/timeline.tsx'

export default function TagPage() {
  const { tag = '' } = useParams()
  useTitle(hash(tag))
  const { status } = useSession()

  const posts = usePaged<Post>(
    useCallback(
      (cursor, signal) =>
        tagTimeline(tag, cursor, { signal }).then((p) => ({ items: p.posts, nextCursor: p.nextCursor })),
      [tag],
    ),
    'That topic did not load.',
  )

  return (
    <Timeline
      empty={
        <Empty
          action={
            <Link className="ag-btn" to="/">
              Back to the square
            </Link>
          }
          glyph="#"
          hint={`Nobody has used ${hash(tag)} yet. Put it in a post and this page becomes the place that conversation lives.`}
          title={`Nothing tagged ${hash(tag)}`}
        />
      }
      header={
        <header className="ag-page-head">
          <h1 className="ag-page-title">{hash(tag)}</h1>
          <p className="ag-page-sub">Everything public with this tag, newest first.</p>
          {status === 'in' && <HushTag tag={tag} />}
        </header>
      }
      loadingLabel="Loading the topic"
      posts={posts}
    />
  )
}

/**
 * Quiet a topic.
 *
 * OPTIMISTIC IN ONE DIRECTION ONLY. `GET /v1/voices/:ref` carries a `hushed` flag for a voice; there
 * is no route that says whether a TAG is hushed, so this control cannot render the true state on
 * arrival — it can only report what it just did. It therefore starts as an offer, and after a press
 * it says what happened rather than pretending to be a switch that knew its position all along.
 */
function HushTag({ tag }: { tag: string }) {
  const [done, setDone] = useState<'hushed' | 'unhushed' | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <p className="ag-tag-hush">
      <button
        className="ag-btn ag-btn--quiet"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setFailed(false)
          const going = done === 'hushed'
          void (going ? unhushTag(tag) : hushTag(tag))
            .then(() => setDone(going ? 'unhushed' : 'hushed'))
            .catch(() => setFailed(true))
            .finally(() => setBusy(false))
        }}
        type="button"
      >
        {done === 'hushed' ? `Unhush ${hash(tag)}` : `Hush ${hash(tag)}`}
      </button>
      {done === 'hushed' && (
        <span className="ag-tag-hush__note" role="status">
          Posts with this tag will not appear in your timelines. Nobody is told.
        </span>
      )}
      {done === 'unhushed' && (
        <span className="ag-tag-hush__note" role="status">
          You will see this tag again.
        </span>
      )}
      {failed && (
        <span className="ag-tag-hush__note" role="alert">
          That did not go through.
        </span>
      )}
    </p>
  )
}
