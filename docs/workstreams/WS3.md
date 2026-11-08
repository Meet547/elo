# WS3 — identity and recovery

Partial implementation, not deployed. Provider-backed sign-in, persistent session revocation, unique names, account management and verified-ranked gating remain open.

## Returning-player recovery

A failing regression reproduced the reviewed bug: after a transient 502, boot completed without the returning identity. Resume now retries safe GETs for up to 120 seconds; only an explicit 401 permits anonymous onboarding. Expiry, malformed payloads and temporary network/host errors produce a reconnect screen rather than a new-account form. Root, ranked and live entry points use the same reconnect surface. Duplicate boot calls share the pending request.

Before POST creation the client resumes the cookie again. The server also returns the signed cookie owner's existing player instead of replacing identity. Neither path replays an identity-creation POST during a cold start.

Tests cover a virtual 60-second host outage, retry expiry, explicit anonymous response, forbidden and malformed responses, duplicate callers, and a repeated authenticated claim with unchanged player counts. Typecheck, lint and isolated leaderboard/profile integration pass.

## External configuration

Google, Neon and email accounts are not configured. Owner has approved free tiers and approximately 100 prototype users. The private administrator identity is recorded only through the future ADMIN_EMAILS environment allowlist, not committed. No account is granted administrator rights merely because a display name or unsigned email matches it.

## Provider sessions implemented locally

New cookies contain 256-bit random opaque tokens; only SHA-256 token hashes and expiries are stored. Current-device logout removes that token. Logout-all removes persistent sessions and permanently disables the owner's legacy signed cookies; a subsequent verified sign-in can issue a fresh opaque session. Legacy cookies remain compatible before explicit revocation so existing players can retain their IDs during migration. Database unavailability fails authentication rather than minting an identity.

Google authorization uses a server-side code exchange, PKCE S256, ten-minute single-use state, a browser-bound HttpOnly cookie and a nonce checked against the verified ID token. The official Google authentication library validates signature, audience, issuer and expiry. Provider subject is the account key; matching email alone never merges histories. Connecting a new provider to the current guest retains the original player ID, ratings and history. Returning provider sign-in restores that original ID. Switching between already verified players requires explicit sign-out; guest histories are not silently merged.

Administrator status is derived only from a verified provider email matching ADMIN_EMAILS. No actual owner email or secret is committed. Account settings expose Google connection status and verified accounts can sign out one or all devices. The same-origin proxy now preserves OAuth Location headers; its redirect regression failed before correction.

Tests use a generated local RSA key and fixture certificate, not Google requests or real credentials. They verify successful signed-token validation and rejection of tampering, wrong audience, expired tokens, unverified emails and nonce mismatch. Isolated Postgres tests verify state/browser binding, expiry, replay rejection, guest upgrade, cross-device restoration and administrator provenance. An absent provider configuration returns an unavailable response rather than fake authentication.

Still open: optional email magic-link provider, unique display-name enforcement, durable account/IP rate limits, verified placement-pool gating, export/deletion workflows, moderation/admin actions, and live OAuth acceptance. Provider integration does not mean these features or worldwide 12+ registration are ready.

Implementation reference: [Google OpenID Connect server flow](https://developers.google.com/identity/openid-connect/openid-connect).
