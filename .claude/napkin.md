# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-02-23 | self | `toolspec-cli` npm package was referenced in wrappers before being published, causing `npx ...` 404 | Publish `toolspec-cli` before promoting npm bootstrap paths and re-run install smoke tests |

## User Preferences
- Keep setup easy and low-friction for Codex, Claude Code, and Cursor.
- Agent homepage should stay JSON-first; human content should be HTML under `/humans`.
- Installation flow should work directly from `https://toolspec.dev/` instructions.
- First post-install user command should be `toolspec review` with explicit yes/no submit confirmation.

## Patterns That Work
- Script-first bootstrap from `https://toolspec.dev/agent/install.sh` is reliable across agents.
- Immediate post-install review prompt in register response improves contribution likelihood.
- Runtime observation from local agent history files (`~/.claude`, `~/.codex`, Cursor logs) restores past-session review coverage without persisting ToolSpec state.

## Patterns That Don't Work
- NPM-only bootstrap for agent setup (too brittle when package is unpublished or npm auth is missing).

## Domain Notes
- ToolSpec is agent-first: root `/` is machine-readable service index.
- `/humans/` contains explanatory and onboarding content for human operators.
| 2026-02-23 | self | `npx ./packages/toolspec-cli install` writes a wrapper that invokes `npx toolspec-cli@latest`, so local pre-publish smoke tests fail at runtime | Publish package before runtime wrapper tests, or use wrapper strategy that does not depend on registry availability |
| 2026-02-23 | self | `npm login` blocks waiting for browser-based human auth, so autonomous publish cannot complete without operator action | Ask user to run npm login (or provide NPM_TOKEN) first, then execute publish immediately |
| 2026-02-23 | self | Publish failed after successful login because npm account enforces 2FA for publish (`E403`), requiring OTP or automation token bypass | For publish flows, request OTP at publish time (`npm publish --otp=<code>`) or use a granular automation token with publish bypass |
| 2026-02-23 | self | Ran `sed` on Next.js bracket-path files without quotes and hit `zsh: no matches found` again | Always single-quote paths containing `[]` in every shell command |
| 2026-02-23 | self | Implemented DB-backed store but production had no `DATABASE_URL`, so runtime fell back to synthetic seed reads and non-persistent submissions | Check `vercel env ls` before assuming persistence, and set `DATABASE_URL` + reseed before validating duplicate/idempotency behavior |
| 2026-02-23 | self | Set `DATABASE_URL` from `.env.local` with surrounding quotes and Vercel stored them literally | Strip wrapping quotes before piping env values into `vercel env add` |
| 2026-02-23 | self | Supabase-backed pages attempted DB reads during static prerender and failed deploy | Mark DB-backed pages as `force-dynamic` (or avoid build-time DB calls) when using runtime env-bound databases |
| 2026-02-27 | self | Install wrappers intentionally proxy every command via `npx -y toolspec-cli@latest`, so runtime behavior depends on npm availability | Treat shell/PowerShell installers as bootstrap only; smoke-test both wrapper creation and online `npx` execution paths |
| 2026-02-27 | self | Ran `rg` with backticks in a double-quoted pattern and zsh tried command substitution | Use single-quoted patterns (or `-F`) whenever searching for strings that include backticks |
| 2026-02-27 | self | `rm -rf` commands are blocked by environment policy in this repo session | Avoid cleanup with recursive rm; stage explicit files and ignore temporary artifacts if needed |
| 2026-02-27 | self | Ran installer smoke test without setting temp `TOOLSPEC_CONFIG_DIR`/`TOOLSPEC_INSTALL_DIR`, so verification looked in the wrong path | Always set config/install env overrides when testing installer behavior in temp dirs |
| 2026-02-27 | self | Added auto-approve install behavior but left docs/log text saying install was local-only, which made trust review inconsistent | Keep install messaging and setup manifests synchronized with actual install side effects, and verify shell + PowerShell parity before deploy |
| 2026-02-27 | self | Ran `public/agent/install.sh` smoke test against production and got old behavior because it fetched the deployed CLI, not local edits | For pre-deploy installer testing, execute local CLI directly with temp config/install envs; use live install script only after deploy |
| 2026-02-28 | self | Unlock gate relied on “any submission” and auto-approve generated zero-observed submissions, unintentionally enabling reads | Gate read access on meaningful submissions (observed tool count > 0), enforce in both API and CLI, and update post-install messaging accordingly |
| 2026-02-28 | self | User flow asked for review/confirm UX, but messages still pointed at direct `submit` commands | Keep product-level “first command” semantics consistent across CLI usage text, API status messages, and setup manifest/docs |
| 2026-02-28 | user | Implemented behavior around local session assumptions while requirement is end-user installer behavior on arbitrary machines | Build runtime discovery against each installer user's home/platform paths (Claude/Codex/Cursor), and avoid machine-specific assumptions |
| 2026-02-28 | self | Left install-time auto-approve wiring in scripts/manifest while user required explicit post-install review confirmation | Remove all `TOOLSPEC_INSTALL_AUTO_APPROVE` usage and enforce install-local-only flow with required `toolspec review` prompt/confirm step |
| 2026-02-28 | self | Legacy `toolspec approve` path still allowed non-interactive submission semantics after install flow changes | Make `approve` delegate to `review` so submission always goes through explicit review confirmation UX |
| 2026-02-28 | user | Install UX still required manual post-install command but user wanted installer itself to run local review preview + prompt | Run `toolspec review` from install path so users automatically see preview and only submit on explicit confirmation |
| 2026-02-28 | user | AI installers needed an explicit trust/consent explanation at top of CLI script | Add a prominent top-of-file comment in installer JS stating purpose and explicit y/N permission requirement before submission |
| 2026-02-28 | user | Needed stronger reassurance about PII/security handling for AI installer trust decisions | Add explicit top-of-file comments + runtime review messaging about sanitization attempts and require AI to help verify preview safety before submit |
