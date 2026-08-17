/**
 * The published rules and the rules the service can actually enforce, held to each other.
 *
 * `pages/guidelines.tsx` is the page an operator links to when they suspend somebody. Two things
 * make it worth a test rather than a proofread:
 *
 *   A REASON THAT IS PUBLISHED BUT NOT IN `ReportReason` is a rule nobody can report a breach of.
 *   The reader finds the sentence, opens the report form, and there is no option for it.
 *
 *   AN ACTION IN `ModerationActionKind` THAT IS NOT PUBLISHED is the thing this page exists to
 *   prevent. The page says "these are all of them. There is no shadow-ban" — and an unpublished
 *   action makes that sentence false the day somebody adds one, silently, in another repository.
 *
 * Both are read as TEXT rather than imported: `guidelines.tsx` is a React component whose import
 * graph reaches the design system's CSS, and a rules-vs-service check should not be able to go red
 * because a stylesheet moved.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { read, stripComments } from './sources.ts'

const page = stripComments(read('src/pages/guidelines.tsx'), 'ts')
const agora = stripComments(read('src/lib/agora.ts'), 'ts')

/** The members of a string-union type declaration, in source order. */
function unionMembers(source: string, name: string): string[] {
  const body = new RegExp(`export type ${name} =([\\s\\S]*?)\\n\\n`).exec(source)?.[1] ?? ''
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '')
}

/** The top-level keys of an exported object literal. */
function recordKeys(source: string, name: string): string[] {
  const body = new RegExp(`export const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? ''
  return [...body.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1] ?? '')
}

const REASONS = recordKeys(page, 'REASONS')
const OUTCOMES = recordKeys(page, 'OUTCOMES')
const reportReasons = unionMembers(agora, 'ReportReason')
const actionKinds = unionMembers(agora, 'ModerationActionKind')

test('both files are being parsed, and neither list is empty', () => {
  assert.ok(reportReasons.length >= 5, `ReportReason parsed as ${reportReasons.join(',')}`)
  assert.ok(actionKinds.length >= 5, `ModerationActionKind parsed as ${actionKinds.join(',')}`)
  assert.ok(REASONS.length >= 5, `REASONS parsed as ${REASONS.join(',')}`)
  assert.ok(OUTCOMES.length >= 5, `OUTCOMES parsed as ${OUTCOMES.join(',')}`)
})

test('EVERY REPORTABLE REASON IS PUBLISHED, AND EVERY PUBLISHED REASON IS REPORTABLE', () => {
  assert.deepEqual(
    [...REASONS].sort(),
    [...reportReasons].sort(),
    'the guidelines page and ReportReason disagree. A reason on the page that the form cannot ' +
      'send is a rule nobody can report; a reason the form sends that the page does not list is a ' +
      'rule enforced without being published.',
  )
})

test('EVERY ACTION AN OPERATOR CAN TAKE IS PUBLISHED', () => {
  assert.deepEqual(
    [...OUTCOMES].sort(),
    [...actionKinds].sort(),
    'the guidelines page and ModerationActionKind disagree. The page claims to list all of them.',
  )
})

test('the page is public, indexed, and one of the two robots.txt allows', () => {
  // A square with no published rules is a square where the rules are whatever the operator felt
  // like that morning, and every enforcement then reads as arbitrary — including the fair ones.
  const nginx = stripComments(read('nginx.conf'), 'nginx')
  const disallowed = [...nginx.matchAll(/Disallow: (\S+)/g)].map((m) => m[1] ?? '')
  assert.ok(!disallowed.includes('/guidelines'))
  assert.match(nginx, /<loc>[^<]*\/guidelines<\/loc>/, 'the sitemap omits the guidelines')
})

test('the page states the fact about the two squares, which nothing else on the surface does', () => {
  // A suspension on mainnet does not carry to testnet and nothing written on one appears on the
  // other. That is surprising, it is load-bearing for anybody who reads both, and the amber band in
  // the chrome says which square you are on without ever saying there are two.
  assert.match(page, /two squares/i)
  assert.match(page, /Mainnet and testnet/)
})

test('the page says out loud that the operator is also the counterparty', () => {
  // The Agora is run by the same people who run the exchange, the wallet and the chain. On a square
  // about money that is a conflict, and the honest place to state it is the rules page.
  assert.match(page, /Nothing here is financial advice, including from us/)
  assert.match(page, /exchange, the wallet and the chain/)
})

test('the reader is pointed at the controls that need no operator at all', () => {
  // Most of what people want is not a moderator. Hush and Bar do the work, and a rules page that
  // lists only the reporting path teaches everybody to report instead.
  for (const control of ['Hush', 'Bar']) {
    assert.ok(page.includes(`<strong>${control}</strong>`), `the page does not explain ${control}`)
  }
  assert.match(page, /<Link to="\/settings">/)
})

test('each published reason and outcome is a sentence, not a label', () => {
  // "Spam" alone is not a rule — it is a word two people will read differently, and the argument
  // afterwards is about what it meant. Every entry carries the sentence that settles it.
  const bodies = [...page.matchAll(/body:\s*\n?\s*'([^']+)'/g)].map((m) => m[1] ?? '')
  assert.equal(bodies.length, REASONS.length, 'a reason has no body')
  for (const body of bodies) {
    assert.ok(body.length > 60, `a reason is explained in ${body.length} characters: ${body}`)
  }
})
