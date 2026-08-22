---
description: Branch, verify, PR, auto-merge and clean up in one pass
argument-hint: [what you are shipping]
---

Ship the current work — $ARGUMENTS — end to end. Do not stop halfway to ask
whether to continue; stop only if a check genuinely fails or the change turns
out to be wrong.

1. **Branch.** If on `main`, cut a branch from fresh `origin/main`:
   `git fetch origin && git switch -c <kebab-task> origin/main`.
   Never commit directly to `main`.

2. **Verify before committing.** Run `npm run typecheck` and `npm test`.
   If anything visual changed, run `npm run shot` and **actually read the PNGs
   in `.shots/`** — pixel art cannot be reviewed by reasoning about it.
   Report what the commands printed, not that they "should pass".

3. **Commit.** Subject in the imperative, under ~70 chars, no Claude
   attribution trailer. Body explains *why*, not a list of touched files.

4. **Push and open a PR.** `git push -u origin <branch>`, then `gh pr create`
   filling in the template honestly — especially the verification section, and
   especially anything you could not verify.

5. **Watch CI.** `gh pr checks --watch`. If `check` fails, read the log, fix it,
   push again. Do not merge around a red check.

6. **Merge.** `gh pr merge --auto --squash`. The branch deletes itself.

7. **Clean up.** `git switch main && git fetch origin && git pull --ff-only`,
   then `git branch -d <branch>`. If you used a worktree,
   `git worktree remove ../piano-cat-wt/<task> && git worktree prune`.

8. **Confirm the deploy.** A merge to `main` redeploys Pages. Watch the run and
   check <https://oddurs.github.io/piano-cat/> returns 200 before calling it done.

Report the PR URL and what CI actually said.
