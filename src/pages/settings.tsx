/**
 * The reader's own voice.
 *
 * ── THE ORDER OF THIS PAGE IS AN ARGUMENT ─────────────────────────────────────────────────────
 *
 * Reach comes first, then the profile, then mail. Every network puts the name and the picture at the
 * top and buries "who can see my posts" three screens down under Privacy, and the result is that
 * almost nobody ever finds the one setting that changes what happens to them. Here the two controls
 * that decide who can reach the reader — whether their posts are public, and who may whisper them —
 * are the first thing on the page, said in full sentences.
 *
 * ── EVERY FIELD SAVES ON ITS OWN ──────────────────────────────────────────────────────────────
 *
 * `PATCH /v1/me` writes only the keys present, and this page sends one key per save. That is not
 * tidiness: a form that echoed the whole voice back would overwrite a change made from another tab
 * in the seconds since the page loaded, and this surface is one somebody genuinely does have open
 * twice. It also means a failure is local — a rejected handle leaves the bio saved.
 *
 * ── THE HANDLE IS THE ONE FIELD THAT CAN BREAK A LINK ─────────────────────────────────────────
 *
 * `/v/:handle` is the address of a person, so renaming a voice invalidates every link anybody has
 * ever shared to it. The service allows it; this page says so before it happens rather than after.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  setEmailPrefs,
  updateMe,
  type EmailPrefs,
  type Me,
  type VoicePatch,
  type WhispersFrom,
} from '../lib/agora.ts'
import { RequireSession, useSession, useVoice } from '../lib/auth.tsx'
import { at, exact } from '../lib/format.ts'
import { voicePath } from '../lib/routes.ts'
import { useTitle } from '../components/shell.tsx'
import { Failed, Loading } from '../components/states.tsx'
import { viewedNetwork } from '../lib/viewed.ts'

export default function SettingsPage() {
  useTitle('Settings')
  return (
    <RequireSession what="change your settings">
      <Settings />
    </RequireSession>
  )
}

function Settings() {
  const { status, me, reload, set } = useVoice()
  const { signOut } = useSession()

  if (status === 'unknown') return <Loading label="Loading your settings" />
  if (status === 'failed' || me === null) {
    return <Failed message="Your voice did not load." onRetry={reload} />
  }

  const square = viewedNetwork() === 'testnet' ? 'the testnet square' : 'the square'

  return (
    <div className="ag-settings">
      <header className="ag-page-head">
        <h1 className="ag-page-title">Settings</h1>
        <p className="ag-page-sub">
          Your voice on {square}.{' '}
          <Link to={voicePath(me.voice.handle)}>See how your profile looks</Link>.
        </p>
      </header>

      <Reach me={me} onSaved={set} />
      <Profile me={me} onSaved={set} />
      <Mail me={me} onSaved={set} />

      <section className="ag-settings__group">
        <h2 className="ag-settings__title">This account</h2>
        <dl className="ag-facts">
          <dt>Handle</dt>
          <dd>{at(me.voice.handle)}</dd>
          <dt>Joined</dt>
          <dd>
            <time dateTime={me.voice.createdAt}>{exact(me.voice.createdAt)}</time>
          </dd>
        </dl>
        <p className="ag-settings__note">
          {/*
            Said plainly because it is the single most common confusion on a surface that shares an
            account with fourteen others: signing out here signs the reader out of the ecosystem,
            not out of the Agora. There is no Agora-only session to end.
          */}
          Your Agora voice belongs to your CloudsForge account. Signing out signs you out of the
          whole ecosystem.
        </p>
        <button className="ag-btn" onClick={signOut} type="button">
          Sign out
        </button>
      </section>
    </div>
  )
}

/* ── who can reach you ─────────────────────────────────────────────────────────────────────── */

function Reach({ me, onSaved }: { me: Me; onSaved: (next: Me) => void }) {
  const save = (patch: VoicePatch) =>
    updateMe(patch).then(({ voice }) => onSaved({ ...me, voice }))

  return (
    <section className="ag-settings__group ag-settings__group--first">
      <h2 className="ag-settings__title">Who can reach you</h2>

      <Switch
        hint={
          me.voice.protected
            ? 'Your posts go to your followers, and somebody has to ask before they become one. Posts you have already made stay as they were addressed.'
            : 'Anyone can follow you and your public posts are readable by anyone, signed in or not.'
        }
        label="Approve followers by hand"
        onChange={(on) => save({ protected: on })}
        value={me.voice.protected}
      />

      <Choice<WhispersFrom>
        label="Who may whisper you"
        onChange={(next) => save({ whispersFrom: next })}
        options={[
          ['everyone', 'Anyone', 'Anybody on this square can open a conversation with you.'],
          ['follows', 'People you follow', 'Others can read you, but cannot start a whisper.'],
          ['nobody', 'Nobody', 'Conversations you are already in keep working.'],
        ]}
        value={me.voice.whispersFrom}
      />

      <Switch
        hint={
          me.voice.discoverable
            ? 'You appear in search and in the people directory.'
            : 'You are not listed in search or the directory. Your profile still works, and anybody with your handle can still find you — this hides the list, not the page.'
        }
        label="Let people find you in search"
        onChange={(on) => save({ discoverable: on })}
        value={me.voice.discoverable}
      />
    </section>
  )
}

/* ── your profile ──────────────────────────────────────────────────────────────────────────── */

function Profile({ me, onSaved }: { me: Me; onSaved: (next: Me) => void }) {
  const save = (patch: VoicePatch) =>
    updateMe(patch).then(({ voice }) => onSaved({ ...me, voice }))

  return (
    <section className="ag-settings__group">
      <h2 className="ag-settings__title">Your profile</h2>

      <Text
        hint="What people see above your handle."
        label="Display name"
        max={80}
        onSave={(displayName) => save({ displayName })}
        value={me.voice.displayName}
      />

      <Text
        hint={
          <>
            Your address is <code>/v/{me.voice.handle}</code>.{' '}
            <strong>Changing it breaks every link anybody has shared to you</strong> — the old
            address stops working straight away and somebody else can take it.
          </>
        }
        label="Handle"
        max={32}
        onSave={(handle) => save({ handle: handle.replace(/^@/, '') })}
        prefix="@"
        value={me.voice.handle}
      />

      <Text
        area
        hint="A couple of sentences. Mentions and tags in here are not links."
        label="Bio"
        max={400}
        onSave={(bio) => save({ bio })}
        value={me.voice.bio}
      />

      <Text
        hint="Optional. Anything you like — a city, a timezone, a joke."
        label="Location"
        max={80}
        onSave={(location) => save({ location })}
        value={me.voice.location}
      />

      <Text
        hint="Shown on your profile as a link. It is not verified and it carries a nofollow."
        label="Website"
        max={200}
        onSave={(website) => save({ website })}
        value={me.voice.website}
      />

      {/*
        NO PICTURE UPLOAD. micro-agora has no upload route: `avatarAssetId` and `bannerAssetId` name
        assets that already exist in micro-studio, and there is no browser path to putting one there
        from this bundle. A file input that could not send anywhere is worse than its absence, so
        this says where pictures come from instead of pretending to offer them.
      */}
      <p className="ag-settings__note">
        Your picture and banner come from your CloudsForge account. Change them in your account
        settings and they follow you here.
      </p>
    </section>
  )
}

/* ── mail ──────────────────────────────────────────────────────────────────────────────────── */

const MAIL: readonly (readonly [keyof EmailPrefs, string, string])[] = [
  ['onReply', 'Replies', 'Somebody answers one of your posts.'],
  ['onMention', 'Mentions', 'Somebody writes your handle in a post.'],
  ['onFollow', 'Follows', 'Somebody follows you, or asks to.'],
  ['onWhisper', 'Whispers', 'Somebody sends you a private message.'],
  ['onModeration', 'Moderation', 'Something of yours was acted on. Worth keeping on.'],
]

function Mail({ me, onSaved }: { me: Me; onSaved: (next: Me) => void }) {
  return (
    <section className="ag-settings__group">
      <h2 className="ag-settings__title">Mail</h2>
      <p className="ag-settings__lede">
        Every one of these is off by default for a new voice. Nothing here is marketing — the Agora
        does not send any.
      </p>
      {MAIL.map(([key, label, hint]) => (
        <Switch
          hint={hint}
          key={key}
          label={label}
          // ONE KEY PER REQUEST. `setEmailPrefs` merges what it is given, so a switch that changes
          // one preference cannot undo a change made in another tab. See `EmailPrefs`.
          onChange={(on) =>
            setEmailPrefs({ [key]: on }).then(({ emailPrefs }) => onSaved({ ...me, emailPrefs }))
          }
          value={me.emailPrefs[key]}
        />
      ))}
    </section>
  )
}

/* ── the three controls everything above is made of ────────────────────────────────────────── */

/**
 * A switch that reports what actually happened.
 *
 * Optimistic — it moves under the finger — and it puts itself back if the write fails, which is the
 * half most implementations skip. A privacy switch that shows "off" while the service still has it
 * on is the worst possible lie for this particular page to tell.
 */
function Switch({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: ReactNode
  value: boolean
  onChange: (on: boolean) => Promise<unknown>
}) {
  const [shown, setShown] = useState(value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => setShown(value), [value])

  return (
    <div className="ag-setting">
      <label className="ag-switch">
        <input
          checked={shown}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked
            setShown(next)
            setBusy(true)
            setFailed(false)
            void onChange(next)
              .catch(() => {
                setShown(!next)
                setFailed(true)
              })
              .finally(() => setBusy(false))
          }}
          type="checkbox"
        />
        <span className="ag-switch__track" aria-hidden="true">
          <span className="ag-switch__knob" />
        </span>
        <span className="ag-switch__label">{label}</span>
      </label>
      <p className="ag-setting__hint">{hint}</p>
      {failed && (
        <p className="ag-setting__failure" role="alert">
          That did not save, so nothing changed.
        </p>
      )}
    </div>
  )
}

/** One of several, each with its own consequence written beside it. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly (readonly [T, string, string])[]
  value: T
  onChange: (next: T) => Promise<unknown>
}) {
  const [shown, setShown] = useState<T>(value)
  const [failed, setFailed] = useState(false)
  useEffect(() => setShown(value), [value])

  return (
    <fieldset className="ag-setting">
      <legend className="ag-setting__label">{label}</legend>
      {options.map(([option, title, hint]) => (
        <label className="ag-radio" key={option}>
          <input
            checked={shown === option}
            name={label}
            onChange={() => {
              const was = shown
              setShown(option)
              setFailed(false)
              void onChange(option).catch(() => {
                setShown(was)
                setFailed(true)
              })
            }}
            type="radio"
            value={option}
          />
          <span className="ag-radio__label">{title}</span>
          <span className="ag-radio__hint">{hint}</span>
        </label>
      ))}
      {failed && (
        <p className="ag-setting__failure" role="alert">
          That did not save, so nothing changed.
        </p>
      )}
    </fieldset>
  )
}

/**
 * A text field with its own Save.
 *
 * SAVE ON A PRESS, not on blur. A field that writes when focus leaves it saves half-typed values
 * every time somebody tabs away or switches window, and on the handle field that is a broken
 * address. The button appears only once the value has actually changed, so the page is not a wall
 * of live buttons.
 */
function Text({
  label,
  hint,
  value,
  max,
  area,
  prefix,
  onSave,
}: {
  label: string
  hint: ReactNode
  value: string
  max: number
  area?: boolean
  prefix?: string
  onSave: (next: string) => Promise<unknown>
}) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => setDraft(value), [value])

  const changed = draft !== value
  const id = `ag-set-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`

  return (
    <div className="ag-setting">
      <label className="ag-setting__label" htmlFor={id}>
        {label}
      </label>
      <span className={prefix ? 'ag-field__prefix' : undefined}>
        {prefix}
        {area ? (
          <textarea
            className="ag-textarea ag-textarea--short"
            id={id}
            maxLength={max}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            value={draft}
          />
        ) : (
          <input
            className="ag-input"
            id={id}
            maxLength={max}
            onChange={(e) => setDraft(e.target.value)}
            type="text"
            value={draft}
          />
        )}
      </span>
      <p className="ag-setting__hint">{hint}</p>
      {changed && (
        <div className="ag-setting__actions">
          <button
            className="ag-btn ag-btn--primary ag-btn--quiet"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setFailure(null)
              void onSave(draft.trim())
                .then(() => {
                  setSaved(true)
                  window.setTimeout(() => setSaved(false), 4_000)
                })
                .catch((err: unknown) =>
                  setFailure(err instanceof Error ? err.message : 'That did not save.'),
                )
                .finally(() => setBusy(false))
            }}
            type="button"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="ag-btn ag-btn--quiet" onClick={() => setDraft(value)} type="button">
            Undo
          </button>
        </div>
      )}
      {saved && (
        <p className="ag-setting__saved" role="status">
          Saved
        </p>
      )}
      {failure && (
        <p className="ag-setting__failure" role="alert">
          {failure}
        </p>
      )}
    </div>
  )
}
