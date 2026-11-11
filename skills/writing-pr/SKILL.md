---
name: writing-pr
description: Write pull request titles and bodies that read like a person wrote them. Conventional Commit title, short concrete bullets, a diagram or snippet instead of paragraphs, annotated before/after tables for anything visual, baseline/candidate tables for benchmarks. Use when opening a PR, writing or editing a PR title or body, or describing a branch or diff for review. Triggers on pull request, PR, PR title, PR body, PR description, gh pr create, gh pr edit, describe this branch.
---

# Writing a PR

The reviewer opens the PR cold. They want four things: what is different now, why, where to look
and what could go wrong. Give them that in bullets, show the rest with a diagram, a snippet or a
table, and stop.

## 1. Read the final diff

- Write from what will be squash-merged: `git diff <base>...HEAD`. Commit messages tell you
  intent, but the diff is what lands.
- Leave out how the branch got here. Earlier attempts, reverted approaches, a diff that shrank
  from +6k to +1k lines, review rounds: none of it matters once it is merged.
- Look for `.github/pull_request_template.md` (or `.github/PULL_REQUEST_TEMPLATE/`). If there is
  one, keep its headings and fill them in this style. Write `None.` under a section that does not
  apply. Leave checklists alone, ticking them is the author's call.

## 2. Title

`type(scope): what it does`, as a Conventional Commit.

- Lowercase after the colon (names keep their capitals), imperative, no trailing period.
- Name the outcome, not the mechanism. Someone reading only the title should know what is
  different.
- Two or three outcomes can share a title, separated by commas. Add `!` for a breaking change.

```text
fix(analytics-imports): stop Tinybird delete pile-ups, re-run the broken imports, alert with the org
fix(autopilot): let bans, ideas and rules decay so Autopilot stops getting more cautious
feat(minigame): add Notra Dogfight with X login and a verified leaderboard
fix(cli): decode every common image format and survive hostile pages
chore!: forward every import to @usenotra/sdk
```

Not: `fix: various improvements`, `feat(settings): enhance the user experience`, `Update runner.ts`.

## 3. Body

Bullets first. One context line above a media table is the only prose outside a bullet.

1. **The outcome.** Start with a verb (Fixes, Stops, Adds, Lets, Turns, Moves) and say what
   people see now. Then say what was wrong before. When the cause is a chain, walk through it in
   short sentences, so this one bullet may run three or four sentences. Stacked PR? End it with
   `Builds on #123.`
2. **One bullet per area.** When the PR touches several, open each with a short label
   (`Topics:`, `Dashboard:`, `Anti-cheat:`). Say how it works now, with the real numbers
   (`every 10 s, up to 6 times`, `45 days`, `4.5:1`) and where it lives (`syncTopicsWithFindings`
   in `lib/autopilot/planner.ts`, `button.tsx:22`).
3. **Nested bullets** for a list of cases or conditions. Never for prose.
4. **What did not change**, when a reviewer would wonder: `Every workspace starts on "Ask".`
   `The 0.85 threshold is unchanged.`
5. **The reason behind a surprising choice**, in the same bullet: `0.10.0, not 0.8.x: caret
   ranges on 0.x never pick it up, so nobody moves without choosing to.`
6. **What is left out on purpose**, as one `Not in this PR:` bullet. Skip it if nothing is.
7. **What someone has to do**: env vars, migrations, deploy order, steps after merge. Bold it
   only if the PR must not merge without it.
8. **`Written with an AI coding agent.`** as the last bullet when an agent wrote the code.

Then show what words would explain badly. Usually one or two of these, never all of them:

- a mermaid diagram for a flow, a state machine or an old path next to a new one
- a code snippet: the smallest usage or internals that show the idea, `// before` and `// after`
  in one block when the change is a pattern
- a `text` block of real output: an alert, a log line, a CLI result
- a table for any comparison: numbers, old name to new name, before and after

Most PRs need 3 to 6 bullets. A large feature can need a dozen, and each one still has to earn
its line.

## 4. Sound like a person

Cut on sight:

- Headings the repo did not ask for: `## Summary`, `## Changes`, `## Why`, `## Test plan`.
- "This PR …" openers, a first bullet that repeats the title, closing lines like "Overall, …".
- Testing talk: "tests pass", "I ran", "verified locally", "lint is clean". CI already says so.
  Measured numbers are different; they go in a table (see `prBase/benchmark.md`).
- Inflated words: comprehensive, robust, seamless, enhance, leverage, streamline, ensure,
  significantly, various, improved handling of.
- Filler and hedges: "in order to", "it's worth noting", "this should help", "now properly".
- Narrating your session: "I noticed", "after investigating", "it turned out".
- Emoji, bold scattered for emphasis, em dashes between clauses. Use a period or a colon.
- A file-by-file tour. Name a file when it tells the reviewer where to look, not to prove you
  touched it.

Prefer:

- Present tense for the new behavior ("retries a 429 every 10 s"), past tense only for the old bug.
- Real nouns: the function, the file, the env var, the route, the PR number.
- Numbers with units over adjectives: "35–40% faster", never "much faster".
- Short sentences. A bullet with three "and"s is two bullets.

```md
<!-- not -->
- Enhanced the retry logic to more robustly handle rate limiting scenarios, ensuring imports complete reliably.

<!-- but -->
- A rate-limited attempt no longer counts toward a chunk's attempts, so its retry skips the delete (`runner.ts`).
```

## 5. Pick a template

| Change | Template |
| --- | --- |
| Most PRs | [`prBase/default.md`](prBase/default.md) |
| Anything a user can see: UI, copy, motion, charts, emails, generated output | [`prBase/visual.md`](prBase/visual.md) |
| Speed, size, memory, cost, query count | [`prBase/benchmark.md`](prBase/benchmark.md) |
| Hard, high-risk or wide-scoped | [`prBase/blog.md`](prBase/blog.md) |

Combine them when a PR is two things, e.g. a fix with a visible effect gets `default.md` bullets
and the `visual.md` table.

## 6. Screenshots and video

- Before and after always go in a table, one row per state, never as loose images.
- Put one line above the table with what was captured: route, data, viewport and dpr
  (`/settings with mock data, 1440×900 @2x.`). Write `none` in a cell when that side does not
  exist and `(same image)` when nothing changed there.
- Mark up every screenshot with the `annotate` skill: short handwritten notes with arrows that
  say what changed and why, so the reviewer sees the decision instead of playing
  spot-the-difference. The full flow is in [`prBase/visual.md`](prBase/visual.md).
- Upload with `--attach` (below). Never commit screenshots to the repo.

`annotate` ships in the same repo as this skill. If there is no `annotate` skill or command yet,
install it, then read `~/.agents/skills/annotate/SKILL.md`:

```bash
A=~/.agents/skills/annotate
[ -d "$A" ] || git clone --depth 1 https://github.com/janburzinski/annotate "$A"
[ -d "$A/cli/node_modules" ] || (cd "$A/cli" && bun install)
command -v annotate >/dev/null || { mkdir -p ~/.local/bin && ln -sf "$A/cli/src/index.ts" ~/.local/bin/annotate; }
```

If `~/.local/bin` is not on PATH, run it as `bun ~/.agents/skills/annotate/cli/src/index.ts`.

## 7. Publish

Write the body to a file. Inline `--body` breaks on backticks and quotes.

```bash
gh pr create --title "fix(cli): …" --body-file "$TMPDIR/pr.md" \
  --attach ./before-default.png --attach ./after-default.png
gh pr edit 123 --body-file "$TMPDIR/pr.md"
```

`--attach` uploads the file and rewrites `![…](./before-default.png)` in the body to the uploaded
URL. Paths resolve against the body file's folder first. Read the body once more against section
4 before you send it.
