# Repository working agreements

## Durable design decisions

- Treat `PLAN.md` as the durable record of this project's product,
  architecture, data-model, validation, and visual-design decisions.
- Whenever a design decision is made or changed, update `PLAN.md` in the same
  change as the implementation. Do not leave decisions only in chat or session
  context.
- Before starting or resuming development, read `PLAN.md` and keep the work
  consistent with its recorded decisions and roadmap.

## Dependencies

- Favor fewer runtime dependencies. Add one only when it replaces commodity
  infrastructure, is browser-compatible, has an acceptable license, and
  provides measurable value over local code.
- Do not add Node-native packages to browser runtime code.

## Runtime and package management

- Use the exact Node version pinned in `.nvmrc`; run `nvm use` before
  installing, testing, or building.
- Keep `package.json`, `package-lock.json`, `.nvmrc`, and the GitHub Pages
  workflow consistent.

## Versioning

- `package.json` is the single source of truth for the semantic application
  version. Bump it only when accepted work is merged to `main`, using patch,
  minor, or major according to compatibility and scope.
- Feature worktrees keep the current `main` semantic version and append their
  sanitized branch name to the displayed build version (for example,
  `v0.2.6-generalized-explorer`). This makes review servers unambiguous without
  consuming versions for unmerged iterations.
- Keep the root version in `package-lock.json` synchronized with
  `package.json`.
- On `main`, the UI must display the build-injected version as
  `vMAJOR.MINOR.PATCH` beneath the site title.

## Git and deployment

- All repository work must be tracked in Git. Make focused, reviewable commits
  and preserve unrelated user changes.
- Commit and publish each completed feature as soon as its local test suite
  passes, following the applicable branch and pull-request workflow. Do not
  batch multiple completed features into one commit or leave verified work
  unpublished.
- A development turn is complete only after every requirement in the user's
  prompt has been met. Progress updates, iteration, and clarifying questions
  may happen before completion without publishing partial work.
- Do not treat a development turn as accepted or publish it until the user
  explicitly says `push`. Iteration, review, questions, and locally green
  checkpoints may occur before that confirmation without committing or
  pushing partial work.
- When the user says `push`, first ensure every requirement in the prompt is
  complete and run the full required test suite against the final working
  tree. If it is green, commit and push; if it is not green, do not push and
  report the failures.
- Treat side conversations as discussion and read-only investigation by
  default because they share the main thread's workspace and Git state.
- A side conversation may modify files only when the user explicitly requests
  it after the side-conversation boundary. Before editing, verify that the
  checkout is clean and that the change will not overlap known main-thread
  work. If coordination is uncertain, leave implementation to the main thread.
- Keep side-conversation edits narrowly scoped. Recheck the checkout before
  committing or pushing, and do not overwrite, bundle, or publish unrelated
  main-thread changes.
- Do not force-push or rewrite published `main` history.
- GitHub Pages is deployed by `.github/workflows/deploy.yml`. Keep the Vite
  base path and generated assets compatible with `/math-graph/`.
- A change is not deployed until the Pages workflow succeeds. For production
  fixes, verify the relevant public URL and deployed asset content.

## Testing and quality

- Add deterministic unit tests for pure data, validation, graph, and layout
  behavior. Add Playwright coverage for meaningful browser-visible behavior.
- Before committing or publishing, run:

  ```sh
  npm test
  npm run check
  npm run build
  npm run test:e2e
  git diff --check
  ```
