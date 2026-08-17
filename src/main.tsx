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
 * So `lib/analytics.ts` registers a PAGE FIELDS PROVIDER with `@cloudsforge/ui/consent`, which
 * reports the route PATTERN (`/v/:handle`) in place of the address. The gate applies it the moment
 * it is registered and again immediately before the `config` it pushes, and `config` is what sends
 * the tag's automatic first page view — which is exactly why this call has to precede
 * `initAnalytics()`. Registered afterwards, the provider would be applied after the first `config`,
 * and the first page view — the one naming the address a stranger arrived on — would carry the real
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
import { primeAnalyticsRedaction } from './lib/analytics.ts'
import { initObs } from './lib/obs.ts'
import { bootstrapSession } from './lib/api.ts'

initObs()

primeAnalyticsRedaction()
initAnalytics()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

void bootstrapSession().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
