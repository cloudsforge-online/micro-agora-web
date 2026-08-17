# micro-agora-web

[![ci](https://github.com/cloudsforge-online/micro-agora-web/actions/workflows/ci.yml/badge.svg)](https://github.com/cloudsforge-online/micro-agora-web/actions/workflows/ci.yml)
![licence](https://img.shields.io/badge/licence-MIT-97CA00)
![node](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![module](https://img.shields.io/badge/module-ESM-F7DF1E?logo=javascript&logoColor=black)

The public front for **Forge Agora**, the ecosystem's square: posts, replies, circles and whispers,
with the CloudsForge account somebody already has. A static SPA served by nginx — no Node, no
toolchain and no environment in the image. Everything on every page comes from
[`micro-agora`](https://github.com/cloudsforge-online/micro-agora), one service with one database,
called from the reader's own browser with the reader's own bearer.

> ## **The account is the point, and it is the only thing this surface asks for.**
>
> Every other network's front page is a sign-up form. This one's index is a readable timeline,
> because the reader already has an account — the same one that signs into the wallet, the market
> and everything else in the estate. There is no second registration, no second password, and no
> profile to fill in before anything is visible.

## Routes this app serves

Fourteen, and `ROUTES` in `src/lib/routes.ts` is the single table. The `<Route>` elements in
`src/app.tsx` and the enumerated `location` block in `nginx.conf` are checked against it as text by
`test/routes.test.ts`, because three hand-maintained lists that must agree is two lists too many to
trust.

| Path              | What it is                                                         | Signed in |
| ----------------- | ------------------------------------------------------------------ | --------- |
| `/`               | The Square — the public timeline of the viewed network             | no        |
| `/home`           | The reader's own feed: voices followed, circles joined             | yes       |
| `/p/:id`          | One post and its thread. **The** address of this surface           | no        |
| `/v/:handle`      | One voice, by handle                                               | no        |
| `/tag/:tag`       | One topic                                                          | no        |
| `/circles`        | The directory of public circles                                    | no        |
| `/circles/:slug`  | One circle: its purpose, its members, its posts                    | no        |
| `/notifications`  | What happened while the reader was away                            | yes       |
| `/whispers`       | Private messages                                                   | yes       |
| `/bookmarks`      | What the reader saved — and a bookmark is not a Spark              | yes       |
| `/search`         | Posts, voices and tags                                             | no        |
| `/settings`       | The voice, the mail preferences, who may whisper, who may read     | yes       |
| `/guidelines`     | What is allowed, and what happens when somebody reports a post     | no        |
| `/moderation`     | The report queue                                                   | operator  |

A **whisper thread is `?t=`, not a path segment**: a path is what a browser puts in history, in a
referrer and in the address bar of a screen somebody is sharing, and a thread id names a private
conversation with one other person.

`/moderation` being an address rather than a panel inside settings is for the people who work the
queue repeatedly; the nav entry is hidden, but the nav entry is not the control. micro-agora's
`requireOperator` refuses the routes behind it, so a reader who types the address gets an empty page
and a 403, not somebody else's reports.

### Everything unknown is a real 404

The usual SPA fallback is `try_files $uri /index.html`, which answers **200 for every address in
existence** — so a "page not found" screen is a success, crawlers index it, and a deploy that drops
a route looks exactly like a deploy that did not. The twelve first segments are therefore enumerated
in `nginx.conf` and everything else falls through to `error_page 404 /index.html`: the same bundle,
the honest status, with React rendering `NotFoundPage` inside it.

`/p/<id>` is why this matters more here than elsewhere. A post link is the thing people paste into
chats, and it has to survive a refresh, a cold open and a crawler.

## The privacy decision this repository exists to hold

**On this surface the path is the private part.** Everywhere else in the estate a path is a noun —
`/pools`, `/status`, `/markets/ember-usd`. Here every address names a person or a conversation:

    /v/nefeli          which person this browser reads
    /p/9f2c…           which conversation
    /tag/mining        what they are interested in
    /search?q=…        what they typed

GA4 records `page_location` and `page_path` on every event by itself, from `document.location`. So
the stock behaviour on this surface is a third-party log of who reads whom. A reader who accepted
analytics agreed to be **counted**, not to hand over a reading list.

So `lib/analytics.ts` and `lib/obs.ts` report `routePattern(pathname)` — `/v/:handle`, never
`/v/nefeli` — and both derive it from `ROUTES`, so adding a route adds its redaction in the same
commit. An address matching nothing becomes `/unknown` rather than being passed through, because the
fallback is exactly where an unexpected path would leak. Query strings and hashes are dropped
unconditionally; an allowlist of "safe" parameters is a list somebody eventually adds one more entry
to. `page_title` is the constant `'Forge Agora'`, because this surface's titles carry the handle and
the first line of the post — the identifiers the path was just stripped of.

The one number this deliberately loses is per-post popularity in GA. micro-agora counts its own
posts server-side, where the data already is.

`test/analytics.test.ts` and `test/obs.test.ts` walk every route with concrete identifiers in it and
assert the substrings are absent from what would be sent.

**The canonical link does the opposite and carries the concrete path** — that is its job, and it is
first-party.

## What it talks to

One service, one base address, composed at request time:

```
apiBase() → resolveApiBase(hostname) || viewedApiOrigin()

  agora.cloudsforge.online   → ''                                    → /v1/…            (relative)
  …viewing testnet           → 'https://agora-testnet.cloudsforge.online'
  localhost:5197             → 'http://localhost:4150'               (micro-agora's own port)
```

In production the bundle and the service are **one origin**: nginx serves this bundle at
`agora.<apex>` and micro-agora answers `/v1/…` behind the same hostname, which is the arrangement
`pool.<apex>` and `explorer.<apex>` already have — the gateway's bundle router matches the Host at
priority 500 and the API router matches Host plus `PathPrefix('/v1')` at 600.

The two layers answer two different questions. `resolveApiBase` answers "is this a development
stack", and stays a pure function of the hostname so `test/hosts.test.ts` can pin it without a
browser. `viewedApiOrigin()` answers "is the reader looking at the other square", and is the empty
string until they touch the switcher. It is a function and not a module constant, and that is
load-bearing: a string captured at import time goes on naming the network the tab opened on after
the reader has switched away from it.

Agora is a surface where switching network in place matters more than usual. A person here may be
three replies into a thread; teleporting them to Forge Network's testnet page would not lose a
scroll position, it would drop a conversation mid-sentence. `viewsAnyNetwork: true` in the registry
is that decision, and `<Outlet key={viewed}>` in the shell remounts every page on the change so no
component can carry a mainnet post into a testnet render.

### The session is the estate's, and it is never issued here

There is no login form in this bundle and there never will be. `lib/api.ts` reads
`cf.accessToken` / `cf.refreshToken` — the same keys every other estate product uses — and
`bootstrapSession()` completes the hand-off the Account portal starts. When a refresh fails,
`expireSession()` fires `cf:auth-expired` **once**, clears the tokens, and the shell repaints signed
out; the idempotence lives in that function rather than in a rule about who may call it, because two
callers can legitimately reach the same expiry and neither can see the other.

Every request in the file sets `credentials: 'omit'`, including the refresh POST. The default is
`same-origin`, which happens to send nothing today only because the API is cross-origin from every
surface — a fact about the current DNS rather than a decision, and one that stops being true under a
local `pnpm dev`.

The hand-off code is read from the URL and **replaced out of it before anything else**, so it never
reaches history, a referrer or an error report; `test/session.test.ts` asserts the `replaceState`
happens before the fetch and that the code appears in the body and not in the URL.

## Posts are data, not HTML

`tokenize()` in `src/lib/format.ts` turns a post body into an array of tokens — text, link, mention,
tag — and React escapes every string it puts in a text node. A post containing `<script>` is five
characters on the screen.

That argument holds only while there is no path from a post body to `innerHTML`, so
`test/no-dangerous-html.test.ts` greps `src/` for `dangerouslySetInnerHTML`, `innerHTML`,
`outerHTML`, `insertAdjacentHTML` and `document.write`. It is a text test because that is the only
kind that can prove an **absence**: a render test proves the components that exist today are safe and
says nothing about the one somebody adds next month to render bold text — precisely the change that
would introduce this, and precisely the change whose author would be sure it was fine.

Links are allowlisted by a **parse**, not a prefix test: `new URL()` accepts `javascript:`, `data:`
and `blob:` perfectly happily, so only `http:` and `https:` survive. The same rule is applied to
`document.referrer` in `lib/analytics.ts`.

## The published rules and the enforceable rules are the same list

`/guidelines` is a page an operator links to when they suspend somebody, and `test/guidelines.test.ts`
holds it to micro-agora's own vocabulary in both directions:

- **A reason published here but absent from `ReportReason`** is a rule nobody can report a breach of.
  The reader finds the sentence, opens the report form, and there is no option for it.
- **An action in `ModerationActionKind` that is not published** makes the page's own promise false —
  it says these are all of them, there is no shadow-ban — silently, from another repository.

## Configuration

**There is none.** No `VITE_` variable, no `import.meta.env`, no `process.env` in `src/`, no
environment in the image and no per-deployment file. Hosts come from `window.location` at runtime and
the network from the switcher. `test/no-build-time-config.test.ts` enforces it.

The version of that rule particular to this surface: everywhere else a wrongly-baked API origin
produces a broken page. Here it produces a **working** one. The timeline renders, the composer is
live, and a reader on the testnet hostname with the amber band on screen publishes a post to mainnet
in front of everybody. There is no revert for that — it is not a transaction, it is a sentence
somebody said.

The one build argument is `RELEASE`, stamped into `<meta name="cf-release">` so an error report can
be pinned to the deploy that produced it.

### The registry row

`agora` is registered in `ui/packages/ui/src/surfaces.ts` as `kind: 'service'`, subdomain `agora`,
accent `#bf69a9`, glyph `⁂`, `markId: null`, `servesUi: true`, `viewsAnyNetwork: true`,
`inSwitcher: false`.

- **The accent** is orchid, and the only one in that file chosen before the surface it belongs to
  existed. It was scored *together* with the Journal's bronze, because a one-at-a-time search cannot
  see the failure that matters: the first two candidates were each clear of the existing set and
  ΔE 0.8 from **each other** under deuteranopia. Reproduce with
  `node scripts/validate_palette.mjs "#ae7b3d,#bf69a9"`.
- **The glyph** is an asterism — three marks set as a group, used to divide a text into parts without
  ranking them. The Journal wears a fleuron, which closes a passage; this is the ornament for what
  comes after: several voices, none of them the last word.
- **`inSwitcher: false`** is the weakest claim in the row and is stated as one. The product switcher
  is for moving between things somebody came to *do*, and a conversation is not one of them — people
  arrive at Agora because a post was linked to them. The row is cheap to change.
- **`servesUi: true`** is what puts this origin in the `cf-cors` allowlist, which is derived from the
  registry by `surface-routes.py` rather than hand-maintained.

`devPort: 4150` in that row is **micro-agora's** port, not this one's — a `devPort` names the thing
you call. This repository's vite server is **5197**.

### Brand

The favicons and the og card in `public/` are copies of CloudsForge's own, and a copy that is never
compared is a copy that drifts — so `test/brand-chrome.test.ts` compares them byte for byte against a
`micro-brand` checkout and asserts that `brand/assets/agora/` does **not** exist. The day micro-brand
generates a set for this surface, the borrow stops being the right answer and that test says so.

## Running it

```sh
pnpm install            # needs ../ui, the design system, checked out as a sibling
pnpm dev                # http://localhost:5197
pnpm typecheck
pnpm test
pnpm build
```

`@cloudsforge/ui` is consumed as `link:../ui/packages/ui` because it is not published yet. `link:`
rather than `file:`: `link:` symlinks the working tree, so an edit in the design system is visible
here without a republish, while pnpm *packs* a `file:` directory and honours its `files` field —
which lists only `dist`, leaving an exports map pointing at sources that were never packed.

The test script needs `--import @cloudsforge/ui/test-loader`. Node resolves a bare specifier from the
importing file's **realpath**, so without it the design system's components find micro-ui's own copy
of React, share no dispatcher with ours, and every hook they call throws "Cannot read properties of
null (reading 'useState')". The loader is vite's `resolve.dedupe` supplied to the Node test runner,
which has none of its own. Delete the flag and the suite goes red, not quiet.

The image needs the same sibling as a named build context:

```sh
docker build -t agora-web --build-context uipkg=../ui .
```

### What the tests actually hold

164 tests over fourteen files, all of them in-process — there is no browser here.

| File | What it would catch |
| --- | --- |
| `routes.test.ts` | `ROUTES` ↔ `app.tsx` ↔ `nginx.conf` drifting apart, in both directions |
| `analytics.test.ts` | A handle, a post id, a tag or a query reaching Google Analytics |
| `obs.test.ts` | The same, reaching the error ingest; the queue bound, the send cap, the beacon on unload |
| `session.test.ts` | A second refresh in flight; a hand-off code left in the URL; a `credentials` default |
| `format.test.ts` | `tokenize()` — the security boundary — and the five formatters around it |
| `no-dangerous-html.test.ts` | Any path at all from a post body to `innerHTML` |
| `guidelines.test.ts` | A published rule nobody can report, or an unpublished moderation action |
| `seo.test.ts` | The two heads disagreeing; a second writer of `document.title` outside the hook |
| `brand-chrome.test.ts` | A favicon drifting from micro-brand's; a duplicated og property |
| `tokens.test.ts` | A `cf-` custom property this app names that the design system does not define |
| `motion.test.ts` | An `--ag-` class that animates with no `prefers-reduced-motion` answer |
| `no-build-time-config.test.ts` | A `VITE_` variable or a literal hostname reaching `src/` |

`test/browser-stubs.ts` is the minimal browser they run against: a window with storage accessors, a
document with a **real cookie jar** (`@cloudsforge/ui/consent`'s `readCookie` calls `.split(';')`
outside its try, so a document without `cookie` throws), a fetch recorder that keeps `credentials`
and `keepalive`, and a navigator installed with `Object.defineProperty` because Node's global
`navigator` is a getter-only accessor and assignment throws.

`brand-chrome.test.ts` **skips** when micro-brand is absent, so `pnpm test` passes for somebody who
cloned only this repository. On the runner a skip is fatal — CI parses the reporter's summary line
for it — because a checkout that silently produced nothing looks exactly like a green cross-check.

## Known gaps

- **No media uploads.** `Media` is in the wire types and nothing in this bundle posts one; images in
  a square need a store, a scanner and a takedown path, and none of the three is built.
- **No infinite scroll.** Timelines page with a cursor and a button. A scroll listener that fetches
  is a scroll listener that fetches on a screen reader's cursor too.
- **No draft persistence.** A composer refreshed loses its text.
- **`/p/:id` and `/v/:handle` are absent from the sitemap**, deliberately: the set is unbounded and
  a person's handle in the one document a crawler treats as authoritative is this site publishing a
  list of its readers.

## Provenance

Cut from the estate's web template, like every other frontend here: React 19, react-router 7, vite 6,
TypeScript strict, `@cloudsforge/ui` for tokens and chrome, nginx-unprivileged for the image, and the
same `publish-image.yml` producer every deployable uses. What is not from the template is
`lib/analytics.ts`, `lib/routes.ts`'s `routePattern`, and the half of `lib/obs.ts` below the
envelope: this is the only surface in the estate whose own addresses are personal data.
