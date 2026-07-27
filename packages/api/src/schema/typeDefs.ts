import { gql } from 'apollo-server-express';

export const typeDefs = gql`
  scalar DateTime
  scalar JSON

  # ── Pagination ─────────────────────────────────────────────────────────────
  #
  # GraphQL SDL does not support generics, so we define concrete Connection /
  # Edge types for each entity that needs cursor-based pagination.
  # All Connection types share the same PageInfo shape.

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  # ── Core Stellar types ─────────────────────────────────────────────────────

  type Asset {
    assetType: String!
    assetCode: String
    assetIssuer: String
    native: Boolean
  }

  type Ledger {
    id: String!
    sequence: Int!
    successfulTransactionCount: Int!
    failedTransactionCount: Int!
    operationCount: Int!
    txSetOperationCount: Int!
    closedAt: DateTime!
    totalCoins: String!
    feePool: String!
    baseFeeInStroops: Int!
    baseReserveInStroops: Int!
    maxTxSetSize: Int!
    protocolVersion: Int!
    headerXdr: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Transaction {
    id: String!
    pagingToken: String!
    successful: Boolean!
    hash: String!
    ledger: Int!
    createdAt: DateTime!
    sourceAccount: String!
    sourceAccountSequence: String!
    feeAccount: String
    feeCharged: Int!
    maxFee: Int!
    operationCount: Int!
    envelopeXdr: String!
    resultXdr: String!
    resultMetaXdr: String!
    feeMetaXdr: String!
    memoType: String
    memo: String
    signatures: [String!]!
    validAfter: DateTime
    validBefore: DateTime
    feeBumpTransaction: Boolean
    innerTransaction: Transaction
    operations: [Operation!]!
    updatedAt: DateTime!
  }

  type Operation {
    id: String!
    pagingToken: String!
    transactionHash: String!
    transactionSuccessful: Boolean!
    type: String!
    createdAt: DateTime!
    sourceAccount: String!
    transaction: Transaction!
    ledger: Int!
    operationIndex: Int!
    details: JSON!
    updatedAt: DateTime!
  }

  type Account {
    accountId: String!
    balance: String!
    assetType: String!
    assetCode: String
    assetIssuer: String
    buyingLiabilities: String!
    sellingLiabilities: String!
    lastModifiedLedger: Int!
    isAuthorized: Boolean!
    isAuthorizedToMaintainLiabilities: Boolean!
    isClawbackEnabled: Boolean!
    sequenceNumber: String!
    numSubentries: Int!
    thresholds: JSON!
    flags: JSON!
    signers: JSON!
    data: JSON!
    sponsor: String
    numSponsored: Int!
    numSponsoring: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  # ── Concrete Connection / Edge types ───────────────────────────────────────

  type LedgerEdge {
    cursor: String!
    node: Ledger!
  }

  type LedgerConnection {
    edges: [LedgerEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type TransactionEdge {
    cursor: String!
    node: Transaction!
  }

  type TransactionConnection {
    edges: [TransactionEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type OperationEdge {
    cursor: String!
    node: Operation!
  }

  type OperationConnection {
    edges: [OperationEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type AccountEdge {
    cursor: String!
    node: Account!
  }

  type AccountConnection {
    edges: [AccountEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type AssetEdge {
    cursor: String!
    node: Asset!
  }

  type AssetConnection {
    edges: [AssetEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type AssetMetricsEdge {
    cursor: String!
    node: AssetMetrics!
  }

  type AssetMetricsConnection {
    edges: [AssetMetricsEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type AccountMetricsEdge {
    cursor: String!
    node: AccountMetrics!
  }

  type AccountMetricsConnection {
    edges: [AccountMetricsEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  # ── Analytics types ────────────────────────────────────────────────────────

  type NetworkMetrics {
    timestamp: DateTime!
    ledgerCount: Int!
    transactionCount: Int!
    operationCount: Int!
    activeAccounts: Int!
    totalVolume: String!
    averageFee: Float!
    successRate: Float!
  }

  type AssetMetrics {
    asset: Asset!
    volume24h: String!
    volume7d: String!
    volume30d: String!
    trades24h: Int!
    trades7d: Int!
    trades30d: Int!
    priceChange24h: Float!
    marketCap: String
    holders: Int!
  }

  type AccountMetrics {
    accountId: String!
    balanceNative: String!
    totalBalanceUsd: String!
    transactionCount24h: Int!
    transactionCount7d: Int!
    transactionCount30d: Int!
    firstTransaction: DateTime
    lastTransaction: DateTime!
    isActive: Boolean!
    trustlines: Int!
    signers: Int!
  }

  # ── Filter / pagination inputs ─────────────────────────────────────────────

  """
  Relay-style cursor pagination input.
  Use \`first\` + \`after\` for forward pagination,
  or \`last\` + \`before\` for backward pagination.
  """
  input PaginationInput {
    first: Int
    after: String
    last: Int
    before: String
  }

  input TimeRangeInput {
    startTime: DateTime
    endTime: DateTime
  }

  input AssetFilterInput {
    assetType: String
    assetCode: String
    assetIssuer: String
  }

  input AccountFilterInput {
    accountId: String
    minBalance: String
    maxBalance: String
    isActive: Boolean
  }

  input TransactionFilterInput {
    successful: Boolean
    minFee: Int
    maxFee: Int
    hasMemo: Boolean
    memoType: String
  }

  input OperationFilterInput {
    type: String
    successful: Boolean
    sourceAccount: String
  }

  # ── Queries ────────────────────────────────────────────────────────────────

  type Query {
    # Ledger queries — cursor-based pagination via LedgerConnection
    ledgers(pagination: PaginationInput, timeRange: TimeRangeInput): LedgerConnection!

    ledger(sequence: Int!): Ledger

    # Transaction queries — cursor-based pagination via TransactionConnection
    transactions(
      pagination: PaginationInput
      timeRange: TimeRangeInput
      filter: TransactionFilterInput
    ): TransactionConnection!

    transaction(hash: String!): Transaction

    # Operation queries — cursor-based pagination via OperationConnection
    operations(
      pagination: PaginationInput
      timeRange: TimeRangeInput
      filter: OperationFilterInput
    ): OperationConnection!

    operation(id: String!): Operation

    # Account queries — cursor-based pagination via AccountConnection
    accounts(pagination: PaginationInput, filter: AccountFilterInput): AccountConnection!

    account(accountId: String!): Account

    # Asset queries — cursor-based pagination via AssetConnection
    assets(pagination: PaginationInput, filter: AssetFilterInput): AssetConnection!

    asset(assetType: String!, assetCode: String, assetIssuer: String): Asset

    # Analytics queries
    networkMetrics(timeRange: TimeRangeInput): [NetworkMetrics!]!

    assetMetrics(
      pagination: PaginationInput
      filter: AssetFilterInput
      timeRange: TimeRangeInput
    ): AssetMetricsConnection!

    accountMetrics(
      pagination: PaginationInput
      accountId: String!
      timeRange: TimeRangeInput
    ): AccountMetricsConnection!

    # Aggregated network statistics
    stats: NetworkStats!
  }

  type NetworkStats {
    totalLedgers: Int!
    totalTransactions: Int!
    totalOperations: Int!
    totalAccounts: Int!
    totalAssets: Int!
    activeAccounts24h: Int!
    activeAccounts7d: Int!
    activeAccounts30d: Int!
    volume24h: String!
    volume7d: String!
    volume30d: String!
    averageFee24h: Float!
    successRate24h: Float!
    latestLedger: Int!
    latestLedgerTime: DateTime!
  }

  # ── Auth types ─────────────────────────────────────────────────────────────

  type User {
    id: ID!
    email: String!
    name: String!
    role: String!
    createdAt: DateTime!
  }

  type AuthPayload {
    user: User!
    token: String!
  }

  type ApiKeyPayload {
    apiKey: String!
    user: User!
  }

  input RegisterInput {
    email: String!
    password: String!
    name: String!
  }

  input LoginInput {
    email: String!
    password: String!
  }

  # ── Mutations ──────────────────────────────────────────────────────────────

  type Mutation {
    register(input: RegisterInput!): AuthPayload!
    login(input: LoginInput!): AuthPayload!
    generateApiKey: ApiKeyPayload!
    revokeApiKey: Boolean!
  }

  # ── Subscriptions ──────────────────────────────────────────────────────────

  type Subscription {
    ledgerAdded: Ledger!
    transactionAdded: Transaction!
    operationAdded: Operation!
    networkMetricsUpdated: NetworkMetrics!

    # Filtered subscriptions
    transactionsForAccount(accountId: String!): Transaction!
    operationsForAccount(accountId: String!): Operation!
    operationsForType(type: String!): Operation!
  }
`;
