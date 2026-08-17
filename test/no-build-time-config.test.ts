/**
 * One artefact, four environments, and no way to tell which one it was built for.
 *
 * A build-time constant is an environment baked into an image, and an image with an environment
 * baked into it has to be REBUILT to be promoted — so the thing that reaches production is not the
 * thing that passed CI. Every address this bundle uses is derived at runtime from
 * `window.location.hostname` and the network the reader is viewing.
 *
 * ── THE VERSION OF THAT RULE PARTICULAR TO THIS SURFACE ───────────────────────────────────────
 *
 * Everywhere else, a wrongly-baked API origin produces a broken page: a spinner, an error panel,
 * something obviously wrong. Here it produces a WORKING one. The timeline renders, the composer is
 * live, and a post somebody believed they were writing on testnet lands in front of everybody on
 * mainnet. Words are not a transaction that can be reverted, and there is no undo for having said
 * something to the wrong room.
 *
 * So the API origin comes from the page address and `lib/viewed.ts`, and the amber band in the
 * chrome and the square being read cannot disagree.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ENV_LABELS } from '@cloudsforge/ui'
import { ROOT, read, sourceFiles, stripComments } from './sources.ts'

const sources = sourceFiles().map(({ path, text }) => ({ path, text: stripComments(text, 'ts') }))
const vite = stripComments(read('vite.config.ts'), 'ts')
const nginx = stripComments(read('nginx.conf'), 'nginx')

test('NOTHING IN src/ READS A BUILD-TIME CONSTANT', () => {
  for (const { path, text } of sources) {
    assert.ok(!text.includes('import.meta.env'), `${path} reads import.meta.env`)
    assert.ok(!text.includes('process.env'), `${path} reads process.env`)
    assert.ok(!/\bVITE_[A-Z_]+/.test(text), `${path} names a VITE_ variable`)
    assert.ok(!text.includes('__DEV__') && !text.includes('__BUILD'), `${path} reads a define`)
  }
})

test('the build has no way to inject one either', () => {
  // The three vite features that would make the rule above unenforceable. Absent, a `VITE_` in a
  // source file is a typo that reads `undefined`; present, it is a working configuration mechanism
  // and somebody will use it.
  assert.ok(!/\bdefine\s*:/.test(vite), 'vite.config.ts declares define')
  assert.ok(!vite.includes('envPrefix'), 'vite.config.ts declares envPrefix')
  assert.ok(!vite.includes('loadEnv'), 'vite.config.ts calls loadEnv')
  for (const name of ['.env', '.env.local', '.env.production', '.env.development']) {
    assert.ok(!existsSync(join(ROOT, name)), `${name} exists`)
  }
})

test('the Dockerfile takes one build argument, and it is an identity rather than a configuration', () => {
  // `RELEASE` names the artefact; it does not tell it where it is running. Any other build arg is
  // an environment, and the image stops being promotable the moment one exists.
  const args = [...read('Dockerfile').matchAll(/^ARG\s+([A-Z_]+)/gm)].map((m) => m[1] ?? '')
  assert.deepEqual(args, ['RELEASE'], `the Dockerfile takes build args: ${args.join(', ')}`)
})

test('THE NGINX ENVIRONMENT MAP AND THE REGISTRY AGREE ON WHAT AN ENVIRONMENT IS', () => {
  // `$cf_env` decides whether this host gets a sitemap and whether robots.txt refuses every crawler.
  // A label the registry knows and nginx does not is a non-production square that gets indexed
  // beside the real one; the reverse is a production square with no sitemap at all.
  const alternation = /~\^\(\?:\[\^\.\]\+-\)\?\(\?:([^)]+)\)\\\./.exec(nginx)?.[1]
  assert.ok(alternation, 'the $cf_env map has changed shape and is no longer being read')
  assert.deepEqual([...alternation.split('|')].sort(), [...ENV_LABELS].sort())
})

test('the map matches both hostname shapes, because the estate has served both', () => {
  // `agora-testnet.<apex>` now and `testnet.<apex>` before it. The suffix shape exists because
  // Cloudflare's Universal SSL wildcard matches exactly ONE label, so `agora.testnet.<apex>` has no
  // certificate — and a hostname with no certificate is not a hostname anybody reaches.
  assert.match(nginx, /\(\?:\[\^\.\]\+-\)\?/)
  assert.match(nginx, /default '';/)
})

test('the API origin is a function call, never a module constant', () => {
  // A module-level string is captured on first import and goes on naming the network the tab opened
  // on. Every read calls this at request time, so switching the network re-points the very next
  // fetch — which is what makes the amber band tell the truth.
  const hosts = sources.find((f) => f.path === 'src/lib/hosts.ts')?.text ?? ''
  assert.match(hosts, /export function apiBase\(\): string \{/)
  assert.doesNotMatch(hosts, /export const (?:API_BASE|apiBase)\s*=/)
  for (const { path, text } of sources) {
    if (path === 'src/lib/hosts.ts') continue
    assert.doesNotMatch(
      text,
      /^\s*const [A-Z_]*(?:API|BASE|ORIGIN)[A-Z_]* = `?https?:/m,
      `${path} captures an origin at module scope`,
    )
  }
})

test('every network-dependent read goes through the viewed network, not the serving hostname', () => {
  // The distinction this estate learned the hard way: the container serving the page and the square
  // the reader is looking at are different questions, and reading the first to answer the second is
  // why a testnet tile once showed mainnet numbers on four surfaces at once.
  //
  // `apiBase` reads the hostname too, and that is not the same mistake: the hostname decides ONLY
  // whether this is a development stack, where there is no sibling estate to view at all. What this
  // pins is that the viewed network is consulted for every other placement — take `viewedApiOrigin`
  // out of the body and production goes back to answering from whichever container served the page.
  const hosts = sources.find((f) => f.path === 'src/lib/hosts.ts')?.text ?? ''
  const body = /export function apiBase\(\): string \{([\s\S]*?)\n\}/.exec(hosts)?.[1] ?? ''
  assert.ok(body, 'apiBase is no longer a function declaration this test can read')
  assert.match(body, /viewedApiOrigin\(\)/, 'apiBase does not consult the viewed network')
  // The hostname may only reach `resolveApiBase`, which is the pure dev-stack question. A direct
  // `https://…${hostname}` in this body would be a composed origin, and a composed origin is how a
  // preview deployment ends up addressing a square that does not exist.
  assert.doesNotMatch(body, /`https?:/, 'apiBase composes an origin out of the serving hostname')
})

test('the dev server port is unique in the estate and is not the service port', () => {
  // Two frontends on one port is not a bind error anybody notices: whichever `pnpm dev` starts
  // second fails, whichever started first goes on answering, and the symptom is one surface being
  // served at another's address.
  assert.match(vite, /server: \{ port: 5197 \}/)
  assert.match(vite, /preview: \{ port: 5197 \}/)
  // 4150 is micro-agora's port — what a developer on this surface CALLS, not what vite serves.
  assert.ok(!/port: 4150/.test(vite))
})

test('the container listens on 8080, because nothing in it is root', () => {
  // nginx-unprivileged. A non-root process cannot bind 80, and a `listen 80` here produces a
  // container that starts, logs a permission error and never serves anything.
  assert.match(nginx, /listen 8080;/)
  assert.doesNotMatch(nginx, /listen 80;/)
})
