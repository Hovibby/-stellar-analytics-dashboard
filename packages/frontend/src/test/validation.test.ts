import { describe, it, expect } from 'vitest';
import {
  stellarAddressSchema,
  txHashSchema,
  ledgerSequenceSchema,
  searchQuerySchema,
  accountFiltersSchema,
  transactionFiltersSchema,
  ledgerFiltersSchema,
  assetFiltersSchema,
  detectInputType,
  getSearchHint,
} from '../lib/validation';

const VALID_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA';
const VALID_TX_HASH = 'a' .repeat(64);

describe('stellarAddressSchema', () => {
  it('accepts a valid Stellar address', () => {
    expect(stellarAddressSchema.safeParse(VALID_ADDRESS).success).toBe(true);
  });
  it('rejects an address not starting with G', () => {
    expect(stellarAddressSchema.safeParse('B' + 'A'.repeat(55)).success).toBe(false);
  });
  it('rejects an address that is too short', () => {
    expect(stellarAddressSchema.safeParse('GABC').success).toBe(false);
  });
  it('rejects empty string', () => {
    expect(stellarAddressSchema.safeParse('').success).toBe(false);
  });
});

describe('txHashSchema', () => {
  it('accepts a valid 64-char hex hash', () => {
    expect(txHashSchema.safeParse(VALID_TX_HASH).success).toBe(true);
  });
  it('rejects a hash that is too short', () => {
    expect(txHashSchema.safeParse('abc123').success).toBe(false);
  });
  it('rejects non-hex characters', () => {
    expect(txHashSchema.safeParse('z'.repeat(64)).success).toBe(false);
  });
});

describe('ledgerSequenceSchema', () => {
  it('accepts a positive integer string', () => {
    expect(ledgerSequenceSchema.safeParse('12345').success).toBe(true);
  });
  it('rejects zero', () => {
    expect(ledgerSequenceSchema.safeParse('0').success).toBe(false);
  });
  it('rejects non-numeric string', () => {
    expect(ledgerSequenceSchema.safeParse('abc').success).toBe(false);
  });
});

describe('searchQuerySchema', () => {
  it('accepts a query of 2+ chars', () => {
    expect(searchQuerySchema.safeParse('ab').success).toBe(true);
  });
  it('rejects a single character', () => {
    expect(searchQuerySchema.safeParse('a').success).toBe(false);
  });
  it('rejects a query over 200 chars', () => {
    expect(searchQuerySchema.safeParse('a'.repeat(201)).success).toBe(false);
  });
});

describe('accountFiltersSchema', () => {
  it('accepts empty object', () => {
    expect(accountFiltersSchema.safeParse({}).success).toBe(true);
  });
  it('rejects minBalance > maxBalance', () => {
    const result = accountFiltersSchema.safeParse({ minBalance: '100', maxBalance: '50' });
    expect(result.success).toBe(false);
  });
  it('accepts valid balance range', () => {
    const result = accountFiltersSchema.safeParse({ minBalance: '10', maxBalance: '100' });
    expect(result.success).toBe(true);
  });
});

describe('transactionFiltersSchema', () => {
  it('rejects startTime after endTime', () => {
    const result = transactionFiltersSchema.safeParse({
      startTime: '2024-12-31',
      endTime: '2024-01-01',
    });
    expect(result.success).toBe(false);
  });
  it('accepts valid time range', () => {
    const result = transactionFiltersSchema.safeParse({
      startTime: '2024-01-01',
      endTime: '2024-12-31',
    });
    expect(result.success).toBe(true);
  });
});

describe('ledgerFiltersSchema', () => {
  it('rejects minOps > maxOps', () => {
    const result = ledgerFiltersSchema.safeParse({ minOps: '10', maxOps: '5' });
    expect(result.success).toBe(false);
  });
});

describe('assetFiltersSchema', () => {
  it('accepts valid asset type', () => {
    const result = assetFiltersSchema.safeParse({ assetType: 'native' });
    expect(result.success).toBe(true);
  });
  it('rejects invalid asset type', () => {
    const result = assetFiltersSchema.safeParse({ assetType: 'unknown' });
    expect(result.success).toBe(false);
  });
});

describe('detectInputType', () => {
  it('detects a full Stellar account', () => {
    expect(detectInputType(VALID_ADDRESS)).toBe('account');
  });
  it('detects a transaction hash', () => {
    expect(detectInputType(VALID_TX_HASH)).toBe('transaction');
  });
  it('detects a ledger sequence', () => {
    expect(detectInputType('12345')).toBe('ledger');
  });
  it('returns partial for short text', () => {
    expect(detectInputType('ab')).toBe('partial');
  });
  it('returns null for empty string', () => {
    expect(detectInputType('')).toBe(null);
  });
});

describe('getSearchHint', () => {
  it('returns valid account hint for full address', () => {
    expect(getSearchHint(VALID_ADDRESS)).toBe('✓ Valid Stellar account ID');
  });
  it('returns valid tx hint for full hash', () => {
    expect(getSearchHint(VALID_TX_HASH)).toBe('✓ Valid transaction hash');
  });
  it('returns ledger hint for numeric string', () => {
    expect(getSearchHint('42')).toBe('✓ Ledger sequence number');
  });
  it('returns partial account hint for incomplete G address', () => {
    const hint = getSearchHint('GABC');
    expect(hint).toContain('more character');
  });
  it('returns null for empty string', () => {
    expect(getSearchHint('')).toBe(null);
  });
});
