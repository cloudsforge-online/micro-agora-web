/**
 * Reading this repository's own files as text, for the tests that check artefacts no bundler sees.
 *
 * Four files decide how this surface behaves and none of them is ever imported: `nginx.conf` decides
 * the HTTP status of every address, `index.html` carries the description a link-preview fetcher
 * reads, `Dockerfile` decides what is inside the image, and `src/styles.css` names custom properties
 * that silently delete a declaration when they do not exist. Nothing typechecks any of them, so
 * reading them as strings is the only leverage this repository has over them.
 *
 * ── COMMENTS ARE STRIPPED, AND THAT IS NOT AN OPTIMISATION ────────────────────────────────────
 *
 * The files here EXPLAIN what they forbid. `nginx.conf` quotes `try_files $uri /index.html` in order
 * to argue against it; `src/styles.css` lists the ten custom properties that do not exist in order
 * to say never to write one; `src/app.tsx` names `ProtectedRoute` in order to say there is none; and
 * `index.html` spells out the analytics `<script src=…>` it refuses to carry. A grep over the raw
 * bytes matches every one of those sentences and fails a correct file — and a rule that can only be
 * satisfied by deleting the paragraph explaining it is a rule the next person deletes.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This repository's root, from this file rather than from the process's working directory. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The directory the sibling checkouts live in.
 *
 * One level above this repository, which is where `@cloudsforge/ui` already is: package.json
 * consumes it as `link:../ui/packages/ui`, and CI reproduces that layout by checking each sibling
 * out into its own path beside this one.
 */
export const SIBLINGS = resolve(ROOT, '..')

/** A file in this repository, as text. */
export function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

/** A file in a sibling checkout, or null when that repository is not checked out. */
export function readSibling(relativePath: string): string | null {
  try {
    return readFileSync(join(SIBLINGS, relativePath), 'utf8')
  } catch {
    return null
  }
}

export type CommentSyntax = 'ts' | 'css' | 'html' | 'nginx' | 'yaml'

/**
 * Remove the comments, leaving the declarations.
 *
 * Line offsets are NOT preserved, deliberately. Nothing in this repository cites a line number —
 * not a comment, not a commit message, not a pull request — because a line number names a position
 * in a file somebody else may edit, and the estate has already been burned by exactly that: a
 * cross-repository check that read a cited line went red when the service it cited inserted a row
 * above it, while nothing was wrong in either repository. Every check here searches for the fact.
 */
export function stripComments(source: string, syntax: CommentSyntax): string {
  switch (syntax) {
    case 'ts':
      // JSX comments first (`{/* … */}`), then block comments, then line comments. Line comments
      // are matched only at the start of a line so that a `//` inside a URL survives.
      return source
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
    case 'css':
      return source.replace(/\/\*[\s\S]*?\*\//g, '')
    case 'html':
      return source.replace(/<!--[\s\S]*?-->/g, '')
    case 'nginx':
    case 'yaml':
      return source.replace(/^\s*#.*$/gm, '')
  }
}

/** Every file under `src/`, as {path, text} pairs, path relative to the repository root. */
export function sourceFiles(extensions: readonly string[] = ['.ts', '.tsx']): {
  path: string
  text: string
}[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!extensions.some((ext) => entry.name.endsWith(ext))) continue
      out.push({ path: relative(ROOT, full), text: readFileSync(full, 'utf8') })
    }
  }
  walk(join(ROOT, 'src'))
  return out
}
