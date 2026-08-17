/**
 * The absence that `lib/format.ts` calls the security boundary of this surface.
 *
 * `tokenize()` returns data and React escapes every string it puts in a text node, so a post
 * containing `<script>` is five characters on the screen. That argument holds only while there is
 * no path from a post body to `innerHTML` — and there is exactly one way to build such a path in
 * React, plus a handful in plain DOM. This file greps `src/` for all of them.
 *
 * It is a text test because that is the only kind that can prove an ABSENCE. A render test proves
 * that the components which exist today are safe; it says nothing about the one somebody adds next
 * month to render a post with bold text in it, which is precisely the change that would introduce
 * this and precisely the change whose author would be sure it was fine.
 *
 * Comments are stripped first: `lib/format.ts` names `dangerouslySetInnerHTML` in order to say
 * there is none, and a rule that can only be satisfied by deleting the paragraph explaining it is a
 * rule the next person deletes.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceFiles, stripComments } from './sources.ts'

const sources = sourceFiles().map(({ path, text }) => ({ path, text: stripComments(text, 'ts') }))

test('the source tree is being read at all', () => {
  // If `sourceFiles()` ever returns nothing — a moved directory, a changed extension list — every
  // assertion below passes vacuously, which is the failure mode of every grep test ever written.
  assert.ok(sources.length > 20, `only ${sources.length} source files were found`)
  assert.ok(sources.some((f) => f.path === 'src/components/post.tsx'))
})

test('NOTHING IN THIS BUNDLE WRITES HTML FROM A STRING', () => {
  const forbidden = [
    // The React one. Everything else on this list is reachable only by leaving React.
    'dangerouslySetInnerHTML',
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'document.write',
    // Not markup, but the same shape of mistake: a string from somewhere becoming code.
    'eval(',
    'new Function(',
  ]
  for (const { path, text } of sources) {
    for (const needle of forbidden) {
      assert.ok(
        !text.includes(needle),
        `${path} contains ${needle}. A post body is text somebody else wrote, shown to everybody; ` +
          'the defence in lib/format.ts is that nothing here ever produces HTML, and this is that.',
      )
    }
  }
})

test('every href a post can produce has been through the scheme check', () => {
  // Escaping stops `<script>`. It does not stop `javascript:` in an `href`, which is a well-formed
  // attribute value React passes straight through — and clicking it runs script in this origin,
  // where the session is. So an `href` on this surface comes from a `link` token, and the only
  // thing that mints one is `safeHref`.
  const post = sources.find((f) => f.path === 'src/components/post.tsx')?.text ?? ''
  assert.ok(post.length > 0, 'src/components/post.tsx was not read')
  const hrefs = [...post.matchAll(/href=\{([^}]+)\}/g)].map((m) => (m[1] ?? '').trim())
  for (const expression of hrefs) {
    assert.match(
      expression,
      /\btoken\.href\b|\bsafeHref\b/,
      `src/components/post.tsx sets href={${expression}}, which did not come from safeHref`,
    )
  }
})

test('no component builds a URL by concatenation where a builder exists', () => {
  // `to="/v/" + handle` is not a security hole — React Router escapes it — but it is how the route
  // table and the addresses actually linked drift apart, and `lib/routes.ts` owns both.
  for (const { path, text } of sources) {
    if (path === 'src/lib/routes.ts') continue
    assert.doesNotMatch(
      text,
      /to=\{`\/(?:v|p|tag|circles)\//,
      `${path} builds an address inline; lib/routes.ts has a builder for it`,
    )
  }
})

test('the tokenizer is the only thing that turns a body into pieces', () => {
  // A second parser is how the first one's rules stop being the rules. If a component ever needs
  // to split a body differently, it belongs in lib/format.ts beside this one.
  const parsers = sources.filter(
    (f) => f.path !== 'src/lib/format.ts' && /\bmatchAll\(|\bsplit\(\/.*https?/.test(f.text),
  )
  assert.deepEqual(
    parsers.map((f) => f.path),
    [],
    'a second body parser exists; lib/format.ts is where a change to what a post may become goes',
  )
})

test('no source file carries a secret, a token or an absolute estate hostname', () => {
  // A frontend bundle is public by construction: everything in it is served to everybody. The
  // hostname half is the same rule vite.config.ts states — an address baked in here is an image
  // that has to be rebuilt to be promoted.
  for (const { path, text } of sources) {
    assert.doesNotMatch(text, /\bBearer [A-Za-z0-9._-]{16,}/, `${path} carries a bearer token`)
    assert.doesNotMatch(text, /\b(?:secret|password|apiKey|api_key)\s*[:=]\s*['"][^'"]+['"]/i, `${path} carries a credential`)
    if (path === 'src/lib/hosts.ts') continue
    assert.doesNotMatch(
      text,
      /https:\/\/[a-z-]*\.?cloudsforge\.online/,
      `${path} hard-codes an estate hostname; hosts are derived at runtime in lib/hosts.ts`,
    )
  }
})
