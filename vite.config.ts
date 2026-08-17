import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * There is deliberately no `define`, no `envPrefix` and no `.env` file in this repository.
 *
 * A build-time constant is an environment baked into an image, and an image with an environment
 * baked into it has to be rebuilt to be promoted — so the artefact that reaches production is not
 * the artefact that passed CI. Every host this app talks to is resolved at RUNTIME from
 * `window.location.hostname`; see `src/lib/hosts.ts`. `test/no-build-time-config.test.ts` fails the
 * build if `import.meta.env.VITE_` ever appears.
 *
 * The version of that rule particular to THIS surface is about which square somebody is reading.
 * A `VITE_API_URL` would mean an image built for mainnet, and the failure would not be a broken
 * page — it would be a working one: the timeline renders, the composer is live, and a post the
 * reader believed they were writing on testnet lands in front of everybody on mainnet. Words are
 * not a transaction that can be reverted. The API origin is derived from the page address and the
 * viewed network (`src/lib/viewed.ts`), so the amber band and the square being read can never
 * disagree.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    // @cloudsforge/ui is a `link:` dependency, so its own node_modules holds a second copy of
    // React. Two copies means two dispatchers, and the shared bar throws on its first useState.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // The linked package is edited in the same working tree until it is published; pre-bundling
    // it would freeze a stale copy.
    exclude: ['@cloudsforge/ui'],
  },
  build: {
    // The assets are immutable-cached by nginx, which is only safe when every rebuild produces a
    // new filename. Sourcemaps so a Lantern stack trace names a line somebody can find.
    sourcemap: true,
  },
  // 5197. The estate's frontends sit in 5170–5199, and this number was checked against every
  // sibling `vite.config.ts` rather than incremented from the nearest one: two frontends on one
  // port is not a bind error you notice once and fix, because whichever `pnpm dev` starts second
  // fails and whichever started first goes on answering — so the symptom is one surface being
  // served at another's address.
  //
  // It is NOT this surface's `devPort` in `ui/packages/ui/src/surfaces.ts`, and that is the normal
  // case rather than the exception: a devPort is the port of the thing you CALL, and what a
  // developer calls for `agora` is `micro-agora` on 4150. `exchange` names its own dev server
  // there only because it has no service to name.
  server: { port: 5197 },
  preview: { port: 5197 },
})
