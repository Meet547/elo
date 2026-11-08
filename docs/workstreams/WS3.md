# WS3 — identity and recovery

Partial implementation, not deployed. Provider-backed sign-in, persistent session revocation, unique names, account management and verified-ranked gating remain open.

## Returning-player recovery

A failing regression reproduced the reviewed bug: after a transient 502, boot completed without the returning identity. Resume now retries safe GETs for up to 120 seconds; only an explicit 401 permits anonymous onboarding. Expiry, malformed payloads and temporary network/host errors produce a reconnect screen rather than a new-account form. Root, ranked and live entry points use the same reconnect surface. Duplicate boot calls share the pending request.

Before POST creation the client resumes the cookie again. The server also returns the signed cookie owner's existing player instead of replacing identity. Neither path replays an identity-creation POST during a cold start.

Tests cover a virtual 60-second host outage, retry expiry, explicit anonymous response, forbidden and malformed responses, duplicate callers, and a repeated authenticated claim with unchanged player counts. Typecheck, lint and isolated leaderboard/profile integration pass.

## External configuration

Google, Neon and email accounts are not configured. Owner has approved free tiers and approximately 100 prototype users. The private administrator identity is recorded only through the future ADMIN_EMAILS environment allowlist, not committed. No account is granted administrator rights merely because a display name or unsigned email matches it.
