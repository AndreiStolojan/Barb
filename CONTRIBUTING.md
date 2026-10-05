# Contributing to Barb

Thanks for taking a look. Bug reports, false positives, new detection signals and small fixes are all welcome.

## Before you start

- **Small fix?** Open a pull request directly.
- **Bigger change?** Open an issue first and describe what you want to change and why. It saves you from building something that won't fit.
- **Security issue?** Don't open a public issue. Use [SECURITY.md](SECURITY.md).
- **Barb got a message wrong?** Open an issue with the verdict, the rules that fired, and the relevant headers (`From`, `Reply-To`, `Authentication-Results`, links). Please leave out the message body and anything personal.

## Setup

Run the app with demo data:

```bash
./provision
```

Then open http://localhost:8080. Native hot reload and the other setups are in [docs/environments.md](docs/environments.md).

## Checks

You need Node.js `24.20.0`. Run these before opening a pull request:

```bash
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run lint
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run build
```

## Pull requests

- Branch from `main` and keep one change per pull request.
- Use a conventional title: `feat(...)`, `fix(...)`, `docs(...)`, `refactor(...)`, `chore(...)`.
- Add a focused test when behavior changes.
- Add screenshots when the UI changes.
- Detection changes must keep the evidence visible. Every point a rule adds has to show up in the message's scoring details, and the local model must never decide a verdict on its own. [docs/detection-engine.md](docs/detection-engine.md) explains how providers and weights fit together.
- Treat email content as hostile. Anything from a message has to be sanitized or validated before it is displayed, logged, or used to make a network request.

## Automated review

Two coding agents can review a pull request when asked in a comment. Neither runs on its own.

| Agent  | Review only              | Change the pull request branch                           |
| ------ | ------------------------ | -------------------------------------------------------- |
| Codex  | `@codex review`          | `@codex fix the reported issue and push the changes`     |
| Claude | `@claude review this PR` | `@claude fix the reported issue and push to this branch` |

Their shared rules live in [AGENTS.md](AGENTS.md).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
