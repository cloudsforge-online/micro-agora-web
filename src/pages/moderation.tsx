/**
 * The report queue.
 *
 * ── HIDING THE LINK IS A COURTESY; THE 403 IS THE CONTROL ─────────────────────────────────────
 *
 * `useSession().isModerator` reads a role out of the token and decides whether the shell renders a
 * link to this page. That is a rendering hint and nothing more. micro-agora's `requireOperator` is
 * an `isAdmin` check with no service lane, so a reader who types this address gets a page of 403s
 * rather than somebody else's reports. Neither half is load-bearing on its own and only one of them
 * is a boundary — which is why this file does not gate itself on the role at all.
 *
 * ── ONE PRESS IS THE WHOLE DECISION ───────────────────────────────────────────────────────────
 *
 * `POST /v1/moderation/actions` takes the action and the `reportId` together, so acting and
 * resolving are one request. A queue where the moderator acts and then separately closes the report
 * is a queue that fills with actioned-but-open rows, and the second step is the one nobody does.
 * Dismissing is `report_dismissed`, which is an action like any other and is written to the history
 * with the operator's name — deciding that nothing should happen is a decision, and it is recorded.
 *
 * ── AND THE REASON IS REQUIRED HERE, THOUGH THE SERVICE DOES NOT REQUIRE IT ───────────────────
 *
 * `reason` is optional on the wire. It is mandatory in this form because the string ends up in the
 * subject's history beside a human's identity, and in the notification the author receives. An
 * action with an empty reason is one somebody has to reconstruct from memory six weeks later.
 */
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  moderate,
  moderationHistory,
  moderationQueue,
  type ModerationActionKind,
  type ModerationEntry,
  type Report,
  type ReportState,
  type SubjectKind,
} from '../lib/agora.ts'
import { RequireSession } from '../lib/auth.tsx'
import { ago, at, exact } from '../lib/format.ts'
import { useResource } from '../lib/resource.ts'
import { circlePath, postPath, voicePath } from '../lib/routes.ts'
import { useTitle } from '../components/shell.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { OUTCOMES, REASONS } from './guidelines.tsx'

/**
 * What can be done to each kind of subject, in the order a moderator would consider it.
 *
 * Mildest first, and dismissal last: a list that leads with "suspend" is a list that gets used to
 * suspend. A whisper has no action of its own — the thing to act on is the voice that sent it —
 * so it offers dismissal only, and says so.
 */
const CHOICES: Record<SubjectKind, readonly ModerationActionKind[]> = {
  post: ['sensitive_applied', 'post_removed', 'post_restored', 'report_dismissed'],
  voice: ['voice_suspended', 'voice_restored', 'report_dismissed'],
  circle: ['circle_archived', 'report_dismissed'],
  whisper: ['report_dismissed'],
}

/** The verb on the button. `OUTCOMES` says what it does; this is what to press. */
const VERB: Record<ModerationActionKind, string> = {
  sensitive_applied: 'Put it behind a warning',
  post_removed: 'Take the post down',
  post_restored: 'Put the post back',
  voice_suspended: 'Suspend the voice',
  voice_restored: 'Lift the suspension',
  circle_archived: 'Archive the circle',
  report_dismissed: 'Nothing to do here',
}

const STATES: readonly (readonly [ReportState | null, string])[] = [
  ['open', 'Open'],
  ['actioned', 'Actioned'],
  ['dismissed', 'Dismissed'],
  [null, 'Everything'],
]

export default function ModerationPage() {
  useTitle('Moderation')
  return (
    <RequireSession what="work the moderation queue">
      <Queue />
    </RequireSession>
  )
}

function Queue() {
  const [state, setState] = useState<ReportState | null>('open')

  const reports = useResource(
    useCallback((signal) => moderationQueue(state, { signal }), [state]),
    (data) => data.reports.length,
    'The queue did not load.',
  )

  // Once for the whole queue — see the note on `ago` in lib/format.ts.
  const now = Date.now()

  return (
    <div className="ag-moderation">
      <header className="ag-page-head">
        <h1 className="ag-page-title">Moderation</h1>
        <p className="ag-page-sub">
          Every action here is written to the subject's history with your name on it, and the author
          is told. <Link to="/guidelines">The published rules</Link> are what this queue enforces.
        </p>
        <div className="ag-tabs" role="tablist">
          {STATES.map(([value, label]) => (
            <button
              aria-selected={state === value}
              className={`ag-tab${state === value ? ' is-on' : ''}`}
              key={label}
              onClick={() => setState(value)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {reports.state === 'loading' && <Loading label="Loading the queue" />}
      {reports.state === 'forbidden' && (
        <Forbidden
          message="The moderation queue is open to estate operators only. If you should be one, an administrator can give you the role."
          requestId={reports.error?.requestId}
          title="This queue is not yours"
        />
      )}
      {reports.state === 'failed' && (
        <Failed
          message={reports.error?.message}
          onRetry={reports.reload}
          requestId={reports.error?.requestId}
        />
      )}
      {reports.state === 'empty' && (
        <Empty
          glyph="⚖"
          hint={
            state === 'open'
              ? 'Nothing is waiting. This is the state the square should normally be in.'
              : 'Nothing here.'
          }
          title={state === 'open' ? 'The queue is empty' : 'Nothing to show'}
        />
      )}
      {reports.state === 'ok' && reports.data && (
        <ol className="ag-reports">
          {reports.data.reports.map((report) => (
            <li key={report.id}>
              <ReportCard now={now} onActed={reports.reload} report={report} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function ReportCard({
  report,
  now,
  onActed,
}: {
  report: Report
  now: number
  onActed: () => void
}) {
  const [chosen, setChosen] = useState<ModerationActionKind | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const open = report.state === 'open'
  const to = subjectPath(report.subjectKind, report.subjectId)

  const act = () => {
    if (chosen === null || reason.trim() === '') return
    setBusy(true)
    setFailure(null)
    void moderate({
      action: chosen,
      subjectKind: report.subjectKind,
      subjectId: report.subjectId,
      reportId: report.id,
      reason: reason.trim(),
    })
      .then(onActed)
      .catch((err: unknown) =>
        setFailure(err instanceof Error ? err.message : 'That action did not go through.'),
      )
      .finally(() => setBusy(false))
  }

  return (
    <article className={`ag-report is-${report.state}`}>
      <header className="ag-report__head">
        <span className={`ag-report__reason ag-report__reason--${report.reason}`}>
          {REASONS[report.reason].title}
        </span>
        <span className="ag-report__subject">
          {to ? (
            // Opens in a new tab: a moderator reading a report has the queue open, and navigating
            // away from a form they have half-filled loses the reason they were typing.
            <a href={to} rel="noreferrer" target="_blank">
              {report.subjectKind} ↗
            </a>
          ) : (
            <span>{report.subjectKind}</span>
          )}
        </span>
        <time className="ag-report__when" dateTime={report.createdAt} title={exact(report.createdAt)}>
          {ago(report.createdAt, now)}
        </time>
      </header>

      <p className="ag-report__who">
        {report.automatic ? (
          <span className="ag-badge ag-badge--quiet">Raised by the estate</span>
        ) : report.reporterHandle ? (
          <>
            Reported by{' '}
            <Link to={voicePath(report.reporterHandle)}>{at(report.reporterHandle)}</Link>
          </>
        ) : (
          'Reported by somebody whose voice has since gone'
        )}
      </p>

      {/* The reporter's own words, as text. Never markup — this is a stranger's string. */}
      {report.detail && <p className="ag-report__detail">{report.detail}</p>}

      {report.state !== 'open' && (
        <p className="ag-report__resolved">
          <strong>{report.state === 'actioned' ? 'Actioned' : 'Dismissed'}</strong>
          {report.resolvedBy && <> by {report.resolvedBy}</>}
          {report.resolvedAt && (
            <>
              , <time dateTime={report.resolvedAt}>{ago(report.resolvedAt, now)}</time>
            </>
          )}
          {report.resolution && <span className="ag-report__resolution">{report.resolution}</span>}
        </p>
      )}

      {open && (
        <div className="ag-report__act">
          <fieldset className="ag-report__choices">
            <legend className="ag-vh">What to do</legend>
            {CHOICES[report.subjectKind].map((action) => (
              <label className="ag-radio" key={action}>
                <input
                  checked={chosen === action}
                  name={`act-${report.id}`}
                  onChange={() => setChosen(action)}
                  type="radio"
                  value={action}
                />
                <span className="ag-radio__label">{VERB[action]}</span>
                <span className="ag-radio__hint">{OUTCOMES[action]}</span>
              </label>
            ))}
          </fieldset>

          <label className="ag-field">
            <span className="ag-field__label">Why — in your own words</span>
            <textarea
              className="ag-textarea ag-textarea--short"
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What you decided and why. This is kept, and the author reads it."
              rows={2}
              value={reason}
            />
          </label>

          <div className="ag-report__actions">
            <button
              className="ag-btn ag-btn--primary"
              disabled={busy || chosen === null || reason.trim() === ''}
              onClick={act}
              type="button"
            >
              {busy ? 'Recording…' : 'Do it and close the report'}
            </button>
            {report.subjectKind === 'whisper' && (
              <p className="ag-report__note">
                A whisper cannot be acted on directly — it is a private message between two people.
                Act on the voice that sent it if the report warrants it.
              </p>
            )}
          </div>

          {failure && (
            <p className="ag-report__failure" role="alert">
              {failure}
            </p>
          )}
        </div>
      )}

      <button
        className="ag-report__history-toggle"
        onClick={() => setShowHistory((on) => !on)}
        type="button"
      >
        {showHistory ? 'Hide what has happened before' : 'What has happened to this before?'}
      </button>
      {showHistory && <History id={report.subjectId} kind={report.subjectKind} />}
    </article>
  )
}

/**
 * The subject's past.
 *
 * Fetched only when asked for, because it is one request per report and a queue of forty would fire
 * forty of them on load to show something a moderator looks at on maybe two.
 */
function History({ kind, id }: { kind: SubjectKind; id: string }) {
  const past = useResource(
    useCallback((signal) => moderationHistory(kind, id, { signal }), [kind, id]),
    (data) => data.history.length,
    'The history did not load.',
  )

  const now = Date.now()

  if (past.state === 'loading') return <Loading label="Loading the history" />
  if (past.state === 'empty') {
    return (
      <p className="ag-report__history-none">
        Nothing has ever been done to this {kind}. It is a first report.
      </p>
    )
  }
  if (past.state !== 'ok' || !past.data) return null

  return (
    <ol className="ag-history">
      {past.data.history.map((entry, i) => (
        <li key={`${entry.createdAt}-${i}`}>
          <HistoryRow entry={entry} now={now} />
        </li>
      ))}
    </ol>
  )
}

function HistoryRow({ entry, now }: { entry: ModerationEntry; now: number }) {
  return (
    <div className="ag-history__row">
      <span className="ag-history__action">{VERB[entry.action]}</span>
      <span className="ag-history__by">{entry.operator}</span>
      <time className="ag-history__when" dateTime={entry.createdAt} title={exact(entry.createdAt)}>
        {ago(entry.createdAt, now)}
      </time>
      {entry.reason && <p className="ag-history__reason">{entry.reason}</p>}
    </div>
  )
}

/**
 * Where the subject lives, when it has an address at all.
 *
 * A voice is reported by ID here rather than by handle — the queue carries `subjectId` — and
 * `/v/:handle` takes a handle. `voicePath` on a uuid produces an address that 404s, which is worse
 * than no link, so a voice report gets no link. A whisper has no public address by construction.
 */
function subjectPath(kind: SubjectKind, id: string): string | null {
  switch (kind) {
    case 'post':
      return postPath(id)
    case 'circle':
      return circlePath(id)
    default:
      return null
  }
}
