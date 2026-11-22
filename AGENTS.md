# AhiBizz development

Codex and Claude Code use `origin/integration/ahibizz` in the private `murebure1-cell/ahibizz-next` repository as their shared development base. The private `main` follows a separate history. The `murebure1-cell/ahibizz-deploy` mirror feeds OctaDeploy app 213.

## Shared work

1. Fetch `origin` and check existing worktrees and open pull requests before picking a task. Record the task, owner, intended scope and branch in a draft pull request when both agents are active. Keep one owner per task and coordinate before touching the same files.
2. Start a `codex/<task>` or `claude/<task>` branch from `origin/integration/ahibizz` in a separate worktree. Preserve uncommitted work in other worktrees. Keep each change focused on its task.
3. Target `integration/ahibizz` for pull requests. Record the changed flows, checks actually run and known gaps. Confirm the combined result before marking the task done.

## Verification and release

- Use the Node version and pnpm pin from `package.json`. Run `pnpm check` and the relevant flow tests with isolated data. Keep browser checks and payment or other business transaction checks distinct in the handoff.
- New Ahi Credits top-ups use bank transfer and administrator approval after matching the payment. AhiBizz purchases use credits. Preserve past payment records and keep Facebook integration deferred.
- Keep credentials, production data and private exports out of Git. Before an authorized release, designate one publisher to verify the deployed revision, create a fresh backup, deploy the reviewed revision and confirm it on the live app.
