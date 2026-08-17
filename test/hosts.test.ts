/**
 * Where this bundle sends a request, decided by the address it was served from and nothing else.
 *
 * The whole of the argument is in `src/lib/hosts.ts`; what is pinned here is the half that can be
 * asserted without a browser, because it is the half that decides which square a post lands in.
 *
 * ── WHY A PURE FUNCTION IS WORTH HAVING AT ALL ────────────────────────────────────────────────
 *
 * `apiBase()` reads `window.location` and the module-scoped network view, so a test of it is a test
 * of two globals. `resolveApiBase(hostname)` is the one question that has an answer independent of
 * both — "is this a development stack, where micro-agora is at a different port than vite" — and
 * keeping it separate is what lets the production answer be stated as a fact rather than as a
 * fixture: for every address the estate actually serves, the base is the EMPTY STRING and every
 * request stays relative to the page.
 *
 * That matters more here than on a surface made of numbers. A base that resolved to the wrong
 * origin would not break the page; it would render a working timeline and put a reply in front of
 * the wrong room, and there is no undo for having said something to the wrong people.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLocal, resolveApiBase } from '../src/lib/hosts.ts'

test('every address the estate serves resolves to a relative base', () => {
  // One origin: nginx serves the bundle at `agora.<apex>`, micro-agora answers `/v1/…` behind the
  // same hostname, and the gateway splits them by path (bundle at priority 500, `PathPrefix('/v1')`
  // at 600). A composed absolute origin here would be a second address for the same service, and
  // the one nobody tests.
  for (const hostname of [
    'agora.cloudsforge.online',
    'agora-testnet.cloudsforge.online',
    'agora.cloudsforge.localtest.me',
  ]) {
    assert.equal(resolveApiBase(hostname), '', `${hostname} does not stay relative`)
  }
})

test('an unregistered placement stays relative too, rather than inventing a hostname', () => {
  // A preview deployment or somebody's tunnel is not an address this repository knows. Composing
  // `https://agora.<whatever-this-is>` would name a host that does not exist and the failure would
  // present as a network error rather than as the misplacement it is. A relative request at least
  // reaches whatever is serving the bundle, and the shell says the placement is unregistered.
  assert.equal(resolveApiBase('agora.somebodys-preview.example'), '')
})

test('a development stack addresses micro-agora on its own port, not vite', () => {
  // 4150 is the service. 5197 is vite. A relative request in dev would ask the dev server for
  // `/v1/timeline/latest` and get index.html back with a 200, which is the failure that reads as
  // "the API returns HTML".
  for (const hostname of ['localhost', '127.0.0.1', '', 'mac.local']) {
    assert.equal(resolveApiBase(hostname), 'http://localhost:4150', `${hostname} misresolved`)
  }
})

test('the four development names are the registry’s four, and no others', () => {
  // `cloudsforgeHosts()` treats exactly these as development. A fifth name here would be a host the
  // registry resolves as an apex and this file resolves as a laptop, and the two would disagree
  // about where the service is.
  assert.deepEqual(
    ['', 'localhost', '127.0.0.1', 'mac.local', 'agora.cloudsforge.online'].map(isLocal),
    [true, true, true, true, false],
  )
})
