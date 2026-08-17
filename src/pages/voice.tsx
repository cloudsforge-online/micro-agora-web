/**
 * One person.
 *
 * ── THE RELATIONSHIP CONTROLS ARE THE WHOLE PAGE, AND THEY ARE THREE DIFFERENT THINGS ─────────
 *
 * Every social network collapses "I do not want to see this" into one button and then spends years
 * explaining what it does. micro-agora keeps three, they mean genuinely different things, and this
 * page has to make the difference legible in the moment somebody is angry enough to press one:
 *
 *   FOLLOW   their posts appear in your Home. Against a `protected` voice it answers `pending` and
 *            the button becomes "Requested" — rendering "Following" there would be a lie the reader
 *            discovers days later when they notice they have never seen a post.
 *   HUSH     you keep following, you stop seeing them, AND THEY ARE NEVER TOLD. It takes an expiry,
 *            which is the humane part: "quiet for a day" is what somebody actually wants from a
 *            friend live-posting a conference, and without it they reach for unfollow instead.
 *   BAR      neither of you sees the other again and any follow is severed both ways. It is the
 *            only one that is visible to the other person, by its effects, and the only one this
 *            page confirms before performing.
 *
 * ── AND A BARRED VOICE IS SAID OUT LOUD, IN BOTH DIRECTIONS ───────────────────────────────────
 *
 * `Relationship.barred` and `.barredBy` are separate fields and neither is rendered as an empty
 * profile. Somebody who barred a person months ago and forgot needs to know the emptiness is their
 * own doing; somebody who has been barred is owed the truth rather than a page that looks broken.
 */
import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  bar,
  follow,
  hush,
  unbar,
  unfollow,
  unhush,
  voice as fetchVoice,
  voicePosts,
  type FollowState,
  type Post,
  type Relationship,
  type VoicePage,
} from '../lib/agora.ts'
import { useSession, useVoice } from '../lib/auth.tsx'
import { ago, at, count, countLabel, exact, safeHref, prettyUrl } from '../lib/format.ts'
import { usePaged, useResource } from '../lib/resource.ts'
import { Avatar } from '../components/post.tsx'
import { useTitle } from '../components/shell.tsx'
import { Barred, Empty, Failed, Forbidden, Loading, Missing } from '../components/states.tsx'
import { Timeline } from '../components/timeline.tsx'

export default function VoicePage() {
  const { handle = '' } = useParams()
  const page = useResource<VoicePage>(
    useCallback((signal) => fetchVoice(handle, { signal }), [handle]),
    () => 1,
    'That profile did not load.',
  )
  useTitle(page.data ? page.data.voice.displayName || at(page.data.voice.handle) : at(handle))

  switch (page.state) {
    case 'loading':
      return <Loading label="Loading the profile" />
    case 'missing':
      return <Missing what="voice" />
    case 'forbidden':
      return <Forbidden message={page.error?.message} requestId={page.error?.requestId} />
    case 'failed':
      return <Failed message={page.error?.message} onRetry={page.reload} requestId={page.error?.requestId} />
    default:
      break
  }
  if (!page.data) return <Missing what="voice" />

  const { voice, relationship } = page.data
  if (relationship?.barredBy) return <Barred byThem handle={voice.handle} />

  return <Profile onChanged={page.set} page={page.data} />
}

function Profile({ onChanged, page }: { onChanged: (next: VoicePage) => void; page: VoicePage }) {
  const { voice, relationship, counts } = page
  const { status } = useSession()
  const { me } = useVoice()
  const mine = me?.voice.id === voice.id
  const [withReplies, setWithReplies] = useState(false)

  const posts = usePaged<Post>(
    useCallback(
      (cursor, signal) =>
        voicePosts(voice.handle, cursor, withReplies, { signal }).then((p) => ({
          items: p.posts,
          nextCursor: p.nextCursor,
        })),
      // `withReplies` is deliberately in the dependency list of the CALLBACK only; `usePaged` re-runs
      // on `reload()`, which the toggle below calls. Putting it here without the reload would change
      // the loader and never re-fetch.
      [voice.handle, withReplies],
    ),
    'Those posts did not load.',
  )

  const setRelationship = (next: Partial<Relationship>) => {
    if (!relationship) return
    onChanged({ ...page, relationship: { ...relationship, ...next } })
  }

  return (
    <div className="ag-profile">
      {voice.bannerUrl ? (
        <img alt="" className="ag-profile__banner" src={voice.bannerUrl} />
      ) : (
        <div aria-hidden="true" className="ag-profile__banner ag-profile__banner--none" />
      )}

      <header className="ag-profile__head">
        <Avatar
          avatarUrl={voice.avatarUrl}
          displayName={voice.displayName}
          handle={voice.handle}
          size="lg"
        />
        <div className="ag-profile__names">
          <h1 className="ag-profile__name">{voice.displayName || at(voice.handle)}</h1>
          <p className="ag-profile__handle">{at(voice.handle)}</p>
          {voice.protected && (
            <p className="ag-badge ag-badge--quiet" title="This voice approves followers by hand">
              Approves followers
            </p>
          )}
          {voice.suspended && (
            <p className="ag-badge ag-badge--warn">
              Suspended — they cannot post, and what they wrote is still here
            </p>
          )}
        </div>

        {status === 'in' && !mine && relationship && (
          <Relations
            handle={voice.handle}
            onChange={setRelationship}
            protectedVoice={voice.protected}
            relationship={relationship}
          />
        )}
      </header>

      {voice.bio && <p className="ag-profile__bio">{voice.bio}</p>}

      <dl className="ag-profile__facts">
        {voice.location && (
          <div className="ag-profile__fact">
            <dt>Where</dt>
            <dd>{voice.location}</dd>
          </div>
        )}
        {voice.website && <Website raw={voice.website} />}
        <div className="ag-profile__fact">
          <dt>Here since</dt>
          <dd>
            <time dateTime={voice.createdAt} title={exact(voice.createdAt)}>
              {ago(voice.createdAt, Date.now())}
            </time>
          </dd>
        </div>
      </dl>

      {/*
        Counts only when the service sent them, which is when the reader is looking at THEMSELF —
        `countsFor` runs on `/v1/me` and on `/v1/voices/:ref` when the ref is the reader. Rendering
        zeroes for everybody else would put three confident, wrong numbers on every profile.
      */}
      {counts && (
        <ul className="ag-profile__counts">
          <li>
            <span className="cf-num">{count(counts.posts) || '0'}</span>{' '}
            {countLabel(counts.posts, 'post', 'posts').replace(/^\S+\s/, '')}
          </li>
          <li>
            <span className="cf-num">{count(counts.following) || '0'}</span> following
          </li>
          <li>
            <span className="cf-num">{count(counts.followers) || '0'}</span>{' '}
            {counts.followers === 1 ? 'follower' : 'followers'}
          </li>
        </ul>
      )}

      {relationship?.barred ? (
        <Barred byThem={false} handle={voice.handle} />
      ) : (
        <Timeline
          empty={
            <Empty
              glyph="◇"
              hint={
                mine
                  ? 'Whatever you post shows up here.'
                  : 'When they post something, it will be here.'
              }
              title={mine ? 'You have not posted yet' : 'Nothing here yet'}
            />
          }
          header={
            <div className="ag-tabs" role="group" aria-label="What to show">
              <button
                aria-pressed={!withReplies}
                className={`ag-tab${withReplies ? '' : ' ag-tab--on'}`}
                onClick={() => {
                  setWithReplies(false)
                  posts.reload()
                }}
                type="button"
              >
                Posts
              </button>
              <button
                aria-pressed={withReplies}
                className={`ag-tab${withReplies ? ' ag-tab--on' : ''}`}
                onClick={() => {
                  setWithReplies(true)
                  posts.reload()
                }}
                type="button"
              >
                Posts and replies
              </button>
            </div>
          }
          loadingLabel="Loading posts"
          posts={posts}
        />
      )}
    </div>
  )
}

/**
 * A website somebody typed into a text box, made clickable only if it is safe to.
 *
 * The SAME check as a link inside a post — `safeHref` parses rather than prefix-matches — because
 * this field is no less somebody else's text than a post body is, and `javascript:` in a profile
 * link would run in this origin with the reader's session in storage. A refused scheme is shown as
 * the characters they typed.
 */
function Website({ raw }: { raw: string }) {
  const href = safeHref(raw.includes('://') ? raw : `https://${raw}`)
  return (
    <div className="ag-profile__fact">
      <dt>Elsewhere</dt>
      <dd>
        {href ? (
          <a href={href} rel="noopener noreferrer nofollow ugc" target="_blank">
            {prettyUrl(href)}
          </a>
        ) : (
          raw
        )}
      </dd>
    </div>
  )
}

/* ---- follow, hush, bar ------------------------------------------------ */

function Relations({
  handle,
  onChange,
  protectedVoice,
  relationship,
}: {
  handle: string
  onChange: (next: Partial<Relationship>) => void
  protectedVoice: boolean
  relationship: Relationship
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmingBar, setConfirmingBar] = useState(false)

  const run = async (work: () => Promise<Partial<Relationship>>) => {
    setBusy(true)
    setFailure(null)
    try {
      onChange(await work())
    } catch {
      setFailure('That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  if (relationship.barred) {
    return (
      <div className="ag-relations">
        <button
          className="ag-btn"
          disabled={busy}
          onClick={() => void run(async () => (await unbar(handle), { barred: false }))}
          type="button"
        >
          Unbar
        </button>
        {failure && <p className="ag-relations__failure" role="alert">{failure}</p>}
      </div>
    )
  }

  const state: FollowState | null = relationship.following

  return (
    <div className="ag-relations">
      <button
        className={`ag-btn${state === null ? ' ag-btn--primary' : ''}`}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            if (state === null) {
              const { state: next } = await follow(handle)
              return { following: next }
            }
            await unfollow(handle)
            return { following: null }
          })
        }
        type="button"
      >
        {/*
          Three labels for three states. "Following" against a pending request would be the single
          most misleading string on this surface: the reader would wait days for posts that were
          never going to arrive, and conclude the timeline was broken.
        */}
        {state === null ? (protectedVoice ? 'Ask to follow' : 'Follow') : state === 'pending' ? 'Requested' : 'Following'}
      </button>

      <button
        className="ag-btn ag-btn--quiet"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            if (relationship.hushed) {
              await unhush(handle)
              return { hushed: false }
            }
            await hush(handle)
            return { hushed: true }
          })
        }
        title={
          relationship.hushed
            ? 'Show their posts again'
            : 'Stop seeing their posts. They are not told, and you keep following them.'
        }
        type="button"
      >
        {relationship.hushed ? 'Unhush' : 'Hush'}
      </button>

      {confirmingBar ? (
        <div className="ag-relations__confirm" role="group" aria-label="Confirm barring">
          <p className="ag-relations__confirm-text">
            Barring {at(handle)} means neither of you sees the other again, and anything either of
            you follows the other for is undone. You can undo it here later.
          </p>
          <button className="ag-btn ag-btn--quiet" onClick={() => setConfirmingBar(false)} type="button">
            Keep things as they are
          </button>
          <button
            className="ag-btn ag-btn--danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await bar(handle)
                setConfirmingBar(false)
                return { barred: true, following: null }
              })
            }
            type="button"
          >
            Bar {at(handle)}
          </button>
        </div>
      ) : (
        <button className="ag-btn ag-btn--quiet" onClick={() => setConfirmingBar(true)} type="button">
          Bar
        </button>
      )}

      {failure && (
        <p className="ag-relations__failure" role="alert">
          {failure}
        </p>
      )}
    </div>
  )
}
