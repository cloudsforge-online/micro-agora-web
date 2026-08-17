/**
 * micro-agora's wire types, and one function per route.
 *
 * Every type below is transcribed from `agora/src/server.ts` — from `buildRoutes()`, from the
 * `*Wire()` serialisers beneath it, and from the enum `Set`s at the top of the file. Not from the
 * domain modules: `posts.ts` and `voices.ts` describe what the service HOLDS, and the wire is a
 * deliberately narrower thing. `Voice` in the database carries `avatarAssetId` and `suspendedAt`;
 * on the wire those are `avatarUrl` and `suspended`, because a browser cannot compose the first and
 * has no business with the second. Reading the domain types and assuming they are the response is
 * how a client comes out plausible and wrong in two dozen places at once.
 *
 * ── THE ONE THING THAT IS EASY TO GET WRONG ───────────────────────────────────────────────────
 *
 * `viewer` is PRESENT ONLY WHEN THE REQUEST CARRIED A BEARER — `postWire` spreads it conditionally.
 * It is not `{sparked:false,…}` for a signed-out reader, it is absent, because "this reader has not
 * sparked it" and "there is no reader" are different facts and the service refuses to state the
 * first when the second is true. So every consumer reads `post.viewer?.sparked ?? false` and the
 * Spark button is rendered from whether there is a session, not from whether `viewer` exists.
 * Typing it as required with false defaults would compile and would light up an empty star as
 * though the reader had un-sparked something.
 *
 * `Circle.viewer`, `VoicePage.relationship` and `VoicePage.counts` follow the same rule on their
 * own routes, and `counts` follows a second one: `GET /v1/voices/:ref` returns it ONLY when the
 * reader is asking about themself. Doc 41 §4 — your follower count is yours to see and nobody
 * else's to compare against.
 *
 * ── WHAT NOTHING HERE RETURNS ─────────────────────────────────────────────────────────────────
 *
 * No route returns a voice's `subject` — the account id behind the handle. It is not in `voiceWire`
 * and there is no shape below with a field for it, so a bug that started returning it would have
 * nowhere in this bundle to land.
 */
import { api, type RequestOptions } from './api.ts'

/* ══════════════════════════════════════ wire types ══════════════════════════════════════════ */

/**
 * How a follow stands: `active` is following, `pending` is waiting on a protected voice.
 *
 * NOT `'following' | 'requested'`, which is what the two states are CALLED on screen. The service
 * stores the row's own state and returns it verbatim, and the translation into English belongs in
 * the button, not in a client type that would then disagree with every log line.
 */
export type FollowState = 'active' | 'pending'

/** Who may open a whisper with this voice. `follows` means "voices they follow", not "followers". */
export type WhispersFrom = 'everyone' | 'follows' | 'nobody'

/**
 * Who a post is addressed to. Three, and there is no `unlisted`.
 *
 * A fourth value would have to mean something in `visibilityPredicate`, and the four clauses there
 * are exactly these three plus the author's own posts. Sending one the service does not know is a
 * 400 from `requireEnum`, so an invented member here is a composer that cannot post.
 */
export type Visibility = 'public' | 'followers' | 'circle'

/**
 * A circle's door: anyone may join, a steward decides, or nobody may ask.
 *
 * `closed` rather than `invite` — a closed circle can still be joined, by being invited into it,
 * which is a steward's action rather than a door.
 */
export type CircleVisibility = 'open' | 'request' | 'closed'

/** What somebody is in a circle. */
export type MemberRole = 'member' | 'steward'

/**
 * Where they stand in it.
 *
 * `banned` is a state rather than an absence, deliberately: a removed member's row is kept so that
 * rejoining does not silently undo a steward's decision. `GET …/members?state=` takes these values
 * and defaults to `active`, which is why a member list never shows a banned voice by accident.
 */
export type MemberState = 'active' | 'pending' | 'banned'

/** What a report can be filed against. */
export type SubjectKind = 'post' | 'voice' | 'circle' | 'whisper'

/** Why. A fixed list, because a free-text reason is a queue nobody can triage. */
export type ReportReason =
  | 'spam'
  | 'abuse'
  | 'impersonation'
  | 'self_harm'
  | 'illegal'
  | 'misinformation'
  | 'other'

export type ReportState = 'open' | 'actioned' | 'dismissed'

/**
 * What a moderator did.
 *
 * Named for the OUTCOME rather than the verb — `post_removed`, not `remove` — because the same
 * list is the audit trail, and an audit line reading "remove" leaves open whether it happened.
 */
export type ModerationActionKind =
  | 'post_removed'
  | 'post_restored'
  | 'voice_suspended'
  | 'voice_restored'
  | 'circle_archived'
  | 'report_dismissed'
  | 'sensitive_applied'

/** What can arrive in the notifications list. */
export type NotificationKind =
  | 'reply'
  | 'quote'
  | 'echo'
  | 'spark'
  | 'mention'
  | 'follow'
  | 'follow_request'
  | 'follow_accepted'
  | 'whisper'
  | 'circle_invite'
  | 'circle_request'
  | 'circle_accepted'
  | 'moderation'

/**
 * A person, as everybody else sees them.
 *
 * `handle` is the name in every link; `id` is a uuid and appears in no address on this surface.
 * `suspended` is on the public shape deliberately: a suspended voice's posts stay readable — a
 * conversation somebody else was part of does not disappear because one participant was suspended —
 * and the reader is told why the voice cannot be replied to instead of the reply silently failing.
 *
 * `avatarUrl` and `bannerUrl` are NULL rather than absent when this deployment has no
 * `STUDIO_PUBLIC_URL`, which is a shape a client can render initials for. A guessed hostname would
 * be a broken image with no explanation.
 */
export interface Voice {
  id: string
  handle: string
  displayName: string
  /** Empty string rather than null when unset — as are `location` and `website`. */
  bio: string
  avatarUrl: string | null
  bannerUrl: string | null
  location: string
  website: string
  whispersFrom: WhispersFrom
  /** True when this voice approves followers by hand. Their posts are not public. */
  protected: boolean
  /** False when the voice has asked not to appear in search or the directory. */
  discoverable: boolean
  suspended: boolean
  createdAt: string
}

/**
 * One attachment.
 *
 * `id` is the attachment row; the asset it points at lives in micro-studio and `bytesUrl` is the
 * composed address of its bytes. The two ids are not interchangeable — see {@link DraftPost.media}.
 * `kind` is a plain string on the wire rather than a union: the column is not constrained and a
 * client that narrowed it would crash on a value the service happily stored.
 */
export interface Media {
  id: string
  kind: string
  /** The description a screen reader gets. Enforced by a CHECK constraint, which is the point. */
  alt: string
  bytesUrl: string | null
}

/** What the reader themself has done to a post. ABSENT when there is no reader — see the header. */
export interface PostViewer {
  sparked: boolean
  echoed: boolean
  bookmarked: boolean
  /** True when the reader wrote it: the only case where Edit and Delete are offered. */
  mine: boolean
}

/**
 * One post.
 *
 * The author is FLATTENED onto it (`handle`, `displayName`, `avatarUrl`) rather than nested as a
 * voice. That is the service's decision and it is the right one for a timeline: a page of fifty
 * posts by twelve people would otherwise carry twelve full voice records repeatedly, and none of
 * the other fields on a voice are shown beside a post.
 *
 * `deleted` posts are still returned, with an empty `body`, when something else in the thread
 * replies to them. A reply whose parent has vanished reads as a non-sequitur; a reply under
 * "this post was deleted" reads as what happened.
 */
export interface Post {
  id: string
  voiceId: string
  handle: string
  displayName: string
  avatarUrl: string | null
  body: string
  /** BCP-47, as declared by the author's browser at compose time. Drives `lang` on the element. */
  lang: string
  inReplyToId: string | null
  /** The first post of the thread this belongs to. Null for a top-level post. */
  rootId: string | null
  quoteOfId: string | null
  circleId: string | null
  visibility: Visibility
  /** The author marked it as needing a press. `contentWarning` is what they said about it. */
  sensitive: boolean
  /** Empty string when there is none — not null. */
  contentWarning: string
  replyCount: number
  echoCount: number
  sparkCount: number
  quoteCount: number
  editedAt: string | null
  createdAt: string
  deleted: boolean
  media: readonly Media[]
  tags: readonly string[]
  viewer?: PostViewer
}

/** A page of posts. `nextCursor` is null at the end, and opaque everywhere else. */
export interface Page {
  posts: readonly Post[]
  nextCursor: string | null
}

/** A circle, as the directory and the circle page both show it. */
export interface Circle {
  id: string
  slug: string
  name: string
  purpose: string
  visibility: CircleVisibility
  avatarUrl: string | null
  members: number
  archived: boolean
  createdAt: string
  /** Absent for a logged-out reader. Both fields null for somebody who has never joined. */
  viewer?: { role: MemberRole | null; state: MemberState | null }
}

/** Somebody in a circle. */
export interface Member {
  voiceId: string
  handle: string
  displayName: string
  avatarUrl: string | null
  role: MemberRole
  state: MemberState
  joinedAt: string
}

/** A whisper thread, as the list shows it. `other` is the person on the far side. */
export interface Thread {
  id: string
  createdAt: string
  lastPostAt: string
  other: { voiceId: string; handle: string; displayName: string; avatarUrl: string | null }
  unread: number
  /** The last message's body. Enough to choose a thread; the thread itself is one press away. */
  preview: string
}

/** One private message. */
export interface Whisper {
  id: string
  threadId: string
  voiceId: string
  handle: string
  displayName: string
  avatarUrl: string | null
  body: string
  createdAt: string
  deleted: boolean
}

/** What happened while the reader was away. */
export interface Notification {
  id: string
  kind: NotificationKind
  /** Null for a notification the estate raised rather than a person — a moderation outcome. */
  actor: { voiceId: string; handle: string; displayName: string; avatarUrl: string | null } | null
  postId: string | null
  circleId: string | null
  threadId: string | null
  /** A sentence, when the kind alone does not say enough. Empty string, never null. */
  detail: string
  readAt: string | null
  createdAt: string
}

/**
 * How much of everything the reader has.
 *
 * THREE counts, not four — there is no `circles` here. `countsFor` runs three subqueries and a
 * fourth field would be a number this client invented, rendering `undefined` beside a label.
 *
 * Returned by `GET /v1/me`, and by `GET /v1/voices/:ref` only when the ref IS the reader.
 */
export interface Counts {
  posts: number
  following: number
  followers: number
}

/**
 * Which mails the reader wants.
 *
 * Named for the EVENT rather than the noun — `onReply`, not `replies` — and the five are the
 * columns of `email_prefs`. `setPrefs` merges only the keys present, so a form that changes one
 * switch sends one key; sending all five would overwrite a change made in another tab.
 */
export interface EmailPrefs {
  onReply: boolean
  onMention: boolean
  onFollow: boolean
  onWhisper: boolean
  onModeration: boolean
}

/**
 * The signed-in reader's own record.
 *
 * `GET /v1/me` MINTS THE VOICE if this account has never touched this square — a read that writes,
 * documented as such in `requireVoice`. It is why this route does not 404 for a new account, and
 * why `VoiceProvider`'s `none` state is reached through a 401/403 rather than through a missing
 * body. A 404 here means the request was not authenticated in the way this route needs.
 */
export interface Me {
  voice: Voice
  counts: Counts
  emailPrefs: EmailPrefs
  unread: { notifications: number; whispers: number }
}

/** How the reader and another voice stand. ABSENT when there is no reader, or when it is them. */
export interface Relationship {
  /** Null when not following at all; `pending` while a protected voice decides. */
  following: FollowState | null
  followedBy: boolean
  /** The reader has barred them: neither can see the other. */
  barred: boolean
  /** They have barred the reader. Stated plainly rather than shown as an empty profile. */
  barredBy: boolean
  /** Hushed: still followed, not shown, and they are never told. The one people actually use. */
  hushed: boolean
}

/** One voice's page. `relationship` for somebody else, `counts` for yourself, never both. */
export interface VoicePage {
  voice: Voice
  relationship?: Relationship
  counts?: Counts
}

/** What a policy decision looked like, echoed on every write that has one. */
export interface PolicyOutcome {
  decision: 'allow' | 'deny'
  /**
   * True when micro-policy could not be reached and the action was allowed anyway.
   *
   * `agora.post.create` is registered fail-OPEN (`policy/src/actions.ts`), so a policy outage costs
   * a second opinion rather than the only one — the Agora's own hourly counter still refuses a
   * flood. The flag is surfaced to moderators rather than to authors: a post that got through
   * during a degraded window is worth being able to find later.
   */
  degraded: boolean
}

/** What `POST /v1/posts` answers: 201 on a create, 200 on an idempotency hit. */
export interface PostCreated {
  post: Post
  policy: PolicyOutcome
}

/**
 * A whole conversation, flat.
 *
 * NOT `{post, ancestors, replies}`. The service hangs the thread off the ROOT and returns every
 * post in it in one ordered array, so asking for a reply in the middle returns what came BEFORE it
 * as well as what came after — which is what a reader who followed a link to a reply actually
 * needs. The page rebuilds the tree from `inReplyToId`; `rootId` says which post is the top.
 */
export interface ThreadView {
  rootId: string
  posts: readonly Post[]
}

/** A tag with recent activity, for the trends rail. Two fields; there is no voice count. */
export interface ActiveTag {
  tag: string
  posts: number
}

/**
 * A report, as the moderation queue shows it.
 *
 * `reporterHandle` is returned HERE AND NOWHERE ELSE, to an operator: a queue in which one person
 * files forty reports a day has a different problem from one with forty reporters. `automatic` is
 * true for a report the estate raised itself, which is why the handle can be null alongside it.
 */
export interface Report {
  id: string
  reporterHandle: string | null
  automatic: boolean
  subjectKind: SubjectKind
  subjectId: string
  reason: ReportReason
  detail: string
  state: ReportState
  /** What was decided, in the operator's words. Empty until it is resolved. */
  resolution: string
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
}

/** One line of a subject's moderation history. */
export interface ModerationEntry {
  action: ModerationActionKind
  /** The operator's identity, as `user:<id>`. A human's name is beside every action by design. */
  operator: string
  reason: string
  createdAt: string
}

/* ══════════════════════════════════════ the routes ══════════════════════════════════════════ */

/**
 * Everything below is one function per route, named for what it does rather than for its verb, and
 * every one of them takes an optional `signal`. That is not decoration: this surface fires a read
 * on every scroll and on every network switch, and a request whose answer is no longer wanted must
 * be cancelled rather than merely ignored — an ignored answer still costs the reader's data, and on
 * a network switch a late answer arriving after the switch would paint the other square's posts
 * under this square's heading.
 *
 * `auth: false` appears only where the route is genuinely open AND sending a bearer would change
 * the answer. See {@link latest}.
 */
type Opts = Pick<RequestOptions, 'signal'>

const V1 = '/v1'

/* ---- me ------------------------------------------------------------- */

export const getMe = (o?: Opts): Promise<Me> => api(`${V1}/me`, { ...o })

/**
 * What `PATCH /v1/me` accepts — which is NOT the shape of `Voice`.
 *
 * A voice comes back carrying `avatarUrl` and `bannerUrl`, both composed by the service from an
 * asset id it holds. Sending those URLs back would be sending the service its own composition and
 * asking it to parse an id out of it; `readVoiceInput` reads `avatarAssetId` and `bannerAssetId`
 * instead, and `null` is a legitimate value for each — that is how a picture is REMOVED, which an
 * optional-only field could not express.
 *
 * Every key is optional and only the ones present are written, so a form that edits one field sends
 * one field. That matters beyond tidiness: a PATCH that echoed the whole voice back would overwrite
 * a change made from another tab in the seconds since the form was loaded.
 */
export interface VoicePatch {
  handle?: string
  displayName?: string
  bio?: string
  location?: string
  website?: string
  whispersFrom?: WhispersFrom
  protected?: boolean
  discoverable?: boolean
  avatarAssetId?: string | null
  bannerAssetId?: string | null
}

export const updateMe = (patch: VoicePatch, o?: Opts): Promise<{ voice: Voice }> =>
  api(`${V1}/me`, { method: 'PATCH', body: patch, ...o })

/** Partial by design — see {@link EmailPrefs}. Sending one key changes one preference. */
export const setEmailPrefs = (
  prefs: Partial<EmailPrefs>,
  o?: Opts,
): Promise<{ emailPrefs: EmailPrefs }> =>
  api(`${V1}/me/email-prefs`, { method: 'PUT', body: prefs, ...o })

export const myCircles = (o?: Opts): Promise<{ circles: readonly Circle[] }> =>
  api(`${V1}/me/circles`, { ...o })

/* ---- timelines ------------------------------------------------------ */

/**
 * The Square: everything public on the viewed network, newest first.
 *
 * The bearer IS sent when there is one — `optionalViewerId` reads it and the reader's own bars and
 * hushes then apply, which is what makes "I blocked that person" mean something on the public
 * timeline too. A signed-out reader gets the same page without those filters, and both are the
 * honest answer to "what is the square saying".
 */
export const latest = (cursor: string | null, o?: Opts): Promise<Page> =>
  api(`${V1}/timeline/latest`, { query: { cursor }, ...o })

/** The reader's own timeline: voices they follow, and the circles they are in. */
export const home = (cursor: string | null, o?: Opts): Promise<Page> =>
  api(`${V1}/timeline/home`, { query: { cursor }, ...o })

/** One topic. */
export const tagTimeline = (tag: string, cursor: string | null, o?: Opts): Promise<Page> =>
  api(`${V1}/timeline/tag/${encodeURIComponent(tag)}`, { query: { cursor }, ...o })

/* ---- posts ---------------------------------------------------------- */

export interface DraftPost {
  body: string
  /** BCP-47. Defaulted from the browser at compose time; the composer lets it be changed. */
  lang?: string
  inReplyToId?: string
  quoteOfId?: string
  circleId?: string
  visibility?: Visibility
  sensitive?: boolean
  contentWarning?: string
  /**
   * Attachments, BY ASSET ID — the wire field is `assetId`, not `id`, and the two are not the same
   * thing: `Media.id` above is the attachment row micro-agora created, while this is the asset in
   * micro-studio the bytes actually live in (`assetUrl()` composes `${STUDIO_PUBLIC_URL}/v1/assets/
   * <assetId>/bytes`). A client that sent the attachment id back would be naming a row that does
   * not exist yet.
   *
   * `alt` is REQUIRED by the service — a CHECK constraint behind it — rather than defaulted to an
   * empty string, which is the difference between a rule and a suggestion.
   *
   * THE COMPOSER IN THIS BUNDLE SENDS AN EMPTY ARRAY TODAY. micro-agora has no upload route; bytes
   * enter through micro-studio and arrive here as an id. Wiring that is a follow-up, and posting
   * text works without it — which is why the surface ships rather than waiting for it.
   */
  media: readonly { assetId: string; alt: string; kind?: 'image' | 'video' | 'audio' }[]
}

/**
 * Publish.
 *
 * The idempotency key is REQUIRED by this signature although the route would accept its absence,
 * because the failure it prevents is the one this surface cannot undo. A composer that retries on a
 * dropped connection without a key posts twice, and a duplicate post is not a duplicate charge that
 * support can reverse — it is visible to everybody who was reading, and the author looks like they
 * are shouting. The key is minted when the reader starts typing, not when the request is sent.
 */
export const publish = (draft: DraftPost, idempotencyKey: string, o?: Opts): Promise<PostCreated> =>
  api(`${V1}/posts`, { method: 'POST', body: draft, idempotencyKey, ...o })

export const getPost = (id: string, o?: Opts): Promise<{ post: Post }> =>
  api(`${V1}/posts/${encodeURIComponent(id)}`, { ...o })

/**
 * Edit.
 *
 * `body` is REQUIRED by the route even though the other two fields are optional — `requireString`,
 * not a spread — so this is not a partial patch and the signature must not pretend otherwise. An
 * edit with no body is an edit of nothing.
 */
export const editPost = (
  id: string,
  edit: { body: string; sensitive?: boolean; contentWarning?: string },
  o?: Opts,
): Promise<{ post: Post }> =>
  api(`${V1}/posts/${encodeURIComponent(id)}`, { method: 'PATCH', body: edit, ...o })

export const deletePost = (id: string, o?: Opts): Promise<void> =>
  api(`${V1}/posts/${encodeURIComponent(id)}`, { method: 'DELETE', ...o })

/** The whole conversation this post belongs to. See {@link ThreadView} — it is flat. */
export const thread = (id: string, o?: Opts): Promise<ThreadView> =>
  api(`${V1}/posts/${encodeURIComponent(id)}/thread`, { ...o })

/**
 * What the three engagement routes answer.
 *
 * A COUNT AND A FLAG, NOT A POST. `engagementRoute` returns `{changed, count}`, and the count is
 * the count for THAT reaction only — the caller knows which one it asked for. So an optimistic UI
 * applies the number onto the post it already holds rather than replacing the post, and a client
 * that expected a fresh post here would assign `undefined` over a rendered timeline entry.
 *
 * `changed: false` means the state was already what was asked for. That is not an error and not a
 * no-op worth telling the reader about — it is the ordinary answer to a double-press and to a
 * retry, and it is exactly why these routes are PUT/DELETE rather than a toggle.
 */
export interface Engagement {
  changed: boolean
  count: number
}

/**
 * The three reactions, each idempotent by construction: PUT to set, DELETE to clear.
 *
 * No toggle endpoint, deliberately. A toggle is not idempotent, so a retry after a lost response
 * undoes what the first request did — which is exactly the case a flaky connection produces, and
 * the reader sees their own star flicker off for no reason they can name.
 */
export const spark = (id: string, on: boolean, o?: Opts): Promise<Engagement> =>
  api(`${V1}/posts/${encodeURIComponent(id)}/spark`, { method: on ? 'PUT' : 'DELETE', ...o })

export const echo = (id: string, on: boolean, o?: Opts): Promise<Engagement> =>
  api(`${V1}/posts/${encodeURIComponent(id)}/echo`, { method: on ? 'PUT' : 'DELETE', ...o })

export const bookmark = (id: string, on: boolean, o?: Opts): Promise<Engagement> =>
  api(`${V1}/posts/${encodeURIComponent(id)}/bookmark`, { method: on ? 'PUT' : 'DELETE', ...o })

export const bookmarks = (cursor: string | null, o?: Opts): Promise<Page> =>
  api(`${V1}/bookmarks`, { query: { cursor }, ...o })

/* ---- voices --------------------------------------------------------- */

/**
 * The directory, and search over it.
 *
 * `discoverable: false` and a suspension both take a voice out of THIS list without hiding the
 * profile from somebody who has the link. The search page uses this for its People results,
 * because `GET /v1/search` returns posts and only posts.
 */
export const voices = (
  q: string | null,
  cursor: string | null,
  o?: Opts,
): Promise<{ voices: readonly Voice[]; nextCursor: string | null }> =>
  api(`${V1}/voices`, { query: { q, cursor }, ...o })

/** One voice, by handle or by id — the service takes either, and this surface always sends handle. */
export const voice = (ref: string, o?: Opts): Promise<VoicePage> =>
  api(`${V1}/voices/${encodeURIComponent(ref)}`, { ...o })

/**
 * A voice's posts.
 *
 * `replies=true` folds their replies in. Off by default and that is the right default: a profile is
 * what somebody chose to say, and a profile that is nine-tenths half-sentences answering strangers
 * is a worse introduction to a person than the same profile without them.
 */
export const voicePosts = (
  ref: string,
  cursor: string | null,
  withReplies: boolean,
  o?: Opts,
): Promise<Page> =>
  api(`${V1}/voices/${encodeURIComponent(ref)}/posts`, {
    query: { cursor, ...(withReplies ? { replies: true } : {}) },
    ...o,
  })

/**
 * Follow.
 *
 * Answers `state: 'pending'` against a protected voice rather than `active`, and the button has to
 * render that third state — "Requested" — or the reader presses it again and again believing it did
 * not work. `created: false` means they already followed; the button was already right.
 */
export const follow = (
  ref: string,
  o?: Opts,
): Promise<{ state: FollowState; created: boolean }> =>
  api(`${V1}/voices/${encodeURIComponent(ref)}/follow`, { method: 'PUT', ...o })

/** Stop following. 204, and no body: there is one state to be in afterwards. */
export const unfollow = (ref: string, o?: Opts): Promise<void> =>
  api(`${V1}/voices/${encodeURIComponent(ref)}/follow`, { method: 'DELETE', ...o })

/**
 * Answer somebody's request to follow a protected voice.
 *
 * `admit: false` deletes the row and tells the requester NOTHING — no notification, no state to
 * observe. That is the point of a request: somebody who learns they were refused learns the other
 * person's opinion of them, and a protected account did not sign up to have that conversation. So
 * the UI for a refusal is the row disappearing from the list, and nothing else.
 */
export const answerFollowRequest = (
  ref: string,
  admit: boolean,
  o?: Opts,
): Promise<{ changed: boolean }> =>
  api(`${V1}/follow-requests/${encodeURIComponent(ref)}`, { method: 'PUT', body: { admit }, ...o })

/** Bar: neither of you sees the other again, and any existing follow is severed both ways. */
export const bar = (ref: string, o?: Opts): Promise<{ barred: true; created: boolean }> =>
  api(`${V1}/voices/${encodeURIComponent(ref)}/bar`, { method: 'PUT', ...o })

export const unbar = (ref: string, o?: Opts): Promise<void> =>
  api(`${V1}/voices/${encodeURIComponent(ref)}/bar`, { method: 'DELETE', ...o })

/**
 * Hush: still followed, not shown, and they are never told.
 *
 * `expiresAt` is what makes this the humane one — "quiet for a day" is a thing people want from a
 * friend live-posting a conference, and the alternative they reach for otherwise is unfollowing.
 * Omit it for indefinite.
 */
export const hush = (ref: string, expiresAt?: string, o?: Opts): Promise<{ hushed: true }> =>
  api(`${V1}/voices/${encodeURIComponent(ref)}/hush`, {
    method: 'PUT',
    body: expiresAt === undefined ? {} : { expiresAt },
    ...o,
  })

export const unhush = (ref: string, o?: Opts): Promise<void> =>
  api(`${V1}/voices/${encodeURIComponent(ref)}/hush`, { method: 'DELETE', ...o })

/** Hush a whole topic. The same mechanism as hushing a voice, applied to a tag. */
export const hushTag = (tag: string, expiresAt?: string, o?: Opts): Promise<{ hushed: true }> =>
  api(`${V1}/tags/${encodeURIComponent(tag)}/hush`, {
    method: 'PUT',
    body: expiresAt === undefined ? {} : { expiresAt },
    ...o,
  })

export const unhushTag = (tag: string, o?: Opts): Promise<void> =>
  api(`${V1}/tags/${encodeURIComponent(tag)}/hush`, { method: 'DELETE', ...o })

/* ---- circles -------------------------------------------------------- */

/**
 * The circle directory.
 *
 * NOT PAGED — `listCircles` takes a limit and returns an array, with no cursor in the response.
 * There are dozens of circles on this estate, not thousands, and a cursor for a list that fits on
 * one screen is a cursor that is never exercised and therefore never known to work. `q` narrows it.
 */
export const circles = (q: string | null, o?: Opts): Promise<{ circles: readonly Circle[] }> =>
  api(`${V1}/circles`, { query: { q }, ...o })

/**
 * Create one.
 *
 * `slug` IS REQUIRED and the service does not derive it from the name. That is the right division:
 * the slug is the address, it is permanent, and letting a display name mint one silently produces
 * `/circles/mining--rigs-2` the first time somebody types a stray character. The form asks for it,
 * suggests one from the name, and lets it be corrected before the circle exists.
 */
export const createCircle = (
  draft: {
    slug: string
    name: string
    purpose?: string
    visibility?: CircleVisibility
    avatarAssetId?: string | null
  },
  o?: Opts,
): Promise<{ circle: Circle }> => api(`${V1}/circles`, { method: 'POST', body: draft, ...o })

export const circle = (ref: string, o?: Opts): Promise<{ circle: Circle }> =>
  api(`${V1}/circles/${encodeURIComponent(ref)}`, { ...o })

/** `avatarAssetId` rather than `avatarUrl`, for the reason given on {@link VoicePatch}. */
export interface CirclePatch {
  name?: string
  purpose?: string
  visibility?: CircleVisibility
  avatarAssetId?: string | null
  archived?: boolean
}

export const updateCircle = (
  ref: string,
  patch: CirclePatch,
  o?: Opts,
): Promise<{ circle: Circle }> =>
  api(`${V1}/circles/${encodeURIComponent(ref)}`, { method: 'PATCH', body: patch, ...o })

/**
 * The roster, in one state at a time.
 *
 * Defaults to `active` server-side. A steward passes `pending` to see who is waiting — which is
 * the whole join-request queue, and the reason this takes a state at all rather than returning
 * everybody and letting the client filter a list it should not be holding.
 */
export const circleMembers = (
  ref: string,
  state: MemberState | null,
  o?: Opts,
): Promise<{ members: readonly Member[] }> =>
  api(`${V1}/circles/${encodeURIComponent(ref)}/members`, { query: { state }, ...o })

export const circlePosts = (ref: string, cursor: string | null, o?: Opts): Promise<Page> =>
  api(`${V1}/circles/${encodeURIComponent(ref)}/posts`, { query: { cursor }, ...o })

/**
 * Join. Against a `request` circle the answer is `pending`; against `closed` it is refused.
 *
 * The same `{state, created}` shape as {@link follow}, for the same reason: the button has three
 * states and needs to be told which one it is now in.
 */
export const joinCircle = (
  ref: string,
  o?: Opts,
): Promise<{ state: MemberState; created: boolean }> =>
  api(`${V1}/circles/${encodeURIComponent(ref)}/membership`, { method: 'PUT', ...o })

/** Leave. 204 when it happened, 404 when there was nothing to leave. */
export const leaveCircle = (ref: string, o?: Opts): Promise<void> =>
  api(`${V1}/circles/${encodeURIComponent(ref)}/membership`, { method: 'DELETE', ...o })

/**
 * A steward acting on one member.
 *
 * `action` is REQUIRED and the four values are not interchangeable — a PUT with no action is a 400,
 * which is the right answer: "do something to this member" is not a request. `role` is required by
 * the `role` action alone, which the overloads below make impossible to get wrong.
 */
export const admitMember = (ref: string, voiceRef: string, o?: Opts): Promise<{ changed: boolean }> =>
  memberAction(ref, voiceRef, { action: 'admit' }, o)

export const refuseMember = (
  ref: string,
  voiceRef: string,
  o?: Opts,
): Promise<{ changed: boolean }> => memberAction(ref, voiceRef, { action: 'refuse' }, o)

export const inviteMember = (
  ref: string,
  voiceRef: string,
  o?: Opts,
): Promise<{ changed: boolean }> => memberAction(ref, voiceRef, { action: 'invite' }, o)

export const setMemberRole = (
  ref: string,
  voiceRef: string,
  role: MemberRole,
  o?: Opts,
): Promise<{ changed: boolean }> => memberAction(ref, voiceRef, { action: 'role', role }, o)

const memberAction = (
  ref: string,
  voiceRef: string,
  body: { action: string; role?: MemberRole },
  o?: Opts,
): Promise<{ changed: boolean }> =>
  api(`${V1}/circles/${encodeURIComponent(ref)}/members/${encodeURIComponent(voiceRef)}`, {
    method: 'PUT',
    body,
    ...o,
  })

/**
 * Remove somebody, optionally for good.
 *
 * `ban` is a query parameter rather than a body on a DELETE, which is the service's shape. The two
 * are genuinely different acts — a removal can be undone by rejoining, a ban cannot — so the UI
 * asks which one, and the answer comes back as `banned` rather than being assumed.
 */
export const removeMember = (
  ref: string,
  voiceRef: string,
  ban: boolean,
  o?: Opts,
): Promise<{ changed: boolean; banned: boolean }> =>
  api(`${V1}/circles/${encodeURIComponent(ref)}/members/${encodeURIComponent(voiceRef)}`, {
    method: 'DELETE',
    query: { ...(ban ? { ban: true } : {}) },
    ...o,
  })

/* ---- whispers ------------------------------------------------------- */

export const threads = (o?: Opts): Promise<{ threads: readonly Thread[] }> =>
  api(`${V1}/whispers`, { ...o })

/**
 * Say something privately.
 *
 * ONE ROUTE, addressed to a PERSON, not to a thread. There is no "open a thread" step and no
 * `POST /v1/whispers/:id` — the thread is found or created from the pair of voices, so the first
 * message and the fortieth are the same request. `to` takes a handle or an id.
 *
 * No idempotency key: the route does not read one. A retry after a lost response therefore CAN
 * deliver twice, and the composer's answer is to disable the send control until the request
 * settles rather than to pass a key the service would ignore and this signature would imply.
 */
export const sendWhisper = (
  to: string,
  body: string,
  o?: Opts,
): Promise<{ whisper: Whisper }> =>
  api(`${V1}/whispers`, { method: 'POST', body: { to, body }, ...o })

export const whispers = (
  threadId: string,
  cursor: string | null,
  o?: Opts,
): Promise<{ whispers: readonly Whisper[]; nextCursor: string | null }> =>
  api(`${V1}/whispers/${encodeURIComponent(threadId)}`, { query: { cursor }, ...o })

export const markThreadRead = (threadId: string, o?: Opts): Promise<void> =>
  api(`${V1}/whispers/${encodeURIComponent(threadId)}/read`, { method: 'PUT', ...o })

/** Leave a thread. It stays in the other person's list — this is not a delete for both of you. */
export const leaveThread = (threadId: string, o?: Opts): Promise<void> =>
  api(`${V1}/whispers/${encodeURIComponent(threadId)}`, { method: 'DELETE', ...o })

export const deleteWhisper = (id: string, o?: Opts): Promise<void> =>
  api(`${V1}/whispers/messages/${encodeURIComponent(id)}`, { method: 'DELETE', ...o })

/* ---- notifications -------------------------------------------------- */

export const notifications = (
  cursor: string | null,
  unreadOnly: boolean,
  o?: Opts,
): Promise<{ notifications: readonly Notification[]; nextCursor: string | null }> =>
  api(`${V1}/notifications`, {
    query: { cursor, ...(unreadOnly ? { unread: true } : {}) },
    ...o,
  })

/**
 * Mark one as read, or all of them.
 *
 * `id` names ONE notification. Omitting it marks everything — not everything "up to" a point, which
 * is what a cursor-shaped parameter would suggest and what this route does not do. Answers how many
 * rows changed, which is what lets the unread badge be corrected rather than guessed at.
 */
export const markNotificationsRead = (id?: string, o?: Opts): Promise<{ marked: number }> =>
  api(`${V1}/notifications/read`, {
    method: 'PUT',
    body: id === undefined ? {} : { id },
    ...o,
  })

/* ---- search and discovery ------------------------------------------- */

/**
 * Search.
 *
 * POSTS ONLY, and paged like any other timeline. It does not return voices or tags — the search
 * page fetches people from {@link voices} with the same `q` and renders the two lists side by side,
 * which is also why they page independently.
 */
export const search = (q: string, cursor: string | null, o?: Opts): Promise<Page> =>
  api(`${V1}/search`, { query: { q, cursor }, ...o })

export const activeTags = (o?: Opts): Promise<{ tags: readonly ActiveTag[] }> =>
  api(`${V1}/tags/active`, { ...o })

/* ---- reporting and moderation --------------------------------------- */

/**
 * Report something.
 *
 * Answers **202** `{status:'received'}` — accepted, with no id and no promise about what happens
 * next. Both omissions are deliberate: an id would give the reporter something to poll that they
 * have no right to read, and telling them the outcome would tell them whether the person they
 * reported was actioned, which is the reported person's business.
 *
 * A duplicate answers identically. "You already reported this" is an invitation to argue about
 * whether the first one was seen. It was.
 */
export const fileReport = (
  report: {
    subjectKind: SubjectKind
    subjectId: string
    reason: ReportReason
    detail?: string
  },
  o?: Opts,
): Promise<{ status: 'received' }> => api(`${V1}/reports`, { method: 'POST', body: report, ...o })

/**
 * The queue. Administrators only.
 *
 * `requireOperator` is an `isAdmin` check with no service lane, so a non-operator gets 403 and the
 * shell never shows the link. The link being hidden is a courtesy; the 403 is the control.
 */
export const moderationQueue = (
  state: ReportState | null,
  o?: Opts,
): Promise<{ reports: readonly Report[] }> =>
  api(`${V1}/moderation/reports`, { query: { state }, ...o })

/**
 * Act.
 *
 * Answers `{status:'acted'}` and no record — the action is written to the subject's history, which
 * is where an operator reads it back from, rather than being handed to the caller as though it
 * were theirs. `reportId` links the action to the report it resolves; without it the action still
 * happens and the report stays open, which is occasionally what is wanted.
 */
export const moderate = (
  action: {
    action: ModerationActionKind
    subjectKind: SubjectKind
    subjectId: string
    reportId?: string
    reason?: string
  },
  o?: Opts,
): Promise<{ status: 'acted' }> =>
  api(`${V1}/moderation/actions`, { method: 'POST', body: action, ...o })

export const moderationHistory = (
  kind: SubjectKind,
  id: string,
  o?: Opts,
): Promise<{ history: readonly ModerationEntry[] }> =>
  api(`${V1}/moderation/history/${kind}/${encodeURIComponent(id)}`, { ...o })
