/**
 * Who is reading, and — separately — who they are HERE.
 *
 * Two contexts, because on this surface they are two different facts and conflating them produces a
 * specific wrong screen.
 *
 *   `useSession()` — the CloudsForge account. One identity across the whole estate and across both
 *      networks (micro-org#459). It is what the bar greets by name, what `roles` gates the
 *      moderation queue on, and what a bearer proves.
 *
 *   `useVoice()`   — the reader's VOICE on the network they are viewing. micro-agora keeps one PER
 *      NETWORK, so the same account is `@ember-a41f` in one square and a different handle, with a
 *      different bio, different followers and a different unread count, in the other. The two are
 *      not versions of one record; they are two records that happen to share an owner.
 *
 * A single merged context would have to carry one handle and one unread count for a reader who has
 * two of each, and the network switch would then paint mainnet's numbers over testnet's square. So
 * the estate session is held once for the whole app and the voice is held BENEATH the network
 * switch, remounted with it — see {@link VoiceProvider}.
 *
 * ── `GET /v1/me` CANNOT ANSWER "YOU HAVE NO VOICE HERE" ───────────────────────────────────────
 *
 * It is a read that writes: `requireVoice` calls `ensureVoice`, which inserts a voice with a handle
 * derived from the subject hash if the account has never touched this square. That is the service's
 * decision and it is the right one — the alternative is a 404 for somebody who has an account and
 * has simply never posted, and a client that must POST something before it can render an empty
 * timeline. It does mean there is NO "signed in with no voice" state to model here, and an earlier
 * draft of this file modelled one anyway, mapping a 404 onto a screen inviting the reader to
 * introduce themselves to a square that already knew them. A 404 from this route means the request
 * was not authenticated the way this route needs, which is a fault like any other.
 */
import type { AccountState } from '@cloudsforge/ui'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiError, AUTH_EXPIRED_EVENT, fetchReader, hasSession, signIn, signOut, NOBODY, type Reader } from './api.ts'
import { getMe, type Me } from './agora.ts'

/* ══════════════════════════════════════════════════════════════════════════
   The estate session
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `unknown` is a real state and is not the same as `out`.
 *
 * The first paint happens before `/auth/me` has answered. Rendering "Sign in" during that window
 * makes the bar flicker from signed-out to signed-in on every load for every reader who has an
 * account — and, worse, a page that gates on `status === 'out'` would show the sign-in panel for a
 * moment to somebody who is already signed in, which reads as having been logged out.
 */
export type SessionStatus = 'unknown' | 'in' | 'out'

export interface Session {
  status: SessionStatus
  reader: Reader
  /** The shape `CloudsForgeBar` and `CloudsForgeFooter` both take. */
  account: AccountState
  /** True when the reader holds an estate role that opens the moderation queue. */
  isModerator: boolean
  signIn: (returnTo?: string) => void
  signOut: () => void
}

const SessionContext = createContext<Session | null>(null)

/**
 * Roles that see reports.
 *
 * `admin` is the estate operator; `moderator` is the role micro-agora's `requireOperator` will
 * eventually widen to. Both are checked here so that adding the second role to identity does not
 * also require a frontend release — and neither is checked ANYWHERE ELSE in this bundle, because a
 * role in a token is a hint about what to render, never an authorisation. micro-agora refuses the
 * moderation routes on its own; hiding the link is a courtesy, not a control.
 */
const MODERATOR_ROLES = ['admin', 'moderator']

export function useSession(): Session {
  const value = useContext(SessionContext)
  // Throwing rather than returning a signed-out default: a component rendered outside the provider
  // would otherwise silently show the public version of a private page, which is the failure mode
  // this surface can least afford.
  if (value === null) throw new Error('useSession() outside <AuthProvider>')
  return value
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Seeded from the tokens already in storage. `main.tsx` has awaited `bootstrapSession()` before
  // this ever renders, so by now the hand-off code — if there was one — has been redeemed.
  const [status, setStatus] = useState<SessionStatus>(() => (hasSession() ? 'unknown' : 'out'))
  const [reader, setReader] = useState<Reader>(NOBODY)

  useEffect(() => {
    let live = true
    if (!hasSession()) {
      setStatus('out')
      return
    }
    void fetchReader().then((found) => {
      if (!live) return
      // `fetchReader` answers null for "no token" and for "identity is unreachable" alike, and it
      // has already cleared the tokens in the one case where the session is genuinely finished.
      // Trusting the tokens over the failed read is what keeps an identity blip from signing
      // everybody out of a square they are in the middle of reading.
      setReader(found ?? NOBODY)
      setStatus(found === null && !hasSession() ? 'out' : 'in')
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    // Fired by `api.ts` when a refresh fails. The tokens are already gone by then; this is the
    // chrome catching up, without a reload and without losing the reader's place on the page.
    const onExpired = () => {
      setReader(NOBODY)
      setStatus('out')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const value = useMemo<Session>(() => {
    const signedIn = status === 'in'
    return {
      status,
      reader,
      account: {
        signedIn,
        handle: reader.handle,
        // Passed through verbatim. The switcher decides which operator surfaces to show from this,
        // and the estate-wide bug this replaces was reading it off the wrong level of `/auth/me`
        // and therefore handing every switcher an empty array forever.
        roles: reader.roles,
      },
      isModerator: signedIn && reader.roles.some((role) => MODERATOR_ROLES.includes(role)),
      signIn,
      signOut,
    }
  }, [status, reader])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/* ══════════════════════════════════════════════════════════════════════════
   The voice on the viewed network
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Four states, and `failed` is one of them.
 *
 * `anonymous` and `failed` lead to different screens and must never be conflated: a reader shown
 * "sign in to post" while actually signed in, because the voice read timed out, will sign in again,
 * arrive back in the same state, and reasonably conclude the account is broken.
 *
 * There is no `none`. See the file header — this route mints the voice.
 */
export type VoiceStatus = 'unknown' | 'present' | 'anonymous' | 'failed'

export interface VoiceSession {
  status: VoiceStatus
  me: Me | null
  /**
   * True when this voice is suspended on this network.
   *
   * A suspension is not a sign-out and must not look like one: the reader keeps reading, their
   * posts stay up, and the writing controls refuse with a reason. Read off the voice rather than
   * off a status, because it is a property of the voice and not of the request.
   */
  suspended: boolean
  /** Re-read `/v1/me`. Called after editing the profile, and after the unread counts change. */
  reload: () => void
  /** Write a fresh `Me` in without a round trip — what a profile save and a read receipt do. */
  set: (next: Me) => void
}

const VoiceContext = createContext<VoiceSession | null>(null)

export function useVoice(): VoiceSession {
  const value = useContext(VoiceContext)
  if (value === null) throw new Error('useVoice() outside <VoiceProvider>')
  return value
}

/**
 * Hold the reader's voice for ONE network.
 *
 * MOUNTED WITH `key={viewedNetwork}` BY THE SHELL, which is the whole mechanism: switching network
 * unmounts this and mounts a fresh one, so the state cannot survive into a square it is not from.
 * An effect that re-fetched in place would leave the previous network's handle, avatar and unread
 * counts on screen for the duration of the request — and the unread badge in particular would be
 * actively false, because it is a count of things in the other square.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { status: sessionStatus } = useSession()
  const [status, setStatus] = useState<VoiceStatus>('unknown')
  const [me, setMe] = useState<Me | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (sessionStatus === 'unknown') return
    if (sessionStatus === 'out') {
      setMe(null)
      setStatus('anonymous')
      return
    }
    const controller = new AbortController()
    getMe({ signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setMe(found)
        setStatus('present')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setMe(null)
        // A 401 has already signed the reader out through `AUTH_EXPIRED_EVENT`, and the effect
        // above will re-run with `sessionStatus === 'out'`. Everything else is a fault, including
        // the 404 an earlier draft treated as "no voice here yet" — this route mints one.
        if (err instanceof ApiError && err.status === 401) return
        setStatus('failed')
      })
    return () => controller.abort()
  }, [sessionStatus, nonce])

  const value = useMemo<VoiceSession>(
    () => ({
      status,
      me,
      suspended: me?.voice.suspended ?? false,
      reload: () => setNonce((n) => n + 1),
      set: setMe,
    }),
    [status, me],
  )

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

/* ══════════════════════════════════════════════════════════════════════════
   Gating
   ══════════════════════════════════════════════════════════════════════════ */

export interface RequireSessionProps {
  /** What the panel says the reader is missing out on. One clause, no full stop. */
  what: string
  children: ReactNode
}

/**
 * Gate one of the six `private: true` routes in `ROUTES`.
 *
 * ── IT DOES NOT REDIRECT, AND THAT IS THE POINT ───────────────────────────────────────────────
 *
 * The obvious implementation is `<Navigate to="/" replace />`, and it throws away the address. A
 * reader who opens a bookmarked `/whispers` in a new browser session would land on the Square with
 * no explanation, and after signing in would still be on the Square — because the address that said
 * where they were going is gone. Keeping the URL and rendering a panel means the sign-in round trip
 * returns to exactly this page (`signIn()` defaults `returnTo` to `window.location.href`), which is
 * the behaviour every reader already expects from every other site they use.
 *
 * ── AND IT WAITS ──────────────────────────────────────────────────────────────────────────────
 *
 * `unknown` renders nothing rather than the panel. Rendering "Sign in to see this" for the ~200ms
 * before `/auth/me` answers shows a signed-in reader a sign-in wall on every single load, which is
 * indistinguishable from having been signed out.
 *
 * NONE OF THIS IS A SECURITY BOUNDARY. Every route behind it fetches from micro-agora with a bearer
 * or without one, and micro-agora is what refuses. Removing this component would leak no data — it
 * would only produce a page of empty panels and an unexplained 401.
 */
export function RequireSession({ what, children }: RequireSessionProps) {
  const { status, signIn: go } = useSession()

  if (status === 'unknown') return null
  if (status === 'in') return <>{children}</>

  return (
    <section className="ag-gate" aria-labelledby="ag-gate-title">
      <h1 className="ag-gate__title" id="ag-gate-title">
        Sign in to {what}
      </h1>
      <p className="ag-gate__body">
        The Agora runs on your CloudsForge account — the same one as the rest of the ecosystem. The
        Square is open to everyone; this page is yours.
      </p>
      <button className="ag-btn ag-btn--primary" onClick={() => go()} type="button">
        Sign in
      </button>
    </section>
  )
}
