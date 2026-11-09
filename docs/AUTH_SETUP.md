# Google sign-in setup for the prototype

This branch implements Google sign-in but does not create a Google Cloud project or deploy it. No paid service is required by this integration. Existing guests can be linked without changing their player ID or history.

1. Open [Google Cloud Console](https://console.cloud.google.com/), create or select an Elo prototype project.
2. Open **Google Auth Platform → Branding** and fill in the app name and support/contact email. Under **Audience**, use External with Testing status for the private prototype and add the intended testers. The testing audience restrictions come from Google; this does not publish legal approval for general registration.
3. Under **Clients → Create client**, choose **Web application**. Add the exact frontend origin as an authorized JavaScript origin, for example `https://elopoker-nu.vercel.app`. Add the authorized redirect URI `https://elopoker-nu.vercel.app/api/auth/google/callback`. A future custom domain requires its own exact redirect URI. Avoid ephemeral Vercel preview domains for the shared production client.
4. In Render's backend service **Environment**, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the client. Set NEXT_PUBLIC_SITE_URL to the exact frontend origin, and ADMIN_EMAILS to the owner's approved verified email. Keep secrets only in Render. Do not use NEXT_PUBLIC-prefixed variables for either Google credential or the administrator allowlist.
5. Vercel keeps BACKEND_ORIGIN, BACKEND_PROXY_SECRET and NEXT_PUBLIC_SITE_URL. Its same-origin API proxy sends callbacks to the backend and forwards the cookies and redirect. The browser does not contact the backend origin for sign-in.
6. After staging deployment, connect Google from the profile page. Verify that player ID, rating and history are unchanged. On a separate browser, use the same Google sign-in and verify restoration of that ID. Verify logout-all invalidates both browsers, then sign in again.

If the Google configuration is absent, profile settings explain that recovery is not yet available and the auth endpoint returns 503. Do not treat local fixture tests as a successful live provider test.

Email magic links remain unavailable until an email provider and sender domain are configured. Existing local guests still rely on their current browser cookie until linked. New opaque sessions are revocable; legacy cookies are retained only for migration compatibility and are disabled for a player when that player revokes legacy sessions.

Ranked now requires a verified provider identity and a claimed unique table name. Existing migrated names are preserved; owners claim an available name from profile settings. New verified ranked results advance a separate placement counter, using the existing 12-session boundary. Historical house results do not count toward these placements. Profile settings also offer owner-only data export and explicit closure; closure retains integrity history and historical snapshots and is not a claim of complete legal erasure.
