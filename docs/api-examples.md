# API Examples — Dashboard, Account & Network Analytics

This document provides realistic, ready-to-run GraphQL examples for the three
main families of endpoints exposed by the Stellar Analytics API
(`http://localhost:4000/graphql`):

1. **Dashboard** — the widgets that power the public dashboard (network stats,
   ledger activity, top accounts, asset volumes, daily transaction counts).
2. **Account** — per-account analytics (overview, transaction history,
   operations filtered by type).
3. **Network analytics** — bulk aggregations used by researchers, dashboards
   and back-office tooling.

Every example below lists:

- **What it solves** — a one-line description of the realistic use case.
- **Query** — the GraphQL document, copy-paste ready.
- **Variables** — inline, ready to send.
- **Expected response** — a realistic, *illustrative* JSON response so you
  know what shape to expect.
- **cURL** — a copy-paste shell command that hits a local API.

> All example accounts below are realistic **Stellar public-key addresses**
> in **StrKey / G… form** (`G` followed by exactly 55 base32 characters,
> 56 characters total). They parse correctly through the API and the
> `ed25519` decoder used by the shared `stellar` types, without being
> tied to any real on-chain account. The ledger, transaction and
> operation shapes mirror the values the API returns against a
> fully-populated indexer database.

---

## Conventions

| Item | Convention |
|------|------------|
| HTTP method | `POST` for any request with a body (queries, mutations) |
| Content-Type | `application/json` |
| Endpoint | `POST /graphql` with `{ "query": "...", "variables": { ... } }` |
| Variable names | Match the API arg names: `$limit` / `$cursor` for `ledgers`, `$limit` for `topAccounts`, etc. The `naming-convention` lint rule in [`graphql-query-standards.md`](./graphql-query-standards.md) enforces camelCase |
| Pagination | Cursor-based via `limit` + `cursor` on the `ledgers` connection. Other list queries (`transactions`, `operations`, `topAccounts`, `dailyTransactionCount`) are limit-only today (see §2.2) |
| Limits | Always pass `limit` when fetching list endpoints — defaults are unconstrained on some resolvers and may return thousands of rows |
| Address format | Stellar public key, `G` + 55 base32 chars, 56 chars total — see [`shared/src/config/networks.ts`](../shared/src/config/networks.ts) |

### Required vs optional arguments

The args the API distinguishes today:

| Argument | Required? | Why |
|----------|-----------|-----|
| `ledger(sequence: Int!)` | **Required** | You must point at a single ledger |
| `accountStats(address: String!)` | **Required** | Account-only — no "default" |
| `assetVolume(assetCode: String!, timeframe: String!)` | **Both required** | Must specify what and how-far-back |
| `ledgers(limit, cursor)` | Both optional | Defaults to latest 10 |
| `transactions(address, limit)` | Both optional | Browses global or per-account |
| `operations(type, limit)` | Both optional | Browses all types or one |
| `topAccounts(limit)` | Optional | Defaults to top 10 |
| `dailyTransactionCount(days)` | Optional | Defaults to 7 |
| `networkStats` | n/a | No args |

Practical rule: any `!`-decorated argument in the schema will reject the
query at validation time, so prefer sending them up-front in the client.

---

## 1. Dashboard endpoints

These power the home page of the dashboard: the "live" status panel, the
24h KPI tiles, the daily transaction chart and the leaderboard.

### 1.1 Network KPI tile (`networkStats`)

**What it solves.** Render the four-up KPI tile at the top of the home page
showing the current transactions-per-second, total accounts, last-24h active
accounts and total ledgers ingested.

**Query.**

```graphql
query GetNetworkKpis {
  networkStats {
    tps
    totalAccounts
    activeAccounts24h
    totalLedgers
  }
}
```

**Expected response.**

```json
{
  "data": {
    "networkStats": {
      "tps": 12.42,
      "totalAccounts": 1834502,
      "activeAccounts24h": 84137,
      "totalLedgers": 54120882
    }
  }
}
```

**cURL.**

```bash
curl -s http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"query { networkStats { tps totalAccounts activeAccounts24h totalLedgers } }"}' \
  | jq .
```

> 💡 **Tip.** Call this query on page load and refresh every ~10s — the
> `tps` and `activeAccounts24h` fields change frequently while the totals
> move slowly. Avoid caching.

---

### 1.2 Recent ledgers feed (`ledgers`)

**What it solves.** Populate the "latest ledgers" feed on the dashboard with
cursor-based pagination so the user can scroll back through history without
calling a different endpoint.

**Query.**

```graphql
query GetLedgerFeed($limit: Int, $cursor: String) {
  ledgers(limit: $limit, cursor: $cursor) {
    edges {
      cursor
      node {
        sequence
        hash
        closeTime
        transactionCount
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

> Variable names track the API arg names exactly (`$limit`, `$cursor`) so
> client tooling that auto-generates types stays in sync. The `Get…` naming
> prefix is the lint convention from
> [`graphql-query-standards.md`](./graphql-query-standards.md).

**Variables (first page — no cursor).**

```json
{
  "limit": 20,
  "cursor": null
}
```

**Expected response.**

```json
{
  "data": {
    "ledgers": {
      "edges": [
        {
          "cursor": "NTQxMjA4ODE=",
          "node": {
            "sequence": 54120881,
            "hash": "e7a3c89f0b1d4a26c5e9f7b8a2d14f3c9b6e5a4f8e7d3c2b1a0f9e8d7c6b5a49f",
            "closeTime": "2025-07-26T12:14:09.000Z",
            "transactionCount": 84
          }
        },
        {
          "cursor": "NTQxMjA4ODA=",
          "node": {
            "sequence": 54120880,
            "hash": "4b1ce28ac39d4e7f9a1b3c5d7e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
            "closeTime": "2025-07-26T12:14:02.000Z",
            "transactionCount": 71
          }
        }
      ],
      "pageInfo": {
        "hasNextPage": true,
        "endCursor": "NTQxMjA4NjE="
      }
    }
  }
}
```

The `cursor` returned on each edge is **base64 of the integer
`sequence` as ASCII**: `e.g. base64("54120881") === "NTQxMjA4ODE="`.
Hand `endCursor` back in as the `cursor` variable of your next call to
walk backwards through history.

**cURL.**

```bash
curl -s http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{
    "query": "query GetLedgerFeed($limit: Int, $cursor: String){ ledgers(limit: $limit, cursor: $cursor){ edges { cursor node { sequence hash closeTime transactionCount } } pageInfo { hasNextPage endCursor } } }",
    "variables": { "limit": 20, "cursor": null }
  }' | jq .
```

> 💡 **Tip.** Treat `endCursor` as opaque — don't decode it in the client.
> When `pageInfo.hasNextPage` is `false` you've reached the earliest ledger
> the indexer has stored.

---

### 1.3 Daily transaction chart (`dailyTransactionCount`)

**What it solves.** Render the bar chart on the dashboard showing the
number of transactions per day for the last 30 days.

**Query.**

```graphql
query GetDailyTransactionChart($days: Int) {
  dailyTransactionCount(days: $days) {
    date
    count
  }
}
```

**Variables.**

```json
{
  "days": 30
}
```

**Expected response.**

```json
{
  "data": {
    "dailyTransactionCount": [
      { "date": "2025-07-26", "count": 1045217 },
      { "date": "2025-07-25", "count":  982004 },
      { "date": "2025-07-24", "count":  971562 },
      { "date": "2025-07-23", "count":  885213 }
    ]
  }
}
```

> 💡 **Tip.** The result is ordered newest → oldest. Frontend charts can
> reverse it once before rendering. Keep `days ≤ 90` to stay within
> documented performance limits — see [`graphql-query-limits.md`](./graphql-query-limits.md).

---

### 1.4 Top accounts leaderboard (`topAccounts`)

**What it solves.** Populate the "Top accounts" table on the dashboard.

> ⚠️ **`balance` is a placeholder — please read.**
> The `topAccounts` resolver currently surfaces **transaction count** under
> the `balance` field name because the indexer does not yet store native
> balances. Treat the value as *activity* until native balance ingestion
> ships. Renaming the resolver or adding a separate `activity` field are
> both being evaluated — see [`docs/query-performance.md`](./query-performance.md).

**Query.**

```graphql
query GetTopAccounts($limit: Int) {
  topAccounts(limit: $limit) {
    address
    balance
  }
}
```

**Variables.**

```json
{
  "limit": 10
}
```

**Expected response (illustrative — `balance` shows activity).**

```json
{
  "data": {
    "topAccounts": [
      {
        "address": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "balance": 9821043
      },
      {
        "address": "GB7JKDHY43FLK3EWJQ4H7RYJZPLQXE3JTLL4DCE4T5PDBN3JZBQ6KQSV",
        "balance": 7703412
      }
    ]
  }
}
```

---

### 1.5 Asset volume tile (`assetVolume`)

**What it solves.** Show the rolling volume for a single asset code on the
asset detail page.

**Query.**

```graphql
query GetAssetVolume($assetCode: String!, $timeframe: String!) {
  assetVolume(assetCode: $assetCode, timeframe: $timeframe) {
    assetCode
    volume
    timeframe
  }
}
```

**Variables.**

```json
{
  "assetCode": "USDC",
  "timeframe": "24h"
}
```

**Expected response.**

```json
{
  "data": {
    "assetVolume": {
      "assetCode": "USDC",
      "volume": "184722994102",
      "timeframe": "24h"
    }
  }
}
```

> 💡 **Tip.** `timeframe` is one of `24h`, `7d`, `30d`. Treat anything else
> as `"24h"` on the client and warn — the API currently falls back silently.

---

## 2. Account endpoints

These answer "tell me about *this* Stellar account" questions. All of them
take a Stellar public key (the `G…` 56-char form) as input.

### 2.1 Account overview panel (`accountStats`)

**What it solves.** When the user lands on an account page, show the
header strip: transaction count, total payment volume and last-active
timestamp.

**Query.**

```graphql
query GetAccountOverview($address: String!) {
  accountStats(address: $address) {
    address
    transactionCount
    totalPaymentVolume
    lastActive
  }
}
```

**Variables.**

```json
{
  "address": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

**Expected response.**

```json
{
  "data": {
    "accountStats": {
      "address": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "transactionCount": 4218,
      "totalPaymentVolume": "182010492104",
      "lastActive": "2025-07-26T11:58:42.000Z"
    }
  }
}
```

**cURL.**

```bash
curl -s http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{
    "query": "query GetAccountOverview($address: String!){ accountStats(address: $address){ address transactionCount totalPaymentVolume lastActive } }",
    "variables": { "address": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" }
  }' | jq .
```

---

### 2.2 Account transaction history (`transactions` by `address`)

**What it solves.** Populate the "Transactions" tab on the account detail
page — the most recent first, with their parent ledger sequence so the
dashboard can deep-link back to a ledger.

**Query.**

```graphql
query GetAccountTransactions($address: String!, $limit: Int) {
  transactions(address: $address, limit: $limit) {
    hash
    ledgerSequence
    sourceAccount
    feeCharged
    operations {
      id
      type
      sourceAccount
      createdAt
    }
  }
}
```

**Variables.**

```json
{
  "address": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "limit": 25
}
```

**Expected response.**

```json
{
  "data": {
    "transactions": [
      {
        "hash": "a3f1c9d4e5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        "ledgerSequence": 54120881,
        "sourceAccount": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "feeCharged": "100",
        "operations": [
          {
            "id": "a3f1c9d4e5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2-0",
            "type": "payment",
            "sourceAccount": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            "createdAt": "2025-07-26T12:14:09.870Z"
          }
        ]
      }
    ]
  }
}
```

> ⚠️ **Pagination roadmap.** `transactions` currently supports only
> limit-based pagination. Cursor-based pagination is tracked for parity
> with `ledgers` — see the operations changelog.

---

### 2.3 Operations feed filtered by type (`operations`)

**What it solves.** Filter the "Operations" tab to show only the operations
of a specific kind — e.g. all `payment` operations that involved this
account or all `createAccount` operations globally for a date range.

**Query.**

```graphql
query GetOperationsByType($type: String!, $limit: Int) {
  operations(type: $type, limit: $limit) {
    id
    txHash
    type
    sourceAccount
    createdAt
  }
}
```

**Variables.**

```json
{
  "type": "payment",
  "limit": 50
}
```

**Expected response.**

```json
{
  "data": {
    "operations": [
      {
        "id": "a3f1c9d4e5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2-0",
        "txHash": "a3f1c9d4e5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        "type": "payment",
        "sourceAccount": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "createdAt": "2025-07-26T12:14:09.870Z"
      },
      {
        "id": "b7c2d3a4f5e6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2-1",
        "txHash": "b7c2d3a4f5e6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2",
        "type": "payment",
        "sourceAccount": "GB7JKDHY43FLK3EWJQ4H7RYJZPLQXE3JTLL4DCE4T5PDBN3JZBQ6KQSV",
        "createdAt": "2025-07-26T12:13:55.420Z"
      }
    ]
  }
}
```

> 💡 **Tip.** Combine `operations(type: "createAccount")` with the
> `dailyTransactionCount` aggregation to build a "new accounts per day"
> panel. Today you'll need to post-filter in the client; see the roadmap
> note above about extending `dailyTransactionCount` to take an operation
> type.

---

## 3. Network analytics endpoints

These are the bulk aggregations used by analysts, the home dashboard, and
back-office / data-science jobs.

### 3.1 Single ledger detail (`ledger`)

**What it solves.** When a user clicks a row in the ledger feed, deep-link
them to the ledger detail page showing all transactions and operations in
that ledger — fetched in a single round trip via the resolvers' nested
fields and DataLoader batching.

**Query.**

```graphql
query GetLedgerDetail($sequence: Int!) {
  ledger(sequence: $sequence) {
    sequence
    hash
    closeTime
    transactionCount
    transactions {
      hash
      sourceAccount
      feeCharged
      operations {
        id
        type
        sourceAccount
      }
    }
    operations {
      id
      txHash
      type
      sourceAccount
      createdAt
    }
  }
}
```

**Variables.**

```json
{
  "sequence": 54120881
}
```

**Expected response.**

```json
{
  "data": {
    "ledger": {
      "sequence": 54120881,
      "hash": "e7a3c89f0b1d4a26c5e9f7b8a2d14f3c9b6e5a4f8e7d3c2b1a0f9e8d7c6b5a49f",
      "closeTime": "2025-07-26T12:14:09.000Z",
      "transactionCount": 84,
      "transactions": [
        {
          "hash": "a3f1c9d4e5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
          "sourceAccount": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          "feeCharged": "100",
          "operations": [
            {
              "id": "a3f1c9d4e5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2-0",
              "type": "payment",
              "sourceAccount": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
            }
          ]
        }
      ],
      "operations": [
        {
          "id": "a3f1c9d4e5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2-0",
          "txHash": "a3f1c9d4e5b6f7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
          "type": "payment",
          "sourceAccount": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          "createdAt": "2025-07-26T12:14:09.870Z"
        }
      ]
    }
  }
}
```

> 💡 **Performance.** Nested selections here are batched by the
> `operationsByTxHash` and `transactionsByLedgerSeq` DataLoaders — the
> shape above results in 3 SQL queries, not N+1. See
> [`docs/query-performance.md`](./query-performance.md) for the full
> batching story.

---

### 3.2 Cross-asset volume sweep (`assetVolume` x N)

**What it solves.** Render a leaderboard of asset volumes for the last
week. Combine multiple `assetVolume` requests into a single document to
share one round trip, since each query is small and independent.

**Query.**

```graphql
query GetAssetVolumeBoard {
  usdc24h: assetVolume(assetCode: "USDC", timeframe: "24h") {
    assetCode
    volume
    timeframe
  }
  usdc7d:  assetVolume(assetCode: "USDC", timeframe: "7d")  {
    assetCode
    volume
    timeframe
  }
  xlm7d:   assetVolume(assetCode: "XLM",  timeframe: "7d")  {
    assetCode
    volume
    timeframe
  }
  btc7d:   assetVolume(assetCode: "BTC",  timeframe: "7d")  {
    assetCode
    volume
    timeframe
  }
}
```

> Note: the aliases `usdc24h:`, `usdc7d:`, etc. are GraphQL aliases that
> keep each result distinct under `data` despite the same field name.

**Expected response.**

```json
{
  "data": {
    "usdc24h": { "assetCode": "USDC", "volume": "184722994102", "timeframe": "24h" },
    "usdc7d":  { "assetCode": "USDC", "volume": "1035210884723", "timeframe": "7d" },
    "xlm7d":   { "assetCode": "XLM",  "volume":  "9852310044",   "timeframe": "7d" },
    "btc7d":   { "assetCode": "BTC",  "volume":    "41250321",   "timeframe": "7d" }
  }
}
```

---

## 4. Putting it all together — the dashboard hero query

The dashboard hero panel renders a network KPI tile, a 5-row snapshot of
the latest *ledger feed*, and a 7-day chart. All three can be merged into
a single GraphQL document with aliased fields to avoid three HTTP round
trips on every page load.

**Query.**

```graphql
query GetDashboardHero($limit: Int, $days: Int) {
  stats: networkStats {
    tps
    totalAccounts
    activeAccounts24h
    totalLedgers
  }
  recent: ledgers(limit: $limit) {
    edges {
      cursor
      node {
        sequence
        closeTime
        transactionCount
      }
    }
  }
  chart: dailyTransactionCount(days: $days) {
    date
    count
  }
}
```

**Variables.**

```json
{
  "limit": 5,
  "days": 7
}
```

**Expected response (shape only).**

```json
{
  "data": {
    "stats": {
      "tps": 12.42,
      "totalAccounts": 1834502,
      "activeAccounts24h": 84137,
      "totalLedgers": 54120882
    },
    "recent": {
      "edges": [
        { "cursor": "NTQxMjA4ODE=", "node": { "sequence": 54120881, "closeTime": "2025-07-26T12:14:09.000Z", "transactionCount": 84 } }
      ]
    },
    "chart": [
      { "date": "2025-07-26", "count": 1045217 },
      { "date": "2025-07-25", "count":  982004 }
    ]
  }
}
```

> The hero query sits at **depth 3** — well under the **depth-10 limit**.
> See §5.2 below for the kind of query that *does* hit the limit.

---

## 5. Error handling — what the API returns

All of the queries above can fail. The standard GraphQL error envelope is
returned alongside the `data` field. Common cases:

| Cause | `extensions.code` | Client behaviour |
|-------|------------------|------------------|
| Query rejected by depth/complexity limit | `GRAPHQL_VALIDATION_FAILED` | Refuse and retry with a slimmer query — see [`graphql-query-limits.md`](./graphql-query-limits.md) |
| Database unavailable | `INTERNAL_SERVER_ERROR` | Show a graceful banner; do not retry immediately |
| Account has no transactions yet | *(no error, returns `transactionCount: 0` and `totalPaymentVolume: "0"`)* | Render the empty state |
| `sequence` / `address` malformed | `GRAPHQL_VALIDATION_FAILED` | Client-side validation should catch this first |
| Rate-limited (HTTP 429 outside of GraphQL envelope) | `Too many requests…` | Back off per IP — see [`docs/cors.md`](./cors.md) |

### 5.1 Example error envelope

```json
{
  "errors": [
    {
      "message": "'GetLedgerDetail' exceeds maximum operation depth of 10",
      "extensions": { "code": "GRAPHQL_VALIDATION_FAILED" }
    }
  ],
  "data": null
}
```

### 5.2 What depth actually means — and why the limit is rarely triggered

`graphql-depth-limit` counts the **longest path of nested object
selections**, not the number of opening braces in the query string.
Scalars (e.g. `Int`, `String`) and aliases on the same level do not add
depth. With the current schema the deepest *realistic* path is

```
ledger              (depth 1)
  → transactions    (depth 2)
    → operations    (depth 3)
```

— three selection-sets deep — so the depth-10 limit is essentially
unreachable in practice against valid queries. **The realistic lever
against wide attacks is query complexity** (`graphql-query-complexity`)
rather than depth; see [`graphql-query-limits.md`](./graphql-query-limits.md).

> **Implementation status.** The depth-limit rule is not currently wired
> into the deployed API server (`api/src/index.ts` does not apply
> `validationRules`, and `graphql-depth-limit` is not in
> `api/package.json`). The depth value configured in
> [`graphql-query-limits.md`](./graphql-query-limits.md) is aspirational
> — a follow-up issue should land the rule in `validationRules`. The
> `GRAPHQL_VALIDATION_FAILED` envelope below is the documented shape
> the rule will emit once wired:

```json
{
  "errors": [
    {
      "message": "'GetLedgerDetail' exceeds maximum operation depth of 10",
      "extensions": { "code": "GRAPHQL_VALIDATION_FAILED" }
    }
  ],
  "data": null
}
```

### 5.3 A fan-out antipattern worth avoiding

Even though the *depth* limit is hard to hit on this schema, the same
query can still exhaust the database by fanning out. The following
"God query" selects large lists in a single round trip and triggers
expensive joins via the nested resolvers:

```graphql
query GetEverything {
  stats:   networkStats                                   { tps totalAccounts activeAccounts24h totalLedgers }
  leaders: topAccounts(limit: 100)                        { address balance }   # one COUNT GROUP BY over transactions
  recent:  ledgers(limit: 100) {
    edges {
      cursor
      node {
        sequence
        transactionCount
        transactions                                       # joins via transactionsByLedgerSeq loader
        operations                                         # joins via operationsByLedgerSeq loader
      }
    }
  }
  chart:   dailyTransactionCount(days: 90)                { date count }
}
```

This passes *depth-limit* (max path depth here is 4) and *passes the
naming/standards linter*, but it is expensive enough to need explicit
deferral — under load it can hold DB workers for hundreds of ms to
several seconds depending on database state and concurrency. Practical
lesson: **fetch progressively**

1. Hero query first (§4) for the page load;
2. Ledger feed on demand (§1.2);
3. Single ledger detail on click (§3.1).

The DataLoaders in `api/src/loaders.ts` only really save you on
*intra-ledger* fetches — they do not protect the indexer from
unbounded list sizes. See
[`docs/query-performance.md`](./query-performance.md) for the full
batching story.

---

## 6. Sandbox exploration

A throwaway playground is served at `GET /graphql` when
`NODE_ENV !== "production"` — it ships a single example query and a
run button. Useful for smoke-testing the examples above.

> Browsers do not accept the `POST /graphql` request from `GET /graphql`
> directly when the GraphQL request body is large; prefer the cURL
> examples above for scripted testing.

---

## 7. Related docs

- [`graphql-query-standards.md`](./graphql-query-standards.md) — naming
  rules and lint configuration enforced on every query document.
- [`graphql-query-limits.md`](./graphql-query-limits.md) — depth and cost
  limits applied at the API layer.
- [`query-performance.md`](./query-performance.md) — DataLoader batching,
  slow-query monitoring and index maintenance.
- [`error-handling-and-logging.md`](./error-handling-and-logging.md) —
  standardized error shapes and log fields used across the API.
- [`api/src/schema.ts`](../api/src/schema.ts) — the canonical GraphQL
  schema source-of-truth.
- [`api/src/resolvers/index.ts`](../api/src/resolvers/index.ts) — the
  resolver implementations backing each of the queries above.
