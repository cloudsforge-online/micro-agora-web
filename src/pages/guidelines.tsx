/**
 * What is allowed here, what is not, and what happens when somebody reports something.
 *
 * ── PUBLIC AND INDEXED, WHICH IS THE ENTIRE POINT ─────────────────────────────────────────────
 *
 * A square with no published rules is a square where the rules are whatever the operator felt like
 * that morning, and every enforcement then reads as arbitrary — including the fair ones. This page
 * is readable signed out and is one of the two addresses on this surface `robots.txt` positively
 * allows, so that "you were suspended for X" can be answered with a link rather than a paraphrase.
 *
 * ── IT MATCHES THE SERVICE, LINE FOR LINE ─────────────────────────────────────────────────────
 *
 * Every reason listed below is a member of `ReportReason` in `lib/agora.ts`, and every outcome is a
 * member of `ModerationActionKind`. That is not a coincidence to be maintained by hand:
 * `test/guidelines.test.ts` reads this module and both unions and fails when they diverge. A
 * published rule the service cannot express is a promise nobody can keep, and an action the service
 * can take that is not published here is the thing this page exists to prevent.
 *
 * The copy is deliberately short. A page of rules nobody finishes reading is the same as no page.
 */
import { Link } from 'react-router-dom'
import type { ModerationActionKind, ReportReason } from '../lib/agora.ts'
import { useTitle } from '../components/shell.tsx'

/** Every reason a report can carry, in the words the report form uses. Keyed by the wire value. */
export const REASONS: Record<ReportReason, { readonly title: string; readonly body: string }> = {
  spam: {
    title: 'Spam',
    body: 'Repetition, unsolicited promotion, or the same message pushed at people who did not ask for it. Talking about your own project is not spam; posting it forty times is.',
  },
  abuse: {
    title: 'Abuse and harassment',
    body: 'Attacking a person rather than an argument, following somebody around the square to keep at them, or threatening anyone. Disagreement is welcome here and this is not that.',
  },
  impersonation: {
    title: 'Impersonation',
    body: 'Presenting yourself as somebody else — a person, a project, or CloudsForge itself. Parody is fine when it is obviously parody.',
  },
  self_harm: {
    title: 'Self-harm',
    body: 'Encouraging anybody to hurt themselves. If you are worried about somebody, report it and say so in the detail box; it is read by a person.',
  },
  illegal: {
    title: 'Illegal material',
    body: 'Anything unlawful, including stolen credentials, stolen keys, and material involving children. This is reported onward and the account is closed.',
  },
  misinformation: {
    title: 'Financial misinformation',
    body: 'Fabricated returns, invented partnerships, and pump schemes. This is a square about money; a claim about a price is not a matter of opinion.',
  },
  other: {
    title: 'Something else',
    body: 'When none of the above fits. Say what happened in your own words — this one is read by a person before anything else is.',
  },
}

/** Every outcome, in the words a notification uses. Keyed by the wire value. */
export const OUTCOMES: Record<ModerationActionKind, string> = {
  post_removed: 'A post is taken down. The author is told, and the thread around it stays readable.',
  post_restored: 'A post that was taken down is put back. This happens, and it is not hidden when it does.',
  sensitive_applied:
    'A post is put behind a warning rather than removed. The commonest outcome, and the mildest.',
  voice_suspended:
    'A voice cannot post, reply or whisper. It can still read, and everything it wrote stays up.',
  voice_restored: 'A suspension is lifted.',
  circle_archived: 'A circle is closed to new posts. Everything in it stays readable to its members.',
  report_dismissed: 'Nothing happened, because nothing needed to. The reporter is not told what was decided.',
}

export default function GuidelinesPage() {
  useTitle('Guidelines')

  return (
    <article className="ag-prose ag-guidelines">
      <header className="ag-page-head">
        <h1 className="ag-page-title">What goes here</h1>
        <p className="ag-page-sub">
          The Agora is the public square of the CloudsForge ecosystem. Most of what happens on it is
          people arguing about coins, and that is what it is for.
        </p>
      </header>

      <section>
        <h2>The short version</h2>
        <p>
          Argue with the argument. Do not pretend to be somebody else. Do not make things up about
          money. Everything below is that sentence, at length.
        </p>
      </section>

      <section>
        <h2>What gets reported</h2>
        <p>
          Anybody signed in can report a post, a voice, a circle or a whisper. These are the reasons
          the report form offers, and they are the only ones it has — a free-text queue is a queue
          nobody can work through.
        </p>
        <dl className="ag-guidelines__reasons">
          {(Object.keys(REASONS) as ReportReason[]).map((reason) => (
            <div className="ag-guidelines__reason" key={reason}>
              <dt>{REASONS[reason].title}</dt>
              <dd>{REASONS[reason].body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>What happens after you report</h2>
        <p>
          The report is accepted and you are told nothing else. That is deliberate in both
          directions: you are not given an id to poll, because it would let you read a queue that is
          not yours, and you are not told the outcome, because the outcome is about the other person.
        </p>
        <p>
          Reporting the same thing twice is not an error and does not annoy anybody. It was seen the
          first time.
        </p>
      </section>

      <section>
        <h2>What an operator can actually do</h2>
        <p>These are all of them. There is no shadow-ban and no quiet reach limit on this square.</p>
        <ul className="ag-guidelines__outcomes">
          {(Object.keys(OUTCOMES) as ModerationActionKind[]).map((kind) => (
            <li key={kind}>{OUTCOMES[kind]}</li>
          ))}
        </ul>
        <p>
          Every action is written to the subject's history with the operator's identity beside it.
          A moderator here is a named person, not a system.
        </p>
      </section>

      <section>
        <h2>What you can do yourself, without reporting anybody</h2>
        <p>
          Most of what people want is not a moderator. Three controls do the work, and none of them
          tells the other person anything:
        </p>
        <ul>
          <li>
            <strong>Hush</strong> — you stop seeing somebody, or a tag. You still follow them. They
            are never told, and this is the one people actually use.
          </li>
          <li>
            <strong>Bar</strong> — neither of you sees the other, anywhere. They can tell, in the
            sense that your profile stops working for them.
          </li>
          <li>
            <strong>Approve followers by hand</strong> — in{' '}
            <Link to="/settings">your settings</Link>. Your posts go to your followers, and somebody
            has to ask before they become one.
          </li>
        </ul>
      </section>

      <section>
        <h2>Two things about the square itself</h2>
        <p>
          <strong>There are two squares.</strong> Mainnet and testnet hold different posts, different
          handles and different circles. Nothing you write on one appears on the other, and a
          suspension on one does not carry across.
        </p>
        <p>
          <strong>Nothing here is financial advice, including from us.</strong> The Agora is run by
          the same people who run the exchange, the wallet and the chain. Somebody being confident on
          this square is not the ecosystem's opinion.
        </p>
      </section>

      <footer className="ag-guidelines__foot">
        <p>
          Something not covered? Say so on the square, or write to an operator. This page changes
          when the rules do, and the change is the release note.
        </p>
      </footer>
    </article>
  )
}
