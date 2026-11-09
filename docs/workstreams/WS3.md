# WS3 — identity and recovery

Implementation is on the hardening branch and is not deployed to production. Google linking, revocable sessions, unique names, profile export/closure and verified placement gating are implemented locally. Email magic links, live provider acceptance and broader moderation/retention policy remain open.

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

Earlier pending name, limiter, placement and owner-account work is implemented in the continuation below. Optional email magic-link provider, full erasure policy, moderation/admin actions and live OAuth acceptance remain open. Provider integration does not mean these features or worldwide 12+ registration are ready.

Implementation reference: [Google OpenID Connect server flow](https://developers.google.com/identity/openid-connect/openid-connect).

## Unique names, durable limits and account controls

New claims/renames use an NFKC-normalized, whitespace-normalized lowercase key protected by a database unique constraint. Concurrent case/compatibility variants produce one successful claim and one conflict. The baseline regression created both profiles before correction. Legacy names retain their original IDs and values with a null key; their owners explicitly claim an available name before ranked play. The profile form allows claiming an unchanged legacy name. Basic reserved staff names and a small explicit profanity list are rejected. This is not a comprehensive multilingual moderation service; moderation ownership and broader filtering remain open.

Mutation limits persist atomic fixed windows in Postgres for both client IP and authenticated actor, with HMAC-hashed keys so raw addresses/IDs are not stored. A two-process regression first demonstrated that the in-memory limiter could be reset. Restart/IP-rotation/account-rotation and concurrent-limit tests now pass. Read-only leaderboard/history endpoints retain bounded local traffic counters without database mutations. Expired-window sweeping belongs to the lifecycle worker.

Owners can export their own profile, provider contact records, complete history and own match participation without session credentials or other players' hidden cards. Explicit profile closure removes provider credentials, revokes sessions/legacy cookies, removes the queue entry, releases the name key and replaces the public profile name. Settlement/history rows remain for integrity; historical room snapshots/backups are retained, so this is account closure rather than a claim of complete legal erasure. Closure refuses active ranked/private games to avoid orphaning an in-flight match. Retention/erasure policy and legal approval remain deferred.

Ranked eligibility is enforced inside matchmaking, including direct service calls: verified provider identity and an explicitly claimed unique name are required. Guests can practice/private-play and cancel old queue entries, but cannot queue or poll into a new ranked match. Placement and established players occupy separate queue pools. The boundary reuses the existing PROVISIONAL_SESSIONS constant (12), with no change to rating math. A separate rankedPlacements counter advances only in the atomic ranked settlement; legacy rated/history totals cannot bypass these new verified placements. Tests prove guests are refused, legacy names require a claim and the two pools cannot match. The production smoke now verifies guest refusal before installing a verified identity in the isolated fixture database; no production bypass switch exists.

Email magic links, live provider acceptance, moderation/admin actions and the separate lifecycle/worker/realtime work remain open. Google and email credentials have not been provisioned by these code changes.
