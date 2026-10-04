# Repository controls

SecureInbox uses separate gates for normal development and production.
`main` is the self-hosted development line. `prod` is the revision deployed to
the Raspberry Pi.

## Protected branches

Both branches require pull requests, current Quality and CodeQL checks, and
resolved review conversations. Force pushes and branch deletion are disabled.
The rules also apply to repository administrators.

Required check contexts:

- `backend`
- `frontend`
- `infra`
- `integration`
- `CodeQL`

Neither branch requires an approving review while the repository has one human
maintainer. GitHub never lets the author approve their own pull request, so a
required approval could only be met by relaxing the rule for every release,
which is what the former emergency procedure did each time. A rule that is
always bypassed protects nothing and teaches that bypassing is normal.

The human gate for production is the promotion pull request from `main` into
`prod`. Its description must record, before it is merged:

- the release contents (the pull requests it carries) and anything deliberately
  left out;
- that the pre-deployment backup in
  [raspberry-pi-deployment.md](raspberry-pi-deployment.md#back-up-before-every-deployment)
  will be taken, and the exact rollback revision;
- any configuration migration the release needs.

When a second maintainer joins, set `required_approving_review_count` on `prod`
back to `1` (command below) and update this section.

Inspect the live rules before a release:

```bash
gh api repos/AndreiStolojan/SecureInbox/branches/main/protection
gh api repos/AndreiStolojan/SecureInbox/branches/prod/protection
```

## Dependency policy while paused

Dependabot security updates stay enabled and may open a pull request as soon as
a vulnerable dependency has a fix. Routine version updates run monthly. Minor
and patch updates are grouped once per package manifest; major updates remain
separate so their migration risk is visible. At most five routine update pull
requests may be open for each manifest.

Dependabot may create branches and pull requests, but it has no review or merge
permission. A human decides whether to merge after the same protected-branch
checks as any other pull request.

The repository owner, `AndreiStolojan`, owns Dependabot, code scanning, and
secret-scanning alert triage. Secret scanning and push protection must remain
enabled. Security alerts are reviewed in the repository Security tab; secrets
or exploit details must not be copied into public issues.

## Changing the review requirement

Review requirements change only through a pull request that updates this file.
To require one approving review on `prod` again:

```bash
gh api --method PATCH \
  repos/AndreiStolojan/SecureInbox/branches/prod/protection/required_pull_request_reviews \
  -F dismiss_stale_reviews=true \
  -F require_code_owner_reviews=false \
  -F required_approving_review_count=1 \
  -F require_last_push_approval=false
```

Required pull requests, required checks, administrator enforcement, and the
force-push and deletion protections stay on regardless of the review count.

## Resuming development

Change controls through a tracked issue and pull request. Capture both live
protection responses before changing them. A temporary rule change must name
its owner, reason, expiry, and exact restoration values. When regular work
resumes, change Dependabot cadence in `.github/dependabot.yml` through a pull
request; do not disable security updates, secret scanning, or push protection.

After the temporary period, restore the values in this document and verify the
two protection endpoints again. Close the tracking issue only after the live
responses match the documented policy.
