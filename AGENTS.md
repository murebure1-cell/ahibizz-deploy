# AhiBizz development

Codex and Claude Code use `origin/integration/ahibizz` in the private `murebure1-cell/ahibizz-next` repository as their shared development base. The private `main` follows a separate history. The `murebure1-cell/ahibizz-deploy` mirror feeds OctaDeploy app 213.

## Shared work

1. Fetch `origin` and check existing worktrees and open pull requests before picking a task. Record the task, owner, intended scope and branch in a draft pull request when both agents are active. Keep one owner per task and coordinate before touching the same files.
2. Start a `codex/<task>` or `claude/<task>` branch from `origin/integration/ahibizz` in a separate worktree. Preserve uncommitted work in other worktrees. Keep each change focused on its task.
3. Target `integration/ahibizz` for pull requests. Record the changed flows, checks actually run and known gaps. Confirm the combined result before marking the task done.

## Asking Claude Code from Codex

Codex can ask Claude Code a read-only question from its worktree, for example a second review of a diff, a check of a plan or where a flow lives in the code:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\tabak\AppData\Local\AhiBizzNext\tools\ask-claude.ps1 -Dir . -Prompt "Pregledaj git diff origin/integration/ahibizz...HEAD (sadržaj je ispod) i navedi bugove s putanjom i linijom."
```

- The script starts the newest Claude Code CLI on this computer with only Read, Grep and Glob in the given directory: no edits, shell, web, MCP connectors or skills, and no saved session. Longer input can be piped on stdin.
- Claude cannot run `git`, tests or builds in this mode. Paste the diff or command output into the prompt when the question depends on it.
- Treat the answer as review input. The task owner decides, makes the change and records it in the pull request. Each call uses the owner's Claude plan, so keep questions focused.

## Verification and release

- Use the Node version and pnpm pin from `package.json`. Run `pnpm check` and the relevant flow tests with isolated data. Keep browser checks and payment or other business transaction checks distinct in the handoff.
- The interface speaks Bosnian (source), English, German, Arabic and Turkish, chosen automatically from the device; user content is not translated. Write interface text in Bosnian through `t()`, `msg()` or `titled()` and add all four translations to `src/lib/i18n/catalog.ts` (see `docs/I18N.md`); `tests/i18n.test.ts` checks this.
- New Ahi Credits top-ups use bank transfer and administrator approval after matching the payment. AhiBizz purchases use credits. Preserve past payment records and keep Facebook integration deferred.
- Keep credentials, production data and private exports out of Git. Before an authorized release, designate one publisher to verify the deployed revision, create a fresh backup, deploy the reviewed revision and confirm it on the live app.

- Read docs/DEFINICIJA.md first: it defines the three addresses (public, admin, CMS), where code goes, roles, behaviour, the navigation model and the order of work to launch. A change that does not fit it starts by changing that document.
- Read docs/PROIZVOD.md for what the product is meant to do: packages and limits, the profile, settings, the add-business flow with its category steps, restaurant menu and meat supplier, sponsored placement, analytics by package and the build order. The owner set the packages on 2026-11-25: Basic (one business, free for the first 12 months, then 19.90 BAM a month), Startup (up to 3 businesses, 39.90 BAM a month) and Business (up to 10, 79.90 BAM a month). Reels a business may publish, set the same day: Basic one a week, Startup three a week, Business one a day; the code does not enforce this by package yet. These replace the earlier 29/49/89 monthly and 290/490/890 annual terms; an annual price and a commitment period have not been restated. Items marked [pitanje] are still the owner's to decide. A price in that document does not switch on charging, and a package or sponsored placement never grants an identity or Halal badge.
