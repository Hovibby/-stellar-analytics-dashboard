import { IndexerService } from '../services/indexer-service';

describe('IndexerService.backfillFromSequence', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('throws for invalid startSequence values', async () => {
    const mockStellar: any = { getLatestLedger: jest.fn() };
    const svc = new IndexerService(mockStellar as any);

    await expect(svc.backfillFromSequence(0)).rejects.toThrow('startSequence must be a positive integer');
    await expect(svc.backfillFromSequence(-5)).rejects.toThrow('startSequence must be a positive integer');
  });

  it('resolves endSequence when omitted and calls backfillLedgers with computed end', async () => {
    const mockLatest = { sequence: 500 } as any;
    const mockStellar: any = { getLatestLedger: jest.fn().mockResolvedValue(mockLatest) };

    const svc = new IndexerService(mockStellar as any);

    // Spy on backfillLedgers to avoid performing real network/database work
    const spy = jest.spyOn(svc as any, 'backfillLedgers').mockResolvedValue(undefined);

    await svc.backfillFromSequence(450);

    expect(spy).toHaveBeenCalledWith(450, 490); // 500 - 10 = 490
  });
});

export {};
