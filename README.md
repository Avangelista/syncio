<div align="center">

<img src="./client/public/logo-white.png" width="144"/>
<h1>Syncio (Fork)</h1>

*Multi-provider addon and user management for Stremio & Nuvio*

Fork of [iamneur0/syncio](https://github.com/iamneur0/syncio) — see [README.upstream.md](README.upstream.md) for the original documentation.

</div>

---

## What's Changed

This fork adds **Nuvio** as a second provider alongside Stremio, along with security hardening, bug fixes, and cross-platform dev improvements. The core Syncio functionality (groups, addons, sync engine) is unchanged — a provider abstraction layer routes operations to either Stremio or Nuvio based on each user's `providerType`.

## Nuvio Provider Integration

The main feature. Users can now be connected via Nuvio (Supabase-backed) instead of Stremio.

### Provider Abstraction

A factory function `createProvider(user, deps)` returns a uniform interface regardless of provider:

```
getAddons()          setAddons(addons)       addAddon(url, manifest)    clearAddons()
getLibrary()         addLibraryItem(...)     removeLibraryItem(...)
getLikeStatus(...)   setLikeStatus(...)
```

Stremio provider wraps `StremioAPIClient`. Nuvio provider uses Supabase REST. The sync engine, addon management, and all route handlers work identically with either.

### Authentication

Two auth flows for Nuvio:

- **OAuth device-code flow** — user scans a QR code / visits a URL on another device, polls for approval. Used in the login page and invite flow.
- **Email + password** — direct credential validation against Supabase auth. Used in the user add modal.

Auth is module-level (not on the provider instance) — `nuvioAuth.js` handles validate, token refresh, and the TV login flow.

### Token Management

- Nuvio refresh tokens are encrypted at rest (same as Stremio auth keys)
- Access tokens auto-refresh on expiry with a 60-second buffer
- New refresh tokens are persisted back to the database automatically via `onTokenRefresh` callback

### Multi-Provider Support

- Same email can exist as both a Stremio and Nuvio user (on Postgres, unique constraint is now `accountId + email + providerType`)
- User uniqueness checks are scoped by provider to prevent cross-provider conflicts
- Fingerprint comparison uses URL-only mode for Nuvio users (Syncio controls the URL set)

### New Files

```
server/providers/
  index.js          # Factory: createProvider(user, deps)
  stremio.js        # Wraps StremioAPIClient
  nuvio.js          # Supabase REST calls
  supabase.js       # Low-level PostgREST HTTP helper
  stremioAuth.js    # Re-exports existing Stremio auth
  nuvioAuth.js      # Validate, refresh, TV login flow

server/routes/nuvio.js   # /api/nuvio/* endpoints
```

## Security Hardening

- **OAuth session rate limiting** — max 3 pending OAuth sessions per IP, auto-expiring after 5 minutes
- **Tightened error responses** — error messages no longer leak internal details; only `error.message` is logged server-side
- **PROVIDER_AUTH_EXPIRED** — graceful handling when provider tokens expire (returns 401 instead of 500)
- **Provider-scoped validation** — user checks include `providerType` to prevent cross-provider conflicts
- **Removed debug logging** — stripped `console.log` statements from auth flows and provider operations

## UI Changes

- **Provider selection** in user add/edit modals — toggle between Stremio and Nuvio with auth state reset on switch
- **NuvioOAuthCard** — device-code flow component with QR code, polling, auto-retry on expiry
- **NuvioLoginCard** — email/password form with validation state tracking
- **Provider badges** on user cards showing Stremio or Nuvio
- **Genericized strings** — "Stremio account" → "account", "Wrong Stremio Account" → "Wrong Account", etc.
- **Email mismatch handling** in invite flow — specific error state instead of generic toast
- **Cache invalidation** — addon query caches are invalidated after sync operations

## Schema Changes

Three new fields on the `User` model:

```prisma
providerType       String   @default("stremio")  // "stremio" | "nuvio"
nuvioRefreshToken  String?                        // Encrypted Supabase refresh token
nuvioUserId        String?                        // Supabase user UUID
```

Updated unique constraint (Postgres only): `@@unique([accountId, email, providerType])` — allows the same email across different providers.

### Upgrading

**Docker users:** The container runs migrations automatically on startup. Just pull the new image and restart.

**Local dev users:** Run the migration manually after pulling:

```bash
# PostgreSQL
cross-env DATABASE_URL=postgresql://syncio:syncio@localhost:5432/syncio npx prisma db push --schema prisma/schema.postgres.prisma

# SQLite
cross-env DATABASE_URL=file:./prisma/sqlite.db npx prisma db push --schema prisma/schema.sqlite.prisma
```

## Setup Changes

### Dependency Changes

- Added `cross-env` and `shx` — cross-platform env variable setting and shell commands (Windows compatibility)
- npm scripts updated to use `shx cp` and `cross-env` instead of Unix-specific `cp` and bare env vars

## Other Changes

- Simplified `metricsBuilder.js` and `activityMonitor.js` provider handling
- Bug fixes in invite flow (email mismatch, renewal page)
- `RequestRenewedPage` component for renewed invite handling
- Nuvio connect endpoint now sets `isActive: true` on the user
- Username generation capped at 100 attempts to prevent infinite loops
- Removed legacy test scripts (custom test suites replaced upstream)
