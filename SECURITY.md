# Security Policy

## Supported versions

Only the newest tagged alpha is supported while PhotoPop is pre-1.0.

## Reporting

Do not open public issues for suspected vulnerabilities. Send maintainers a private report containing impact, reproduction steps, affected files, and any suggested mitigation. Do not include private documents or images.

## Security boundaries

- The Electron renderer is sandboxed and has no Node.js integration.
- Filesystem access is limited to validated, typed preload operations.
- Imported files are size-limited and decoded outside the UI renderer where possible.
- PhotoPop never loads remote executable code and ships with a restrictive content security policy.
