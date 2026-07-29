import { faker } from '@faker-js/faker';

export interface AccountFixtureOverrides {
  id?: string;
  address?: string;
  createdAt?: Date;
}

export function makeAccount(overrides: AccountFixtureOverrides = {}) {
  return {
    id: overrides.id ?? faker.string.uuid(),
    address: overrides.address ?? faker.finance.ethereumAddress(),
    createdAt: overrides.createdAt ?? faker.date.past(),
  };
}

export interface ActivityEventOverrides {
  accountId?: string;
  timestamp?: Date;
  weight?: number;
}

export function makeActivityEvent(overrides: ActivityEventOverrides = {}) {
  return {
    accountId: overrides.accountId ?? faker.string.uuid(),
    timestamp: overrides.timestamp ?? faker.date.recent(),
    weight: overrides.weight ?? faker.number.int({ min: 1, max: 10 }),
  };
}

export function makeDateRange(daysBack = 30) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - daysBack);
  return { start, end };
}