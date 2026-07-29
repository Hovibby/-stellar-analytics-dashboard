import { UserInputError } from 'apollo-server-express';
import { Connection, Edge, PageInfo, PaginationArgs } from '@stellar-analytics/shared';

// Base64 encode/decode functions for cursor
const toCursor = (str: string) => Buffer.from(str).toString('base64');
const fromCursor = (str: string) => Buffer.from(str, 'base64').toString('ascii');

/**
 * Creates a Relay-style cursor-paginated connection from a dataset.
 *
 * @param data The full dataset to paginate.
 * @param args The pagination arguments (first, after, last, before).
 * @param getCursor A function that returns a unique cursor for each item in the dataset.
 * @returns A paginated connection object.
 */
export function createConnection<T>(
  data: T[],
  args: PaginationArgs,
  getCursor: (item: T) => string
): Connection<T> {
  const { first, after, last, before } = args;

  if (first && last) {
    throw new UserInputError('Cannot use `first` and `last` simultaneously.');
  }
  if (after && before) {
    throw new UserInputError('Cannot use `after` and `before` simultaneously.');
  }

  let edges = data.map((node) => ({
    node,
    cursor: toCursor(getCursor(node)),
  }));

  const totalCount = edges.length;

  if (after) {
    const afterCursor = fromCursor(after);
    const afterIndex = edges.findIndex((edge) => fromCursor(edge.cursor) === afterCursor);
    if (afterIndex > -1) {
      edges = edges.slice(afterIndex + 1);
    }
  }

  if (before) {
    const beforeCursor = fromCursor(before);
    const beforeIndex = edges.findIndex((edge) => fromCursor(edge.cursor) === beforeCursor);
    if (beforeIndex > -1) {
      edges = edges.slice(0, beforeIndex);
    }
  }

  const limit = first || last;
  if (limit && edges.length > limit) {
    if (last) {
      edges = edges.slice(edges.length - last);
    } else {
      edges = edges.slice(0, first);
    }
  }

  const hasNextPage = !!(
    first && totalCount > (edges.length > 0 ? data.indexOf(edges[edges.length - 1].node) + 1 : 0)
  );
  const hasPreviousPage = !!(last && totalCount > edges.length);

  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage,
      startCursor: edges.length > 0 ? edges[0].cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
    },
    totalCount,
  };
}
