# Watcha OAuth2 login

Source: the supplied `watcha_oauth2接入文档.md`. Implements confidential-client authorization code flow with S256 PKCE and only the `read` scope.

Register OpenWorldCraft with Watcha's operators:

- Application: `OpenWorldCraft`
- Domain: `https://openworldcraft.com`
- Callback: `https://openworldcraft.com/auth/watcha/callback`
- Scope: `read`
- Public client: `false`

Set `WATCHA_CLIENT_ID` and `WATCHA_CLIENT_SECRET` in the deployment environment. For local testing, register the local origin and callback separately and set `PUBLIC_URL` accordingly. Do not commit credentials or use the shared example credentials in production.

`/auth/login` offers configured providers; `/api/session` reports `watchaReady`, `githubReady`, and `loginReady`. Missing Watcha credentials hide the option. Existing GitHub administrator configuration remains required in production. CLI browser authorization uses the same provider chooser; GitHub token login remains GitHub-only.

Watcha identities are stored as `watcha:<user_id>`. Existing GitHub IDs are unchanged. Accounts are not automatically linked by nickname or email: existing plots, credits and models remain on their original account. Basic profile nicknames are used for display; email, phone, remote avatars and refresh tokens are not stored.

State is browser-bound, ten-minute, provider-separated and consumed once. The return destination is stored server-side and limited to the game, admin or validated CLI request. Tokens are exchanged server-side and sent only in the userinfo Authorization header. Sessions use the existing expiry, CSRF and logout mechanisms.

Verification: `node --test test/watcha-auth.test.mjs test/cli-oauth.test.mjs test/oauth.test.mjs`. Provider responses in the Watcha test are mocked; a real authorization round trip requires issued credentials and a registered callback.
