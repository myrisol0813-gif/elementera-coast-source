# P5 MCP Porch: single-owner Auth0 contract

This document is a configuration contract, not a credential file. Never place a real tenant value, subject, email, client secret, access token, or Cloudflare value in Git or chat.

## Security shape

- Cloudflare Pages is the OAuth resource server and exposes the stable Streamable HTTP endpoint at `/mcp`.
- The Pages Functions implementation uses Web Crypto and native JSON-RPC only, so the existing project can keep its empty build command and does not depend on an npm install step.
- Auth0 is the authorization server. It signs RS256 access tokens and publishes JWKS.
- ChatGPT is an OAuth public client using authorization code + PKCE, or a predefined client configured in the ChatGPT plugin connection.
- Coast web login remains separate. The Coast password and `__Host-coast_session` cookie are never accepted as MCP credentials.
- Every MCP tool call validates signature, issuer, audience, expiry, subject, verified email, and the tool's exact scope.
- `initialize`, `tools/list`, `/mcp/manifest`, `/mcp/health`, and protected-resource metadata are public discovery only. They return no private Coast content.

## Auth0 tenant

1. Create or select a dedicated Auth0 tenant for the private Coast.
2. In the enabled database connection, turn on **Disable Sign Ups**.
3. Disable every social or enterprise connection that is not intentionally used by Human Owner.
4. Create the allowed user manually in Auth0, or add the user through an invitation-only Auth0 Organization. Do not enable public self-service membership.
5. Keep the allowed Auth0 `sub` and verified email in Cloudflare dashboard configuration only.
6. Enable MFA for the owner account if the chosen Auth0 plan and login flow support it.

## Auth0 API and scopes

Create one Auth0 API whose identifier exactly matches the MCP audience configured for Coast. Use RS256.

Create only these API permissions:

- `read:coast`
- `write:soil`
- `write:radio`
- `write:lighthouse`

Grant all four permissions only to Human Owner's invited user or private owner role. Do not create maintenance, deletion, publishing, album, or summary-run permissions in this phase.

The ChatGPT OAuth connection requests scopes from each tool descriptor. Auth0 must return the granted values in the standard space-delimited `scope` claim.

## Verified email claims

Auth0 API access tokens do not always contain email by default. Add an Auth0 Post Login Action scoped to this Coast application/API that places the verified owner identity in namespaced access-token claims:

```js
exports.onExecutePostLogin = async (event, api) => {
  api.accessToken.setCustomClaim(
    "https://elementeracoast.com/email",
    event.user.email
  );
  api.accessToken.setCustomClaim(
    "https://elementeracoast.com/email_verified",
    event.user.email_verified === true
  );
};
```

The Coast resource server rejects the token unless both the namespaced email and a literal `true` verified-email claim are present and allowlisted.

## Auth0 application

1. Create a dedicated application for the ChatGPT Coast connection; do not reuse the Coast website login.
2. Use authorization code + PKCE.
3. Add only the exact ChatGPT callback URL displayed by the plugin connection screen.
4. Keep public registration disabled at the database connection and Organization layers.
5. Configure the application credentials in the ChatGPT plugin connection UI. Do not commit or paste them into Coast source.
6. After the public `/mcp` endpoint is deployed, connect it in ChatGPT developer mode and refresh its discovered metadata.

## Cloudflare dashboard contract

The resource server reads these configuration names. Their real values belong only in the Cloudflare Pages project dashboard:

- `COAST_MCP_AUTH0_ISSUER`
- `COAST_MCP_AUTH0_AUDIENCE`
- `COAST_MCP_ALLOWED_SUBJECTS`
- `COAST_MCP_ALLOWED_EMAILS`
- `COAST_MCP_EMAIL_CLAIM` (optional when using the documented claim)
- `COAST_MCP_EMAIL_VERIFIED_CLAIM` (optional when using the documented claim)

These values are not accepted from request bodies. The allowlists are comma-separated only to permit explicit future invitations; a single-owner deployment contains one subject and one email.

## Verification before connecting ChatGPT

1. Confirm `/mcp/health` returns only service/version/transport information.
2. Confirm `/mcp/manifest` publishes the same versioned tool names and complete definitions as `tools/list`.
3. Confirm `tools/list` works without a token and every listed tool advertises an OAuth scope.
4. Confirm a private tool call without a token returns an OAuth challenge.
5. Confirm a token for another subject or email is rejected.
6. Confirm a token missing one write scope cannot call that write tool.
7. Confirm `send_radio_message` writes an `official_mcp` user-side turn into a typed `radio` conversation, preserves submitted model provenance/display author, and Coast API Model Partner replies in that same conversation. Retrying the same `tool_call_id` must not create another turn or model request.
8. Confirm `write_lighthouse_letter` writes an `official_mcp` user-side turn into a typed `lighthouse` conversation without creating an independent Lighthouse Trace, room soil, or forced API reply.
9. Confirm `list_radio_messages` and `list_lighthouse_letters` read the typed conversation store rather than legacy room tables.
10. Confirm `create_daily_moment` and `create_daily_diary` create formal Daily entries directly with MCP provenance; no draft/publish step, album write, or summary tool exists.
11. Confirm retired tools such as `write_official_soil`, `write_lighthouse_room_soil`, Daily draft tools, album tools, and summary tools are absent from discovery.
12. Confirm tool-run logging remains redacted and does not persist private message bodies as execution summaries.
