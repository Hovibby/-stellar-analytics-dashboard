# API Versioning Strategy

This document covers versioning of the **API contract** (GraphQL schema + REST
endpoints served by `packages/api`). For versioning of the npm packages
themselves (release process, semver, changelogs), see
[`docs/versioning.md`](./versioning.md) — the two are related but distinct:
a package release (e.g. `1.4.0`) can ship several backwards-compatible API
additions without the API contract version changing at all.

## Goals

Let the API evolve — new fields, new queries, new REST routes — without
breaking existing clients (the frontend dashboard, third-party API-key
consumers, and anything built against the public schema).

## How to find the current API version

```
GET /version
→ { "apiVersion": "v1", "release": "1.0.0" }
```

Every response also carries:

```
X-API-Version: v1
X-API-Release: 1.0.0
```

`apiVersion`/`X-API-Version` is the **contract version** (see below).
`release`/`X-API-Release` is the package version from `packages/api/package.json`
(follows [`docs/versioning.md`](./versioning.md)'s semver rules).

## GraphQL: additive evolution is the default

GraphQL schemas are designed to evolve without a version number in the common
case. The rules:

1. **Adding** a new field, query, mutation, type, or enum value is always
   backwards compatible — do it freely, no version bump needed.
2. **Never remove or rename** a field/argument that's shipped. Instead:
   - Mark it `@deprecated(reason: "use X instead")`.
   - Keep it functional for at least one full release cycle (see
     [`docs/versioning.md`](./versioning.md)'s deprecation timelines) before
     it's actually dropped.
3. **Never change a field's type or nullability** in a way existing queries
   could break (e.g. `String` → `Int`, or `String` → `String!`). Add a new
   field instead (`feeCharged` stays as-is; add `feeChargedV2` if the
   representation must change) and deprecate the old one per rule 2.
4. **Changing resolver behavior** in a way that changes the *meaning* of
   existing data (not just its shape) is a breaking change even though the
   schema text may not change — treat it the same as a field removal:
   deprecate the old behavior via a new field/argument, don't silently swap
   semantics under clients' feet.

This covers the overwhelming majority of API evolution and is why there is no
`/graphql/v2` today.

## REST endpoints

Health/metrics/version endpoints (`/health`, `/health/live`, `/health/ready`,
`/metrics`, `/metrics/queries`, `/version`) are operational endpoints, not
part of the analytics data contract — they can gain new fields freely under
the same additive-only rule as GraphQL. Removing or repurposing a field they
already return is a breaking change under the same rules as above.

## The escape hatch: when a break is unavoidable

If a genuinely breaking change is required (rare — most needs are covered by
rule 1 above):

1. Bump `API_CONTRACT_VERSION` in `packages/api/src/index.ts` (e.g. `v1` →
   `v2`) and mount the new schema at `/graphql/v2` **alongside** the existing
   `/graphql` (which keeps serving `v1` unchanged).
2. Document the breaking change and migration path in the package
   `CHANGELOG.md` per [`docs/versioning.md`](./versioning.md) (this is a
   MAJOR release).
3. Give existing clients a deprecation window on `/graphql` (`v1`) before it
   is ever removed — announce the sunset date, don't remove without notice.
4. The admin endpoint (`/admin/graphql`, see
   [`docs/admin-graphql.md`](./admin-graphql.md)) is intentionally
   independent of this — it has its own consumers (internal tooling) and can
   version on its own schedule without affecting the public contract.

## Client guidance

- Request only the fields you need — don't rely on "the whole object shape"
  staying pixel-identical; GraphQL clients that select fields explicitly are
  immune to additive changes by construction.
- Watch for `@deprecated` fields in introspection/docs and migrate off them
  before their removal window closes.
- Pin to `X-API-Version` if you need to detect a future `v2` rollout
  programmatically.
