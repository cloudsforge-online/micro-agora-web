/**
 * One circle: what it is for, who is in it, and what is being said.
 *
 * ── A 403 HERE IS NOT AN ERROR SCREEN, IT IS THE JOIN BUTTON ──────────────────────────────────
 *
 * A closed circle answers 403 to `GET …/posts` for somebody who is not a member. Rendering the
 * generic refusal would be technically correct and useless: the reader can SEE the circle, they know
 * what it is for, and the one thing they want is a way in. So the posts panel's forbidden state is
 * replaced with the door — join, ask, or "this one is by invitation" — which is the whole reason
 * `Timeline` takes a `forbidden` prop at all.
 *
 * ── THE ROSTER IS A STEWARD'S TOOL AND A MEMBER'S COURTESY ────────────────────────────────────
 *
 * Everybody who can see the circle sees the active members. A steward additionally sees the
 * `pending` list, which IS the join queue — there is no separate requests screen, because a queue
 * you have to navigate to is a queue that goes unread and leaves people waiting for days.
 */
import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  admitMember,
  circle as fetchCircle,
  circleMembers,
  circlePosts,
  joinCircle,
  leaveCircle,
  refuseMember,
  removeMember,
  setMemberRole,
  type Circle,
  type Member,
  type Post,
} from '../lib/agora.ts'
import { useSession } from '../lib/auth.tsx'
import { at, count } from '../lib/format.ts'
import { usePaged, useResource } from '../lib/resource.ts'
import { voicePath } from '../lib/routes.ts'
import { Composer } from '../components/composer.tsx'
import { Avatar } from '../components/post.tsx'
import { useTitle } from '../components/shell.tsx'
import { Empty, Failed, Loading, Missing } from '../components/states.tsx'
import { Timeline } from '../components/timeline.tsx'

export default function CirclePage() {
  const { slug = '' } = useParams()
  const found = useResource(
    useCallback((signal) => fetchCircle(slug, { signal }), [slug]),
    () => 1,
    'That circle did not load.',
  )
  useTitle(found.data?.circle.name ?? 'Circle')

  switch (found.state) {
    case 'loading':
      return <Loading label="Loading the circle" />
    case 'missing':
    case 'forbidden':
      // 404 and 403 are the same screen HERE and only here: a closed circle the reader may not see
      // answers one or the other depending on how it is closed, and telling them apart would tell a
      // stranger which private circles exist. `states.tsx::Missing` says what is actually known.
      return (
        <Missing
          action={
            <Link className="ag-btn" to="/circles">
              All circles
            </Link>
          }
          what="circle"
        />
      )
    case 'failed':
      return <Failed message={found.error?.message} onRetry={found.reload} requestId={found.error?.requestId} />
    default:
      break
  }
  if (!found.data) return <Missing what="circle" />

  return <TheCircle circle={found.data.circle} onChanged={(c) => found.set({ circle: c })} />
}

function TheCircle({ circle, onChanged }: { circle: Circle; onChanged: (next: Circle) => void }) {
  const { status, signIn: go } = useSession()
  const member = circle.viewer?.state === 'active'
  const steward = member && circle.viewer?.role === 'steward'
  const pending = circle.viewer?.state === 'pending'

  const posts = usePaged<Post>(
    useCallback(
      (cursor, signal) =>
        circlePosts(circle.slug, cursor, { signal }).then((p) => ({ items: p.posts, nextCursor: p.nextCursor })),
      [circle.slug],
    ),
    'The circle posts did not load.',
  )

  return (
    <div className="ag-circle">
      <header className="ag-circle__head">
        {circle.avatarUrl ? (
          <img alt="" className="ag-circle__avatar" src={circle.avatarUrl} />
        ) : (
          <span aria-hidden="true" className="ag-circle__avatar ag-circle__avatar--none">
            ◍
          </span>
        )}
        <div className="ag-circle__names">
          <h1 className="ag-page-title">{circle.name}</h1>
          <p className="ag-circle__slug">/circles/{circle.slug}</p>
          {circle.purpose && <p className="ag-circle__purpose">{circle.purpose}</p>}
          <p className="ag-circle__facts">
            <span className="cf-num">{count(circle.members) || '0'}</span>{' '}
            {circle.members === 1 ? 'member' : 'members'}
            {circle.archived && <span className="ag-badge ag-badge--quiet">Archived</span>}
          </p>
        </div>
        <Door
          circle={circle}
          onChanged={onChanged}
          onSignIn={go}
          signedIn={status === 'in'}
        />
      </header>

      {circle.archived && (
        <p className="ag-notice" role="status">
          This circle is archived. Everything in it is still readable and nothing new can be posted.
        </p>
      )}

      <div className="ag-circle__body">
        <Timeline
          empty={
            <Empty
              glyph="◍"
              hint={
                member
                  ? 'Circle posts go to the members and to nobody else. Say the first thing.'
                  : 'Nothing has been posted here yet.'
              }
              title="Quiet in here"
            />
          }
          forbidden={
            <div className="ag-state ag-state--refused" role="status">
              <span aria-hidden="true" className="ag-state__glyph">
                ◍
              </span>
              <p className="ag-state__title">This circle's posts are for its members</p>
              <p className="ag-state__hint">
                {circle.visibility === 'open'
                  ? 'Join and you can read them straight away.'
                  : circle.visibility === 'request'
                    ? 'Ask to join, and a steward will decide.'
                    : 'This one is by invitation. A steward has to bring you in.'}
              </p>
              <div className="ag-state__action">
                <Door circle={circle} onChanged={onChanged} onSignIn={go} signedIn={status === 'in'} />
              </div>
            </div>
          }
          header={
            member && !circle.archived ? (
              <Composer
                circle={circle}
                onPosted={(post) => posts.prepend(post, (a, b) => a.id === b.id)}
                placeholder={`Say something to ${circle.name}`}
              />
            ) : pending ? (
              <p className="ag-notice" role="status">
                You have asked to join. A steward will see it in their queue.
              </p>
            ) : null
          }
          loadingLabel="Loading the circle"
          posts={posts}
        />

        <Roster slug={circle.slug} steward={steward} />
      </div>
    </div>
  )
}

/**
 * The one control that changes whether the reader is in.
 *
 * Rendered in two places — the header, and inside the forbidden state — deliberately: somebody who
 * can see the posts joins from the top, and somebody who cannot is looking at the refusal, which is
 * where the button has to be. One component, so the two cannot drift.
 */
function Door({
  circle,
  onChanged,
  onSignIn,
  signedIn,
}: {
  circle: Circle
  onChanged: (next: Circle) => void
  onSignIn: () => void
  signedIn: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const state = circle.viewer?.state ?? null

  if (!signedIn) {
    return (
      <button className="ag-btn ag-btn--primary" onClick={onSignIn} type="button">
        Sign in to join
      </button>
    )
  }
  if (circle.archived) return null
  if (state === 'banned') {
    return <p className="ag-circle__door-note">You cannot join this circle.</p>
  }

  const run = (work: () => Promise<Partial<Circle>>) => {
    setBusy(true)
    setFailure(null)
    void work()
      .then((patch) => onChanged({ ...circle, ...patch }))
      .catch(() => setFailure('That did not go through.'))
      .finally(() => setBusy(false))
  }

  if (state === 'active') {
    return (
      <div className="ag-circle__door">
        <button
          className="ag-btn"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await leaveCircle(circle.slug)
              return { viewer: { role: null, state: null }, members: Math.max(0, circle.members - 1) }
            })
          }
          type="button"
        >
          Leave
        </button>
        {failure && <p className="ag-circle__door-note" role="alert">{failure}</p>}
      </div>
    )
  }

  if (state === 'pending') {
    return (
      <div className="ag-circle__door">
        <button
          className="ag-btn"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await leaveCircle(circle.slug)
              return { viewer: { role: null, state: null } }
            })
          }
          type="button"
        >
          Withdraw the request
        </button>
        {failure && <p className="ag-circle__door-note" role="alert">{failure}</p>}
      </div>
    )
  }

  if (circle.visibility === 'closed') {
    return <p className="ag-circle__door-note">By invitation only.</p>
  }

  return (
    <div className="ag-circle__door">
      <button
        className="ag-btn ag-btn--primary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const { state: next } = await joinCircle(circle.slug)
            return {
              viewer: { role: 'member', state: next },
              // Only an immediate join changes the count. A pending request is not a member yet,
              // and incrementing here would show a number the next reload takes back.
              ...(next === 'active' ? { members: circle.members + 1 } : {}),
            }
          })
        }
        type="button"
      >
        {circle.visibility === 'open' ? 'Join' : 'Ask to join'}
      </button>
      {failure && <p className="ag-circle__door-note" role="alert">{failure}</p>}
    </div>
  )
}

/** Who is in, and — for a steward — who is waiting. */
function Roster({ slug, steward }: { slug: string; steward: boolean }) {
  const active = useResource(
    useCallback((signal) => circleMembers(slug, 'active', { signal }), [slug]),
    (data) => data.members.length,
    'The members did not load.',
  )
  const waiting = useResource(
    useCallback(
      (signal) => (steward ? circleMembers(slug, 'pending', { signal }) : Promise.resolve({ members: [] })),
      [slug, steward],
    ),
    (data) => data.members.length,
    'The join requests did not load.',
  )

  return (
    <aside aria-labelledby="ag-roster-title" className="ag-roster">
      <h2 className="ag-rail__title" id="ag-roster-title">
        Members
      </h2>

      {steward && waiting.state === 'ok' && waiting.data && (
        <section className="ag-roster__queue">
          <h3 className="ag-roster__sub">Waiting to join</h3>
          <ul className="ag-roster__list">
            {waiting.data.members.map((m) => (
              <li className="ag-roster__row" key={m.voiceId}>
                <MemberLink member={m} />
                <span className="ag-roster__actions">
                  <button
                    className="ag-btn ag-btn--quiet"
                    onClick={() => void admitMember(slug, m.handle).then(() => { waiting.reload(); active.reload() })}
                    type="button"
                  >
                    Admit
                  </button>
                  {/*
                    A refusal tells the person nothing — no notification, no state to observe. That
                    is what a request is for: somebody who learns they were refused learns the
                    steward's opinion of them, which is not what they asked for.
                  */}
                  <button
                    className="ag-btn ag-btn--quiet"
                    onClick={() => void refuseMember(slug, m.handle).then(waiting.reload)}
                    type="button"
                  >
                    Refuse
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {active.state === 'loading' && <Loading label="Loading members" />}
      {active.state === 'ok' && active.data && (
        <ul className="ag-roster__list">
          {active.data.members.map((m) => (
            <li className="ag-roster__row" key={m.voiceId}>
              <MemberLink member={m} />
              {m.role === 'steward' && <span className="ag-badge ag-badge--quiet">Steward</span>}
              {steward && m.role !== 'steward' && (
                <span className="ag-roster__actions">
                  <button
                    className="ag-btn ag-btn--quiet"
                    onClick={() => void setMemberRole(slug, m.handle, 'steward').then(active.reload)}
                    title="Let them admit and remove members"
                    type="button"
                  >
                    Make steward
                  </button>
                  <button
                    className="ag-btn ag-btn--quiet"
                    // `ban: false` — a removal can be undone by rejoining and a ban cannot, and the
                    // two are genuinely different acts. The stronger one is not offered from a row
                    // in a list; it belongs to a decision somebody makes on purpose.
                    onClick={() => void removeMember(slug, m.handle, false).then(active.reload)}
                    type="button"
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {active.state === 'empty' && <p className="ag-roster__none">Nobody yet.</p>}
    </aside>
  )
}

function MemberLink({ member }: { member: Member }) {
  return (
    <Link className="ag-roster__who" to={voicePath(member.handle)}>
      <Avatar
        avatarUrl={member.avatarUrl}
        displayName={member.displayName}
        handle={member.handle}
        size="sm"
      />
      <span className="ag-roster__name">{member.displayName || at(member.handle)}</span>
    </Link>
  )
}
