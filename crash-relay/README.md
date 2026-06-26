# ASCII VJ Crash Relay

Cloudflare Worker intake for production crash reports from ASCII VJ Remix.

The desktop app never contains GitHub credentials. The Worker receives bounded,
sanitized reports, rate-limits requests, aggregates matching fingerprints, and
creates or updates GitHub issues through a GitHub App installation token.

## Setup

Use a Cloudflare API token with Workers deploy access and Workers KV edit access.
The Pool token can list namespaces, but it currently cannot create the crash
relay KV namespaces.

Create dedicated KV namespaces; do not reuse The Pool's generic `RATELIMIT`
namespace:

```bash
wrangler kv namespace create ASCII_VJ_CRASH_RATELIMIT
wrangler kv namespace create ASCII_VJ_CRASH_RATELIMIT --preview
wrangler kv namespace create ASCII_VJ_CRASH_INDEX
wrangler kv namespace create ASCII_VJ_CRASH_INDEX --preview
```

Update the `RATELIMIT` and `CRASH_INDEX` bindings in `wrangler.jsonc` with
those IDs.

The GitHub Actions deploy workflow is manual-only until those KV IDs and the
`crash.dustwave.xyz` custom domain are provisioned.

Set secrets:

```bash
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_INSTALLATION_ID
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in github-app-private-key.pem \
  -out github-app-private-key.pkcs8.pem
wrangler secret put GITHUB_APP_PRIVATE_KEY < github-app-private-key.pkcs8.pem
```

`GITHUB_APP_PRIVATE_KEY` must be PKCS#8. GitHub may download new app keys in
PKCS#1 form, which is why the conversion step is explicit.

Deploy:

```bash
npm install
npm run check
npm run deploy
```

The production endpoint is:

```text
POST https://crash.dustwave.xyz/v1/reports
```

## Aggregation

Reports are not appended indefinitely. The relay keeps one open GitHub issue per
stable fingerprint and rewrites that issue with bounded aggregate state.

The fingerprint uses:

- kind and surface
- OS/architecture platform
- command/backend/source/media/native-output dimensions when present
- `errorCode`, `code`, `statusCode`, `status`, `errorKind`, or `name` when present
- normalized top stack frame when no stable error code exists
- normalized message only as the final fallback

That means reports with the same platform and stable error code aggregate even
when the exact message or stack line changes. Reports with different stable
error codes create separate issues.
