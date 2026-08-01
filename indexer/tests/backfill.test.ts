import { parseBackfillArgs } from '../src/backfill';

describe('parseBackfillArgs', () => {
  it('should parse account from arguments', () => {
    const args = ['--start=1', '--end=100', '--account=GABC'];
    const result = parseBackfillArgs(args);
    expect(result.account).toBe('GABC');
  });
});
