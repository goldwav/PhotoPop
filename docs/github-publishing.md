<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# GitHub publishing checklist

Prepare the repository files and settings while it is private. GitHub private
vulnerability reporting is available for public repositories, so complete the
activation steps immediately after changing the repository to public and before
announcing it or distributing its URL.

## Default-branch protections

Before accepting public contributions, create a ruleset targeting the
repository's default branch:

1. Require changes to arrive through pull requests.
2. Require at least one approving review, dismiss stale approvals after new
   commits, and require review conversations to be resolved where those
   protections are available.
3. Run an initial hosted pull request, then copy the exact status-check context
   names displayed by GitHub into the ruleset. They are expected to be
   `verify / verify` and `windows-e2e / electron-smoke`; require both exact
   observed contexts rather than guessing labels or marking them optional.
4. Block force pushes and default-branch deletion.
5. Limit ruleset bypass to designated release or administrator maintainers.
6. From a non-administrator account, confirm that a collaborator cannot push
   directly, merge without approval, merge with unresolved conversations,
   bypass a required check, force-push, delete the branch, or bypass the rule.

These are hosted repository settings and remain unproven until the ruleset and
non-administrator test have both been completed on GitHub.

## Release publishing protections

The workflow binds its publish job to the `windows-alpha-release`
environment and rejects release tags whose commit is not on the default
branch. The environment and tag permissions themselves are GitHub settings;
this repository cannot prove that they are configured until they are checked
on the hosted repository.

Before enabling or pushing a `v*` release tag:

1. Create the `windows-alpha-release` environment in repository settings.
2. Add a required maintainer reviewer. Enable prevention of self-review when
   that protection is available, and limit environment administration and
   deployment approval to the release-manager group.
3. Require the approving maintainer to review evidence tied to the exact
   workflow run, `SHA256SUMS.txt`, and `PROVENANCE.json` for:
   - actual installer installation, upgrade, and uninstall;
   - a true low-disk-volume failure and recovery;
   - integrated-GPU pan/zoom FPS and p95 brush-input latency;
   - native-dialog keyboard and screen-reader accessibility; and
   - the unsigned-build and Windows SmartScreen disclosure shown to users.
4. Require the approving maintainer to confirm that the repository's
   Dependabot and dependency-alert view has zero unresolved critical or
   high-severity findings affecting the shipped application or toolchain.
   A non-exploitable exception must identify the advisory, affected version
   and path, rationale, mitigation, owner, and expiry. It must be explicit
   and time-bounded and cannot waive an exploitable critical or high finding.
5. Create a tag ruleset targeting `v*`. Restrict tag creation, updates,
   deletion, and ruleset bypass to the release-manager group.
6. Confirm that an arbitrary collaborator cannot create or update a `v*` tag,
   bypass the tag ruleset, approve their own deployment, or publish a release.
7. Confirm that a branch-based manual workflow run can still verify and package
   without entering the publish job.
8. Confirm that a tag whose commit is outside the default branch fails the
   ancestry guard.
9. Confirm that a valid release-manager tag remains blocked until the protected
   environment reviewer approves the exact-artifact and dependency evidence.

These real-machine, accessibility, reputation, and dependency checks are
external evidence gates. The presence of a workflow artifact does not prove
that they passed, and this checklist does not claim that they are complete.

The workflow does not run a networked `pnpm audit`, because that would send
the full lockfile and dependency graph to an external npm service. Do not add
such a step without specific authorization. Publication instead remains
blocked on the protected review of GitHub's repository-native dependency
alerts after those alerts have been enabled and allowed to finish processing.

Do not treat the `environment:` workflow key alone as proof that these hosted
protections are active. Record the completed settings and evidence review in
the release checklist before creating the first public alpha tag.

## Private vulnerability reporting

1. Change the repository visibility to public.
2. Immediately open the repository's **Settings** page.
3. In the **Security** section, open **Advanced Security**.
4. Enable the repository **Dependency graph**.
5. Enable **Private vulnerability reporting**.
6. Enable **Dependabot alerts** and **Dependabot security updates**.
7. Confirm that GitHub has processed the pnpm manifest and lockfile and that
   the dependency-alert view is available for release review.
8. From a non-administrator account or signed-out browser, confirm that the
   repository's Security advisories page shows **Report a vulnerability**.
9. Have at least one maintainer watch the repository for **Security alerts** and
   enable email notifications for watched security alerts.
10. Submit and then close a harmless test report to verify that the maintainer
    receives it privately. Do not use real vulnerability details for this test.
11. Only after those checks pass, announce the repository or distribute its URL.

GitHub's current setup instructions are documented in
[Configuring private vulnerability reporting for a repository](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configuring-private-vulnerability-reporting-for-a-repository).

If an organization-owned repository uses a default security configuration, set
the **Dependency graph**, **Private vulnerability reporting**, **Dependabot
alerts**, and **Dependabot security updates** to enabled for new public
repositories and still perform the signed-out verification above.

The public **Security contact request** issue form is a fail-safe during the
short activation window or for accidental misconfiguration, not a replacement
for a private reporting channel.

## Disclosure-path check

Before announcing the public repository, verify all of the following:

- `SECURITY.md` appears under the repository's Security policy link.
- **Report a vulnerability** opens a private advisory form.
- Blank public issues remain disabled.
- The **Security contact request** form contains no free-text field and cannot
  collect vulnerability details.
- Bug, data-safety, and format-compatibility forms direct suspected security
  reports to `SECURITY.md`.
