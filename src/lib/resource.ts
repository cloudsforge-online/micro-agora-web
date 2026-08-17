/**
 * One fetch, five states — and one paged fetch, which is what a timeline actually is.
 *
 * Every screen in the estate needs the same answer — loading, empty, failed, forbidden — and every
 * screen that computes it by hand eventually gets one of the cases wrong: an empty array rendered
 * for a timeout, or a 403 rendered as a retryable error. The decision is made once here, as a pure
 * function, so the wrong version cannot be written again.
 *
 * This surface adds a fifth, `missing`, and it is not a formality. micro-agora answers 404 for a
 * post that was deleted, for a post inside a circle the reader is not in, and for a malformed id —
 * deliberately the same answer for all three, so that probing ids cannot distinguish "does not
 * exist" from "exists and you may not see it". A screen that renders 404 as a generic failure with
 * a Retry button invites a reader to press it repeatedly against an answer that will never change.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { noticeFor, type ErrorNotice } from './api.ts'

export type ResourceState = 'loading' | 'ok' | 'empty' | 'failed' | 'forbidden' | 'missing'

/**
 * Which state a resource is in.
 *
 * FAILURE OUTRANKS EMPTINESS, in both directions. A request that threw has told us nothing about
 * whether data exists, so reporting "nothing here" for a timeout is how an outage reads as a quiet
 * week. And 403 and 404 each outrank a generic failure, because all three have different remedies:
 * sign in as somebody else, go somewhere else, try again.
 */
export function resourceState(opts: {
  loading: boolean
  error: ErrorNotice | null
  count: number | null
}): ResourceState {
  if (opts.error) {
    if (opts.error.forbidden) return 'forbidden'
    if (opts.error.missing) return 'missing'
    return 'failed'
  }
  if (opts.loading) return 'loading'
  if (opts.count === null) return 'loading'
  return opts.count > 0 ? 'ok' : 'empty'
}

export interface Resource<T> {
  state: ResourceState
  data: T | null
  error: ErrorNotice | null
  reload: () => void
  /** Replace the held value without a round trip. What an optimistic Spark writes through. */
  set: (next: T) => void
}

/**
 * Run `load` on mount and on demand, and reduce the outcome to one of the states above.
 *
 * `count` exists because "empty" is a property of the DATA, not of the response: an object with an
 * empty list inside it is a 200 that should render the empty state.
 *
 * NOTHING HERE WATCHES THE VIEWED NETWORK, and that is on purpose rather than an omission. The
 * shell renders `<Outlet key={viewedNetwork()}>`, so switching network unmounts every page and
 * mounts a fresh one — which discards the held data along with the component instead of leaving the
 * other square's posts on screen while a re-fetch is in flight. A hook that re-ran in place would
 * have to decide what to show during that window, and there is no right answer to that question:
 * the old posts are from a different square and the empty state is a lie.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  count: (data: T) => number,
  fallbackMessage: string,
): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    load(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setData(value)
        setLoading(false)
      })
      .catch((err: unknown) => {
        // An abort is this component going away, not a failure. Rendering the failed state for it
        // is how a fast double-navigation leaves an error on a screen nobody is looking at.
        if (controller.signal.aborted) return
        setError(noticeFor(err, fallbackMessage))
        setLoading(false)
      })
    return () => controller.abort()
    // `load` is recreated every render by most callers, so it is deliberately not a dependency;
    // `nonce` is what re-runs this, and it changes only when reload() is called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return {
    state: resourceState({ loading, error, count: data === null ? null : count(data) }),
    data,
    error,
    reload,
    set: setData,
  }
}

/* ---- paging --------------------------------------------------------- */

export interface Paged<T> {
  state: ResourceState
  items: readonly T[]
  error: ErrorNotice | null
  /** Null when there is no more. The button is rendered from this, not from a page count. */
  cursor: string | null
  /** True while a NEXT page is in flight. The first page uses `state === 'loading'` instead. */
  loadingMore: boolean
  more: () => void
  reload: () => void
  /** Rewrite one item in place — what an optimistic Spark on a timeline row writes through. */
  replace: (match: (item: T) => boolean, next: T) => void
  /** Drop one item — a delete, or a post that left the timeline because its author was hushed. */
  remove: (match: (item: T) => boolean) => void
  /**
   * Put one item at the top, without a refetch.
   *
   * What the composer does with the post it just published. Refetching the first page instead would
   * be the obvious alternative and it is worse in two ways: it costs a round trip to learn something
   * this client already has in its hand, and it re-anchors the keyset, so a reader who was three
   * pages deep loses their place to see the thing they just wrote.
   *
   * De-duplicated by identity below rather than here, because "the same item" is the caller's
   * definition — see the `match` this takes alongside.
   */
  prepend: (item: T, same?: (a: T, b: T) => boolean) => void
}

/**
 * A cursor-paged list, which every timeline on this surface is.
 *
 * ── WHY A BUTTON AND NOT AN INTERSECTION OBSERVER ──────────────────────────────────────────────
 *
 * `more()` is called by a control the reader presses. Infinite scroll is the obvious alternative
 * and it is not used here, for three reasons that all point the same way: it makes the footer
 * unreachable (every link in it, including the privacy notice and the guidelines, becomes a link
 * nobody can click), it takes away the reader's ability to stop, and it fetches on a signal — a
 * pixel entering the viewport — that fires while somebody is scrolling PAST something rather than
 * towards it. A "Load more" button is one press per page and it is the reader's press.
 *
 * ── AND WHY THE CURSOR IS OPAQUE ───────────────────────────────────────────────────────────────
 *
 * micro-agora returns `nextCursor` and this bundle never parses it. It is a keyset position, not an
 * offset, so a post published while the reader is on page one does not shift page two by one and
 * duplicate a row — the classic offset-paging defect, and one that on a timeline is guaranteed
 * rather than unlikely, because new posts arriving is the normal state of the resource.
 */
export function usePaged<T>(
  load: (cursor: string | null, signal: AbortSignal) => Promise<{ items: readonly T[]; nextCursor: string | null }>,
  fallbackMessage: string,
): Paged<T> {
  const [items, setItems] = useState<readonly T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nonce, setNonce] = useState(0)
  /** Guards against a second `more()` while the first is in flight — a double-click is one page. */
  const busy = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setItems([])
    setCursor(null)
    load(null, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setItems(page.items)
        setCursor(page.nextCursor)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(noticeFor(err, fallbackMessage))
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  const more = useCallback(() => {
    if (busy.current || cursor === null) return
    busy.current = true
    setLoadingMore(true)
    const controller = new AbortController()
    load(cursor, controller.signal)
      .then((page) => {
        setItems((current) => [...current, ...page.items])
        setCursor(page.nextCursor)
      })
      .catch((err: unknown) => {
        // A failed NEXT page does not discard the pages already read. The reader keeps what they
        // were reading and is told the button did not work, which is the truthful pair of facts.
        setError(noticeFor(err, fallbackMessage))
      })
      .finally(() => {
        busy.current = false
        setLoadingMore(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const replace = useCallback((match: (item: T) => boolean, next: T) => {
    setItems((current) => current.map((item) => (match(item) ? next : item)))
  }, [])

  const remove = useCallback((match: (item: T) => boolean) => {
    setItems((current) => current.filter((item) => !match(item)))
  }, [])

  const prepend = useCallback((item: T, same?: (a: T, b: T) => boolean) => {
    setItems((current) => {
      // The de-duplication is what makes this safe to call from an idempotency REPLAY: publishing
      // the same draft twice answers 200 with the post that already exists, and without this the
      // reader would watch their own post appear twice for having pressed the button twice.
      const rest = same ? current.filter((existing) => !same(existing, item)) : current
      return [item, ...rest]
    })
  }, [])

  return {
    // `error` on a later page must NOT flip the whole list to `failed` — there are posts on screen
    // and they are real. The state is computed from the first page only, and the later failure is
    // shown beside the button that caused it.
    state: resourceState({
      loading,
      error: items.length > 0 ? null : error,
      count: loading ? null : items.length,
    }),
    items,
    error,
    cursor,
    loadingMore,
    more,
    reload,
    replace,
    remove,
    prepend,
  }
}
