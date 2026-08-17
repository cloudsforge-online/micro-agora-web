/**
 * The network the reader is VIEWING — in-app network context (micro-org#459, the combined view).
 *
 * The whole argument lives on `createNetworkView` in `@cloudsforge/ui/network-view`, once, instead
 * of in every bundle: nothing is persisted (module memory, per tab, which is what leaves the
 * estate's no-stored-network invariant intact), the default is the hostname's own network, the
 * viewed network is always on screen because the bar's switcher shows it and the amber band follows
 * it, and `?net=` is what carries a choice across a product switch because every surface is its own
 * origin.
 *
 * ── WHAT VIEWING THE OTHER NETWORK MEANS ON A SURFACE MADE OF SENTENCES ───────────────────────
 *
 * Everywhere else in the estate the two networks hold the same KIND of thing at different stakes —
 * a testnet balance is a real balance of a coin worth nothing. Here they hold different things
 * outright: two separate squares, two sets of posts, two sets of handles, and nobody's reply on one
 * is visible on the other. Switching is closer to changing rooms than to changing units.
 *
 * That makes the band above the timeline load-bearing rather than decorative, and it is why nothing
 * in this bundle caches a post across a switch: `<Outlet key={viewed}>` in the shell remounts every
 * page when the network changes, so a stale reply from the other square cannot be left on screen
 * under a heading that now names this one.
 *
 * Construct it ONCE, here, at module scope. A second instance would read `?net=` again and then
 * hold its own independent answer, and the two would disagree the moment the reader clicks.
 *
 * `deploy/scripts/surface-routes.py` check 10 reads this file BY PATH. It is the witness that
 * `viewsAnyNetwork: true` on this surface's registry row is a claim about a bundle rather than a
 * line in a table, and that row is what earns this origin its place in the gateway's
 * cross-environment CORS grant. Deleting this file without clearing the row would leave a
 * credentialed cross-origin allowance that nothing performs.
 */

import { createNetworkView } from '@cloudsforge/ui/network-view'

export type { ViewedNetwork } from '@cloudsforge/ui/network-view'

export const { viewedNetwork, setViewedNetwork, viewedApiOrigin, viewedSurfaceUrl, viewedHosts } =
  createNetworkView()
