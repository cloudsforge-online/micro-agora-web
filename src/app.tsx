/**
 * The application: the router, the two providers, and the route table.
 *
 * ── THE ROUTE ELEMENTS ARE IN THIS FILE AND NOT IN A `routes-tree.tsx` ────────────────────────
 *
 * `journal-web` splits them out, for a reason that does not apply here: it prerenders every page
 * under Node, and `app.tsx` reaches the estate's bar, which touches `window` as it evaluates. This
 * surface has nothing to prerender — every page on it is a read of a live square — so the split
 * would buy a second file to keep in step with the first.
 *
 * `test/routes.test.ts` reads THIS file as text and cross-checks the `path=` strings against
 * `ROUTES` in `lib/routes.ts` and against the enumerated `location` block in `nginx.conf`. Three
 * places have to agree; none of them can be derived from the others (nginx cannot import TypeScript
 * and the router will not accept a runtime-built element list without losing the static readability
 * the test depends on), so the agreement is checked rather than assumed.
 *
 * ── EVERY PAGE IS LAZY EXCEPT THE SQUARE ──────────────────────────────────────────────────────
 *
 * The Square and a thread are what a stranger arrives on; the moderation queue is a page four
 * people will ever open. Splitting them means the first paint does not carry the settings form, the
 * whisper pane and the report queue. `SquarePage` and `ThreadPage` are imported EAGERLY because
 * they are the two first paints that matter, and a lazy boundary on the landing route is a spinner
 * where the content should be.
 *
 * ── AND THERE IS NO ROUTE GUARD IN THIS TABLE ─────────────────────────────────────────────────
 *
 * The six `private: true` routes wrap their own bodies in `RequireSession`, which renders a panel
 * and KEEPS THE ADDRESS rather than redirecting — see the argument on that component. A guard here
 * would have to redirect, and a reader who opens a bookmarked `/whispers` in a fresh browser
 * session would land on the Square with no explanation and no way back to where they were going.
 */
import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { BASE } from './lib/routes.ts'
import { ScrollToTop } from './components/scroll-to-top.tsx'
import { AppShell } from './components/shell.tsx'
import { Loading } from './components/states.tsx'
import { AuthProvider } from './lib/auth.tsx'
import SquarePage from './pages/square.tsx'
import ThreadPage from './pages/thread.tsx'

const HomePage = lazy(() => import('./pages/home.tsx'))
const VoicePage = lazy(() => import('./pages/voice.tsx'))
const TagPage = lazy(() => import('./pages/tag.tsx'))
const CirclesPage = lazy(() => import('./pages/circles.tsx'))
const CirclePage = lazy(() => import('./pages/circle.tsx'))
const NotificationsPage = lazy(() => import('./pages/notifications.tsx'))
const WhispersPage = lazy(() => import('./pages/whispers.tsx'))
const BookmarksPage = lazy(() => import('./pages/bookmarks.tsx'))
const SearchPage = lazy(() => import('./pages/search.tsx'))
const SettingsPage = lazy(() => import('./pages/settings.tsx'))
const GuidelinesPage = lazy(() => import('./pages/guidelines.tsx'))
const ModerationPage = lazy(() => import('./pages/moderation.tsx'))
const NotFoundPage = lazy(() => import('./pages/not-found.tsx'))

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<SquarePage />} />
        <Route path="home" element={<HomePage />} />
        <Route path="p/:id" element={<ThreadPage />} />
        <Route path="v/:handle" element={<VoicePage />} />
        <Route path="tag/:tag" element={<TagPage />} />
        <Route path="circles" element={<CirclesPage />} />
        <Route path="circles/:slug" element={<CirclePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="whispers" element={<WhispersPage />} />
        <Route path="bookmarks" element={<BookmarksPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="guidelines" element={<GuidelinesPage />} />
        <Route path="moderation" element={<ModerationPage />} />
        {/*
          Unknown addresses render inside the shell, so the reader keeps the navigation they need to
          get back out — under a REAL 404, which `nginx.conf` preserves by enumerating the routes
          above and letting everything else fall to `error_page 404 /index.html`.
        */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter basename={BASE}>
      <ScrollToTop />
      {/*
        `AuthProvider` is outside the router because the chrome reads it and the chrome is rendered
        by the shell, which is a route element. `VoiceProvider` is NOT here: it lives inside the
        shell keyed by the viewed network, because a voice belongs to one square and must not
        survive a switch. See `components/shell.tsx`.
      */}
      <AuthProvider>
        {/*
          One boundary around the whole table rather than one per route. The fallback is the same
          three dots every timeline uses, so a chunk that is still arriving looks like a page that is
          still loading — which is what it is.
        */}
        <Suspense fallback={<Loading label="Loading" />}>
          <AppRoutes />
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
