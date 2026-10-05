# Security policy

Barb is an actively developed open-source project (the repository is still named SecureInbox). A hosted instance runs at [secure-inbox.app](https://secure-inbox.app) on a single Raspberry Pi, operated by one person, with no uptime or response guarantee. Barb is a triage aid: use it as a second pair of eyes, not as the only security control for a mailbox.

## Reporting a vulnerability

Please report security issues privately through [GitHub Security Advisories](https://github.com/AndreiStolojan/SecureInbox/security/advisories/new). Do not open a public issue with credentials, email contents, OAuth tokens, or an exploit proof of concept.

Include the affected component, a short reproduction path, the impact, and any mitigation you have found. You should get an acknowledgement within seven days.

## Scope

In scope:

- the code in this repository,
- the hosted instance at secure-inbox.app,
- the Mac app and the install script at `secure-inbox.app/install.sh`.

When testing the hosted instance, use only your own account, and do not run load or denial-of-service tests. It is a Raspberry Pi.
