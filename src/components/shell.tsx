/**
 * The chrome: the estate's bar, the square's own rails, the page, the estate's footer.
 *
 * ── THE BAR IS NOT OPTIONAL, AND THE EXCHANGE PAID FOR THAT LESSON ───────────────────────────────
 *
 * `exchange-web/src/components/shell.tsx` carries the owner's report in full: a surface without the
 * estate's bar does not read as "this page needs no account", it reads as a page that fell off the
 * estate. It is worse here than anywhere else, because this is a surface strangers arrive on cold —
 * somebody pasted a post into a chat — and the bar is the only thing on the screen that says the
 * other fourteen surfaces exist, and that the account they are about to be asked for is one they
 * may already have.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE NETWORK SWITCH IS THE ONE PIECE OF MACHINERY IN THIS FILE, AND IT IS A REMOUNT.
 *
 * Everywhere else in the estate the two networks hold the same KIND of thing at different stakes:
 * switching re-reads a balance, and the old number and the new number are both balances. Here they
 * hold different things outright — two squares, two sets of people, two handles for the same
 * account, and nobody's reply on one is visible on the other. So a switch is not a re-read, it is a
 * change of room, and NOTHING may survive it:
 *
 *   `<VoiceProvider key={viewed}>`  the reader's voice, their handle, their unread counts. A count
 *                                   of unread notifications from the other square is not stale, it
 *                                   is FALSE — those notifications are not addressed to this voice.
 *   `<Outlet key={viewed}>`         every page's held data, discarded with the component rather
 *                                   than re-fetched in place. `lib/resource.ts` deliberately does
 *                                   not watch the network for exactly this reason: during a
 *                                   re-fetch there is no honest thing to show, because the posts on
 *                                   screen are from a different square and the empty state is a lie.
 *
 * The provider's key already remounts the outlet beneath it. The outlet keeps its own anyway, so
 * that the guarantee belongs to the outlet rather than to this file's nesting staying as it is.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT IS IN THE RAILS, AND WHY THE RIGHT ONE IS NOT A FEED ────────────────────────────────────
 *
 * Left: the reader's own addresses, with two unread badges. Right: search, and what the square is
 * actually talking about. There is no "who to follow", no "trending for you" and no algorithmic
 * anything — the two rails are navigation, and on a square with a few hundred people a suggestion
 * engine would be recommending the same four accounts to everybody.
 */
import {
  CloudsForgeBar,
  CloudsForgeFooter,
  CookieBanner,
  MainRegion,
  SkipLink,
  TestnetBand,
  miningOnHub,
} from '@cloudsforge/ui'
import { applyHead, surfaceMeta } from '@cloudsforge/ui/seo'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession, useVoice, VoiceProvider } from '../lib/auth.tsx'
import { activeTags, type ActiveTag } from '../lib/agora.ts'
import { trackPageView } from '../lib/analytics.ts'
import { count, hash } from '../lib/format.ts'
import { hosts, placementIsKnown, PRODUCT, SURFACE_DESCRIPTION } from '../lib/hosts.ts'
import { useResource } from '../lib/resource.ts'
import { NAV, ROUTES, routePattern, searchPath, tagPath } from '../lib/routes.ts'
import { setViewedNetwork, viewedNetwork, type ViewedNetwork } from '../lib/viewed.ts'

/** The name on the masthead and in every sentence of copy. One constant; the tests read it. */
export const SURFACE_NAME = 'Forge Agora'

export function AppShell() {
  const [viewed, setViewed] = useState<ViewedNetwork>(viewedNetwork())
  const { account, signIn, signOut } = useSession()
  const estate = hosts()
  useNavigationReporting()

  return (
    <>
      <SkipLink>Skip to the square</SkipLink>

      <CloudsForgeBar
        account={account}
        current={PRODUCT}
        mining={miningOnHub(estate.hub)}
        networkSwitch={{
          selected: viewed,
          // In place, never a navigation. The registry row carries `viewsAnyNetwork: true`, which
          // is what earns this origin the gateway's cross-environment CORS grant, and this callback
          // is the half of that claim the bundle performs. Without it, pressing Testnet halfway
          // through a thread would throw the reader onto Forge Network — task #136's exact defect.
          onSelect: (n) => {
            setViewedNetwork(n)
            setViewed(n)
          },
        }}
        onSignIn={() => signIn()}
        onSignOut={signOut}
      />

      {/*
        The band is load-bearing on this surface rather than decorative. Everywhere else it warns
        that money is not real; here it names WHICH SQUARE the words on the screen belong to, and a
        reader who misreads that posts to the wrong room in front of the wrong people.
      */}
      <TestnetBand network={viewed} />

      <VoiceProvider key={viewed}>
        <div className="ag-shell">
          <NavRail />

          <MainRegion className="ag-main">
            {!placementIsKnown() && <UnregisteredNotice />}
            <Outlet key={viewed} />
          </MainRegion>

          <TrendsRail />
        </div>
      </VoiceProvider>

      <CloudsForgeFooter
        account={account}
        current={PRODUCT}
        note={
          <>
            Everything on this square is written by the people using CloudsForge, not by
            CloudsForge. Posts are moderated against the{' '}
            <Link to="/guidelines">community guidelines</Link> when somebody reports them, and
            nothing here is financial advice, an offer, or a promise of return.
          </>
        }
      />

      <CookieBanner />
    </>
  )
}

/**
 * Report a client-side navigation, once per address, and never the first one.
 *
 * This is a single-page bundle: after the first load the browser never asks for another document,
 * so the tag's own automatic page view fires exactly once and every subsequent move between the
 * Square, a profile and a thread is invisible to it. Without this hook the count is "sessions",
 * labelled "page views", and every route but the entry one reads as unvisited.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT DO:
 *
 *   * It does not report the ENTRY address. `config` — pushed by the consent gate — sends that one
 *     itself, and reporting it again here would double every arrival. `reported` starts null and
 *     the first effect only records the address it found, which is also what makes this correct
 *     under StrictMode's deliberate double-invoke: the second run sees its own pathname already
 *     recorded and returns.
 *   * It does not send the pathname anywhere. `trackPageView` hands it to the provider registered
 *     in `lib/analytics.ts`, which turns `/v/nefeli` into `/v/:handle` before anything is pushed —
 *     the whole point of that module, and the reason this hook passes a path rather than fields.
 *
 * Keyed on the pathname alone. A change of `search` is not a navigation worth counting here and
 * the query string is the one part that is never reported anyway (`?q=` on `/search` is the
 * reader's own words), so re-running on it would push a duplicate of the page just reported.
 */
function useNavigationReporting(): void {
  const { pathname } = useLocation()
  const reported = useRef<string | null>(null)

  useEffect(() => {
    if (reported.current === pathname) return
    const first = reported.current === null
    reported.current = pathname
    if (first) return
    trackPageView(pathname)
  }, [pathname])
}

/* ---- the left rail --------------------------------------------------- */

/**
 * The reader's own addresses.
 *
 * Rendered for everybody, INCLUDING a signed-out reader, with the private entries still shown. That
 * is the deliberate choice and it is the opposite of hiding them: a stranger reading the Square
 * should be able to see that this place has a home timeline, whispers and bookmarks, because that
 * is what tells them what an account here is FOR. Pressing one lands on the route's own sign-in
 * panel, which keeps the address (see `RequireSession`) — so signing in from there returns them to
 * the page they asked for rather than to the Square.
 *
 * The badges are the exception: a count is a fact about a reader, and there is nobody to count for.
 */
function NavRail() {
  const { status } = useSession()
  const { me } = useVoice()
  const signedIn = status === 'in'

  const badges: Record<string, number> = {
    '/notifications': me?.unread.notifications ?? 0,
    '/whispers': me?.unread.whispers ?? 0,
  }

  return (
    <nav aria-label="Agora" className="ag-rail ag-rail--nav">
      <ul className="ag-nav">
        {NAV.map((item) => {
          const unread = badges[item.to] ?? 0
          return (
            <li key={item.to}>
              <NavLink
                className={({ isActive }) => `ag-nav__item${isActive ? ' ag-nav__item--on' : ''}`}
                // `end` on the index, or every single address would light the Square up as active.
                end={item.to === '/'}
                to={item.to}
              >
                <span aria-hidden="true" className="ag-nav__glyph">
                  {GLYPHS[item.to] ?? '·'}
                </span>
                <span className="ag-nav__label">{item.label}</span>
                {unread > 0 && (
                  // The number is in the accessible name rather than beside it: "Notifications 3"
                  // announced as two separate things is a screen reader saying "three" with no
                  // noun. `aria-hidden` on the visible pill, the full sentence on the link.
                  <span
                    aria-label={`${unread} unread`}
                    className="ag-nav__badge cf-num"
                    role="status"
                  >
                    {count(unread)}
                  </span>
                )}
              </NavLink>
            </li>
          )
        })}
        {/*
          Settings and the queue are not in NAV — they have no `label` in the route table, because a
          nav that lists every address the router knows is a sitemap. They are here, at the bottom,
          under a rule, which is where every surface in the estate puts the things you go to
          occasionally rather than the things you came for.
        */}
        {signedIn && (
          <li className="ag-nav__sep">
            <NavLink
              className={({ isActive }) => `ag-nav__item${isActive ? ' ag-nav__item--on' : ''}`}
              to="/settings"
            >
              <span aria-hidden="true" className="ag-nav__glyph">
                ⚙
              </span>
              <span className="ag-nav__label">Settings</span>
            </NavLink>
          </li>
        )}
        <ModerationLink />
      </ul>

      <Composerish />
    </nav>
  )
}

/** One glyph per destination. Decorative — every one of them is `aria-hidden`. */
const GLYPHS: Record<string, string> = {
  '/': '⁂',
  '/home': '◈',
  '/circles': '◍',
  '/notifications': '◉',
  '/whispers': '✉',
  '/bookmarks': '⌗',
  '/guidelines': '§',
}

/**
 * The queue, for the people who work it.
 *
 * HIDING IT IS A COURTESY, NOT A CONTROL. `requireOperator` in micro-agora is an `isAdmin` check
 * with no service lane, so every moderation route refuses a non-operator on its own. The role is
 * read here to decide what to RENDER and nowhere else in this bundle — a role in a token is a hint,
 * and a client that treated it as an authorisation would be one edited token away from a UI that
 * shows somebody a queue the server then refuses to fill.
 */
function ModerationLink() {
  const { isModerator } = useSession()
  if (!isModerator) return null
  return (
    <li>
      <NavLink
        className={({ isActive }) => `ag-nav__item${isActive ? ' ag-nav__item--on' : ''}`}
        to="/moderation"
      >
        <span aria-hidden="true" className="ag-nav__glyph">
          ⚖
        </span>
        <span className="ag-nav__label">Reports</span>
      </NavLink>
    </li>
  )
}

/**
 * The button that goes to where the composer is, rather than a second composer.
 *
 * The Square and Home both carry a real composer at the top. This is for the reader who is four
 * hundred pixels down a thread and has thought of something — and it NAVIGATES rather than opening
 * a modal, because a modal composer on this surface would be a second copy of the draft state, the
 * idempotency key and the visibility control, and two composers is how one of them ends up posting
 * to the wrong circle.
 */
function Composerish() {
  const { status, signIn: go } = useSession()
  const { suspended } = useVoice()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (suspended) return null
  const onSquare = pathname === '/' || pathname === '/home'
  if (onSquare) return null

  return (
    <button
      className="ag-btn ag-btn--primary ag-rail__write"
      onClick={() => {
        if (status !== 'in') {
          go()
          return
        }
        void navigate('/home')
      }}
      type="button"
    >
      Write something
    </button>
  )
}

/* ---- the right rail -------------------------------------------------- */

/** Search, and what the square is talking about. */
function TrendsRail() {
  return (
    <aside aria-label="Find things" className="ag-rail ag-rail--find">
      <SearchBox />
      <Trends />
    </aside>
  )
}

/**
 * The search field.
 *
 * A `<form>` with a submit, not an input with a keystroke handler: search on this surface is a
 * full-text scan across every post on the network, and firing one per keystroke would be a query
 * per character for a result nobody has asked for yet. The reader presses Enter when they have
 * finished typing, which is also the interaction their browser's autofill and their phone's
 * keyboard already expect.
 */
function SearchBox() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      const trimmed = q.trim()
      if (!trimmed) return
      void navigate(searchPath(trimmed))
    },
    [navigate, q],
  )

  return (
    <form className="ag-search" onSubmit={submit} role="search">
      <label className="ag-search__label" htmlFor="ag-search-input">
        Search the square
      </label>
      <input
        autoComplete="off"
        className="ag-input ag-search__input"
        id="ag-search-input"
        onChange={(e) => setQ(e.target.value)}
        placeholder="Posts, people, tags"
        type="search"
        value={q}
      />
    </form>
  )
}

/**
 * What is being talked about, right now, on this network.
 *
 * Tags with recent activity, and a count of posts. This is the honest version of a trends panel:
 * it is a `SELECT … GROUP BY tag ORDER BY count` over a window, it says so, and it does not pretend
 * to know what the reader in particular would like. It is also the one panel on the surface that
 * names no person, which is why it can be shown to a signed-out stranger without deciding anything
 * about them.
 *
 * Silent when it fails. A rail that cannot load its optional panel must not put an error beside a
 * timeline that loaded perfectly well — the reader would reasonably read the error as being about
 * the posts they are looking at.
 */
function Trends() {
  const tags = useResource(
    (signal) => activeTags({ signal }),
    (data) => data.tags.length,
    'Could not load what is active.',
  )

  if (tags.state !== 'ok' || !tags.data) return null

  return (
    <section aria-labelledby="ag-trends-title" className="ag-trends">
      <h2 className="ag-rail__title" id="ag-trends-title">
        Being talked about
      </h2>
      <ul className="ag-trends__list">
        {tags.data.tags.slice(0, 8).map((tag: ActiveTag) => (
          <li key={tag.tag}>
            <Link className="ag-trends__item" to={tagPath(tag.tag)}>
              <span className="ag-trends__tag">{hash(tag.tag)}</span>
              <span className="ag-trends__count cf-num">
                {count(tag.posts)} {tag.posts === 1 ? 'post' : 'posts'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---- the one notice this shell renders ------------------------------- */

/**
 * Served from an address the surface registry does not know.
 *
 * Every CloudsForge URL this bundle composes is derived by stripping a KNOWN first label off the
 * hostname. From an unknown name — a preview deployment, somebody's tunnel — the whole hostname
 * becomes the apex and every link goes one level too deep, silently. The app still works; it says
 * so once, here, rather than leaving somebody to discover it by clicking Wallet and landing
 * nowhere.
 */
function UnregisteredNotice() {
  return (
    <p className="ag-notice" role="status">
      This copy of {SURFACE_NAME} is being served from an address CloudsForge does not publish, so
      links to the other surfaces may not resolve. The square itself is unaffected.
    </p>
  )
}

/* ---- the head -------------------------------------------------------- */

/**
 * Keep the whole head — title, description, canonical, og — in step with the page.
 *
 * Every page calls it, with the name it wants in a tab, and `test/seo.test.ts` checks that all
 * fifteen of them do: a route that forgets leaves the previous page's title and canonical in place,
 * which is invisible in a browser and is what a crawler records.
 *
 * ── IT IS ONE HOOK RATHER THAN AN EFFECT IN THE SHELL, AND THAT IS AN ORDERING FACT ───────────
 *
 * React runs a CHILD's effects before its parent's. The pages are children of this shell through
 * the `Outlet`, so a head effect written up here would run after the page had already set its
 * title and would overwrite it with the surface name on every navigation. Writing the whole head
 * from the hook the page itself calls removes the ordering question rather than answering it.
 *
 * ── AND KEEP THE HANDLE OUT OF WHERE IT WOULD BE REPORTED ─────────────────────────────────────
 *
 * A title here names a person or a conversation, which is exactly what `lib/analytics.ts` strips
 * out of the path — and GA4 falls back to `document.title` for `page_title` unless it is overridden,
 * which that module does override, permanently, to the surface name. So the title is free to be
 * useful to the READER (it is what a bookmark and a switched-to tab are called) without becoming a
 * third-party record of who they read. The two decisions belong together and are cross-referenced
 * rather than each half being surprising on its own.
 *
 * The CANONICAL is the opposite case and gets the opposite answer: it carries the concrete path,
 * because a canonical that pointed at `/v/:handle` would tell every crawler that fourteen thousand
 * profiles are one page. That is not a leak — the address is the address the reader is already at,
 * published to the crawler that already fetched it, and no third party is being told anything it
 * did not just request.
 *
 * ── THE PRIVATE ROUTES ARE `noindex`, WHICH robots.txt CANNOT DO ──────────────────────────────
 *
 * `robots.txt` forbids the CRAWL, not the INDEXING: a `/whispers` link posted anywhere gets that
 * address into a search index with no snippet, because the crawler obeyed the disallow and indexed
 * the URL anyway. The meta is what says "do not list this at all", and it is derived from the
 * `private` flag in `ROUTES` so a new private route cannot be added without one.
 */
export function useTitle(title: string | null): void {
  const { pathname } = useLocation()
  useEffect(() => {
    const pattern = routePattern(pathname)
    const isPrivate = ROUTES.some((route) => `/${route.path}` === pattern && route.private)
    applyHead(
      surfaceMeta(PRODUCT, {
        ...(title === null ? {} : { title }),
        description: SURFACE_DESCRIPTION,
        path: pathname,
        robots: isPrivate ? 'noindex, nofollow' : 'index, follow, max-image-preview:large',
      }),
      // Read here rather than in the module, which is what keeps a hostname out of the artefact:
      // one bundle serves localhost, a preview deployment and both estates, and composes correct
      // absolute URLs on each.
      typeof window === 'undefined' ? '' : window.location.origin,
    )
  }, [title, pathname])
}
