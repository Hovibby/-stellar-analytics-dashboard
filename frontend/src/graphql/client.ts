/**
 * Apollo Client configuration (issue #49)
 *
 * Sets up:
 * - HTTP link pointing at the GraphQL API
 * - Error link for logging GraphQL / network errors
 * - Retry link with exponential back-off for transient failures
 * - InMemoryCache with sensible merge policies
 */
import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  split,
  from,
} from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";
import { onError } from "@apollo/client/link/error";
import { RetryLink } from "@apollo/client/link/retry";

// ── HTTP link ─────────────────────────────────────────────────────────────────
// In development the API runs on :4000; in production it is expected to be
// served from the same origin under /graphql.
const graphqlUrl =
  typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_GRAPHQL_URL
    ? (import.meta as any).env.VITE_GRAPHQL_URL
    : "http://localhost:4000/graphql";

const httpLink = createHttpLink({ uri: graphqlUrl });

// ── WebSocket link (Issue #210) ───────────────────────────────────────────────
// Real-time subscriptions (ledgerAdded, ...) over graphql-ws, backed by
// Postgres LISTEN/NOTIFY on the API side (see api/src/pg-listener.ts).
const wsLink = new GraphQLWsLink(
  createClient({
    url: graphqlUrl.replace(/^http/, "ws"),
  })
);

// Route subscription operations over the WebSocket link, everything else
// (queries/mutations) over HTTP.
const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === "OperationDefinition" &&
      definition.operation === "subscription"
    );
  },
  wsLink,
  httpLink
);

// ── Error link ────────────────────────────────────────────────────────────────
const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, locations, path }) => {
      console.warn(
        `[GraphQL error] op=${operation.operationName} path=${path ? String(path) : 'N/A'} msg=${message}`,
        locations
      );
    });
  }
  if (networkError) {
    console.warn(
      `[Network error] op=${operation.operationName}:`,
      networkError
    );
  }
});

// ── Retry link ────────────────────────────────────────────────────────────────
// Retries up to 3 times with exponential back-off (1s, 2s, 4s).
// Only retries on network errors, not on GraphQL errors.
const retryLink = new RetryLink({
  delay: {
    initial: 1000,
    max: 8000,
    jitter: true,
  },
  attempts: {
    max: 3,
    retryIf: (error) => !!error,
  },
});

// ── Cache ─────────────────────────────────────────────────────────────────────
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        // Prepend new ledgers (highest sequence first)
        ledgers: {
          keyArgs: ["timeRange", "pagination"],
          merge(
            existing = { edges: [], pageInfo: {}, totalCount: 0 },
            incoming: any
          ) {
            const existingCursors = new Set(
              (existing.edges ?? []).map((e: any) => e.cursor)
            );
            const newEdges = (incoming.edges ?? []).filter(
              (e: any) => !existingCursors.has(e.cursor)
            );
            return {
              ...incoming,
              edges: [...newEdges, ...(existing.edges ?? [])],
            };
          },
        },
        // Prepend new transactions
        transactions: {
          keyArgs: ["filter", "timeRange", "pagination"],
          merge(
            existing = { edges: [], pageInfo: {}, totalCount: 0 },
            incoming: any
          ) {
            const existingCursors = new Set(
              (existing.edges ?? []).map((e: any) => e.cursor)
            );
            const newEdges = (incoming.edges ?? []).filter(
              (e: any) => !existingCursors.has(e.cursor)
            );
            return {
              ...incoming,
              edges: [...newEdges, ...(existing.edges ?? [])],
            };
          },
        },
        // Prepend new operations
        operations: {
          keyArgs: ["type", "filter", "pagination"],
          merge(
            existing = { edges: [], pageInfo: {}, totalCount: 0 },
            incoming: any
          ) {
            const existingCursors = new Set(
              (existing.edges ?? []).map((e: any) => e.cursor)
            );
            const newEdges = (incoming.edges ?? []).filter(
              (e: any) => !existingCursors.has(e.cursor)
            );
            return {
              ...incoming,
              edges: [...newEdges, ...(existing.edges ?? [])],
            };
          },
        },
      },
    },
  },
});

// ── Client ────────────────────────────────────────────────────────────────────
export const apolloClient = new ApolloClient({
  link: from([errorLink, retryLink, splitLink]),
  cache,
  defaultOptions: {
    watchQuery: {
      errorPolicy: "all",
      notifyOnNetworkStatusChange: true,
    },
    query: {
      errorPolicy: "all",
    },
  },
});
