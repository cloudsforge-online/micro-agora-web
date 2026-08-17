/**
 * The boot sequence. The order is not arbitrary.
 *
 *   1. `initObs()` first, so an exception thrown by anything below is reported rather than lost.
 *   2. `primeAnalyticsRedaction()` — BEFORE the tag can be injected. See below.
 *   3. `initAnalytics()`, which loads the third-party tag only if this reader granted consent on a
 *      previous visit.
 *   4. `bootstrapSession()`, awaited, so the chrome never flashes signed-out and then signed-in.
 *   5. Render.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * STEP 2 IS PARTICULAR TO THIS SURFACE AND IT MUST STAY WHERE IT IS.
 *
 * Every address here names a person or a conversation: `/v/<handle>`, `/p/<id>`, `/tag/<tag>`,
 * `/search?q=…`. GA4 reads `page_location` off `document.location` by itself, so a page view
 * reported normally tells Google which browser read which person, and about what. A reader who
 * accepted analytics agreed to be counted; they did not agree to hand over a reading list.
 *
 * `@cloudsforge/ui/consent` has no hook for that — `grantConsent()` issues a plain
 * `gtag('config', …)` — so `lib/analytics.ts` pushes a `gtag('set', …)` carrying the route PATTERN
 * (`/v/:handle`) onto the dataLayer BEFORE the tag exists. The dataLayer is a plain array until the
 * script loads and processes it in order, which is exactly why this call has to precede
 * `initAnalytics()`: a `set` pushed afterwards would be processed after the first `config`, and the
 * first page view — the one that names the address a stranger arrived on — would carry the real
 * path.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `createRoot`, not `hydrateRoot`. Nothing here is prerendered: every page is a read of a live
 * square, and there is no meaningful static version of "what people are saying right now".
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@cloudsforge/ui/tokens.css'
import '@cloudsforge/ui/ui.css'
import './styles.css'
import { initAnalytics } from '@cloudsforge/ui/consent'
import { App } from './app.tsx'
import { primeAnalyticsRedaction, watchConsentForRedaction } from './lib/analytics.ts'
import { initObs } from './lib/obs.ts'
import { bootstrapSession } from './lib/api.ts'

initObs()

primeAnalyticsRedaction()
initAnalytics()
// Consent can be granted mid-session, from the banner, which issues a fresh `config`. The watcher
// re-asserts the redaction at that moment; without it the first page view AFTER an Accept press
// would carry the concrete path — the one case the priming above cannot cover.
watchConsentForRedaction()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

void bootstrapSession().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
