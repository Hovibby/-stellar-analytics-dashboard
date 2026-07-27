import { GraphQLError } from 'graphql';

export interface OrderByClause {
  field: string;
  direction: 'ASC' | 'DESC';
}

const DIRECTION_MAP: Record<string, 'ASC' | 'DESC'> = {
  ASC: 'ASC',
  DESC: 'DESC',
};

export function buildOrderByClause(
  orderBy: OrderByClause[] | null | undefined,
  allowedFields: Map<string, string>,
  defaultClause: string
): string {
  if (!orderBy || orderBy.length === 0) {
    return defaultClause;
  }

  const clauses: string[] = [];

  for (const { field, direction } of orderBy) {
    const column = allowedFields.get(field);
    if (!column) {
      throw new GraphQLError(`Invalid sort field: "${field}"`, {
        extensions: { code: 'VALIDATION_ERROR' },
      });
    }
    const dir = DIRECTION_MAP[direction] ?? 'DESC';
    clauses.push(`${column} ${dir}`);
  }

  return `ORDER BY ${clauses.join(', ')}`;
}

export function validateOrderBy(
  orderBy: unknown,
  allowedFields: Set<string>
): OrderByClause[] | null {
  if (!orderBy || !Array.isArray(orderBy)) return null;

  if (orderBy.length > 5) {
    throw new GraphQLError('Cannot sort by more than 5 fields', {
      extensions: { code: 'VALIDATION_ERROR' },
    });
  }

  return orderBy.map((item: any) => {
    if (!item.field || typeof item.field !== 'string') {
      throw new GraphQLError('Each orderBy entry must have a string "field"', {
        extensions: { code: 'VALIDATION_ERROR' },
      });
    }
    if (!allowedFields.has(item.field)) {
      throw new GraphQLError(`Invalid sort field: "${item.field}"`, {
        extensions: { code: 'VALIDATION_ERROR' },
      });
    }
    const direction = item.direction === 'ASC' ? 'ASC' : 'DESC';
    return { field: item.field, direction };
  });
}
