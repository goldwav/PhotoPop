# Security Policy

## Supported versions

Only the newest tagged alpha is supported while PhotoPop is pre-1.0.

## Reporting a vulnerability

Do not publish vulnerability details in an issue, discussion, pull request, or
other public channel.

Use GitHub's **Report a vulnerability** button on this repository's Security
advisories page. The resulting report is private between you and the repository
security team. Include:

- the affected PhotoPop version or commit;
- the security impact and likely attack scenario;
- the smallest reliable reproduction or proof of concept;
- relevant operating-system details; and
- any suggested mitigation.

Use synthetic or license-safe test files. Do not send private artwork,
credentials, access tokens, personal data, or client material.

### If private reporting is unavailable

If the **Report a vulnerability** button is not visible, use the repository's
**Security contact request** issue form. That public form exists only to ask the
maintainers to provide a private channel. Do not include the affected feature,
version, filenames, reproduction steps, logs, screenshots, exploit code, or any
other vulnerability detail in that issue.

Maintainers will enable GitHub private vulnerability reporting or publish a
verified private contact method before asking for technical details. Submit the
actual report only through that private channel.

Please allow the maintainers a reasonable opportunity to investigate and
coordinate a fix before public disclosure.

## Security boundaries

- The Electron renderer is sandboxed and has no Node.js integration.
- Filesystem access is limited to validated, typed preload operations.
- Imported files are size-limited and decoded outside the UI renderer where possible.
- PhotoPop never loads remote executable code and ships with a restrictive content security policy.
