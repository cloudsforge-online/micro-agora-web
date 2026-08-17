/**
 * An address this app does not have.
 *
 * ── IT IS SERVED UNDER A REAL 404, WHICH TOOK WORK ────────────────────────────────────────────
 *
 * A single-page app's usual `try_files $uri /index.html` answers **200** for every address in
 * existence. A typo in somebody's link then becomes a page that says "not found" while telling every
 * crawler the address is fine, and the square accumulates indexed nothing. So `nginx.conf` matches
 * only the routes `lib/routes.ts` enumerates and lets everything else fall to `error_page 404
 * /index.html`, which serves this shell UNDER the 404 status. `test/routes.test.ts` cross-checks the
 * two lists in both directions, because the failure is silent in both.
 *
 * ── AND IT OFFERS THE THREE THINGS SOMEBODY AT A DEAD ADDRESS ACTUALLY WANTS ──────────────────
 *
 * Not a nav menu, and not a search box that searches posts for a URL fragment. The realistic ways
 * somebody arrives here are a stale link to a deleted post, a mistyped handle, and a link to the
 * other square — and the third is the one worth naming out loud, because mainnet and testnet hold
 * genuinely different posts and a reader who does not know that reads the emptiness as a fault.
 */
import { Link, useLocation } from 'react-router-dom'
import { useTitle } from '../components/shell.tsx'
import { viewedNetwork } from '../lib/viewed.ts'

export default function NotFoundPage() {
  useTitle('Not found')
  const { pathname } = useLocation()
  const testnet = viewedNetwork() === 'testnet'

  return (
    <section className="ag-state ag-state--missing ag-notfound">
      <span aria-hidden="true" className="ag-state__glyph">
        ⌀
      </span>
      <h1 className="ag-state__title">There is nothing at this address</h1>
      {/*
        The path is shown because it is what the reader typed or clicked, and seeing it is how they
        spot the missing letter. It is rendered as text in a <code>, never as a link, and
        `lib/analytics.ts` reports the pattern `/unknown` rather than this string.
      */}
      <p className="ag-notfound__path">
        <code>{pathname}</code>
      </p>
      <p className="ag-state__hint">
        It may have been deleted, it may never have existed, or it may be on{' '}
        {testnet ? 'the mainnet square' : 'the testnet square'} — the two hold different posts and
        different handles, and a link from one does not resolve on the other.
      </p>
      <div className="ag-state__action">
        <Link className="ag-btn ag-btn--primary" to="/">
          Go to the square
        </Link>
        <Link className="ag-btn" to="/circles">
          Browse circles
        </Link>
        <Link className="ag-btn" to="/search">
          Search
        </Link>
      </div>
    </section>
  )
}
