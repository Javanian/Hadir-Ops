# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use **Report a vulnerability** on the repository's Security tab (GitHub private vulnerability reporting), or email teesanfajar@gmail.com with "Rollproof security" in the subject.

Include what you found, how to reproduce it and what an attacker could do with it. You will get an answer within 5 working days. Please give a reasonable time to ship a fix before publishing details; reporters are credited in the release notes unless they prefer not to be.

The public demo resets every day and holds only fictional data. Testing against it is welcome as long as it does not degrade it for other visitors: no denial of service, no automated scanning at volume, and no attempts to reach other people's data or the server itself.

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x (HadirOps) | No, upgrade to 2.x |

## What the project does to stay secure

- **Supply chain.** Every Python and npm dependency is locked with its hash and installed with `uv sync --locked` and `npm ci --ignore-scripts`. New releases are adopted only after a 7-day cooldown. Base images and GitHub Actions are pinned by digest and commit SHA. CI audits every locked package against OSV, including known malicious releases, and checks the workflows with zizmor.
- **Releases.** Images on `ghcr.io` carry SLSA provenance, an SBOM and a GitHub artifact attestation; verify one with `gh attestation verify oci://ghcr.io/javanian/rollproof-backend:<version> --repo Javanian/rollproof`.
- **Model files.** The face models are pinned to one upstream commit and their SHA-256, checked at build time and again at every start.
- **Authentication.** bcrypt password hashes, short-lived access tokens, refresh tokens that stop working after a password change, account lockout after repeated failures, and per-client rate limits on sign-in.
- **Authorization.** Object-level access rules in one module: supervisors reach only their direct reports, employees only themselves, and an unknown role gets the narrowest access.
- **Production defaults.** The API refuses to start with the development secret, hides its interactive docs, allows CORS only for its own origin and runs as a non-root user. Caddy adds HSTS, a Content-Security-Policy and the other security headers and caps request bodies.
- **Biometrics.** See [PRIVACY.md](PRIVACY.md): face photos are processed in memory and never stored.

## Known limitations

Face verification has no liveness check, so a good photo of an enrolled employee may pass; GPS, clock checks and the supervisor review queue are the other controls. See [Limitations](README.md#limitations).
