import { StellarService } from '../services/stellar-service';

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-sdk – creates a fresh chainable builder per call so
// each test can set its own resolved value on builder.call / builder.stream.
// ---------------------------------------------------------------------------

const createBuilder = () => {
  const builder: any = {};
  ['order', 'limit', 'cursor', 'ledger', 'transaction',
   'forLedger', 'forTransaction', 'forAccount', 'accountId'].forEach(m => {
    builder[m] = jest.fn().mockReturnValue(builder);
  });
  builder.call   = jest.fn().mockResolvedValue({});
  builder.stream = jest.fn();
  return builder;
};

let mockServer: any;

jest.mock('@stellar/stellar-sdk', () => {
  const MockServer = jest.fn().mockImplementation(() => mockServer);
  return { Server: MockServer, Horizon: {} };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshServer() {
  mockServer = {
    ledgers:      jest.fn().mockImplementation(createBuilder),
    transactions: jest.fn().mockImplementation(createBuilder),
    operations:   jest.fn().mockImplementation(createBuilder),
    accounts:     jest.fn().mockImplementation(createBuilder),
    assets:       jest.fn().mockImplementation(createBuilder),
    trades:       jest.fn().mockImplementation(createBuilder),
    effects:      jest.fn().mockImplementation(createBuilder),
    payments:     jest.fn().mockImplementation(createBuilder),
    root:         jest.fn().mockImplementation(createBuilder),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StellarService – constructor & accessors', () => {
  beforeEach(() => freshServer());

  it('stores and returns the horizon URL', () => {
    const url = 'https://horizon-testnet.stellar.org';
    const svc = new StellarService(url);
    expect(svc.getHorizonUrl()).toBe(url);
  });

  it('exposes the underlying Server instance', () => {
    const svc = new StellarService('https://horizon.stellar.org');
    expect(svc.getServer()).toBe(mockServer);
  });
});

describe('StellarService – testConnection', () => {
  beforeEach(() => freshServer());

  it('returns true when root().call() resolves', async () => {
    const svc = new StellarService('https://horizon.stellar.org');
    const result = await svc.testConnection();
    expect(result).toBe(true);
  });

  it('returns false when root().call() rejects', async () => {
    mockServer.root = jest.fn().mockReturnValue({
      call: jest.fn().mockRejectedValue(new Error('network error')),
    });
    const svc = new StellarService('https://horizon.stellar.org');
    const result = await svc.testConnection();
    expect(result).toBe(false);
  });
});

describe('StellarService – ledger methods', () => {
  beforeEach(() => freshServer());

  it('getLatestLedger calls ledgers().order().limit().call()', async () => {
    const fakeRecord = { sequence: 99999 };
    const builder = createBuilder();
    builder.call.mockResolvedValue(fakeRecord);
    mockServer.ledgers = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    const result = await svc.getLatestLedger();

    expect(mockServer.ledgers).toHaveBeenCalled();
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(result).toBe(fakeRecord);
  });

  it('getLedger(sequence) calls ledgers().ledger().call()', async () => {
    const builder = createBuilder();
    mockServer.ledgers = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getLedger(12345);

    expect(builder.ledger).toHaveBeenCalledWith(12345);
    expect(builder.call).toHaveBeenCalled();
  });

  it('getLedgers passes cursor when provided', async () => {
    const builder = createBuilder();
    mockServer.ledgers = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getLedgers('some-cursor');

    expect(builder.cursor).toHaveBeenCalledWith('some-cursor');
  });

  it('getLedgers omits cursor when not provided', async () => {
    const builder = createBuilder();
    mockServer.ledgers = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getLedgers();

    expect(builder.cursor).not.toHaveBeenCalled();
  });
});

describe('StellarService – transaction methods', () => {
  beforeEach(() => freshServer());

  it('getTransaction calls transactions().transaction().call()', async () => {
    const builder = createBuilder();
    mockServer.transactions = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getTransaction('abc123');

    expect(builder.transaction).toHaveBeenCalledWith('abc123');
    expect(builder.call).toHaveBeenCalled();
  });

  it('getTransactionsForLedger uses forLedger()', async () => {
    const builder = createBuilder();
    mockServer.transactions = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getTransactionsForLedger(500);

    expect(builder.forLedger).toHaveBeenCalledWith(500);
    expect(builder.call).toHaveBeenCalled();
  });
});

describe('StellarService – operation methods', () => {
  beforeEach(() => freshServer());

  it('getOperationsForTransaction uses forTransaction()', async () => {
    const builder = createBuilder();
    mockServer.operations = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getOperationsForTransaction('txhash');

    expect(builder.forTransaction).toHaveBeenCalledWith('txhash');
    expect(builder.call).toHaveBeenCalled();
  });

  it('getOperationsForLedger uses forLedger()', async () => {
    const builder = createBuilder();
    mockServer.operations = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getOperationsForLedger(42);

    expect(builder.forLedger).toHaveBeenCalledWith(42);
    expect(builder.call).toHaveBeenCalled();
  });
});

describe('StellarService – streaming', () => {
  beforeEach(() => freshServer());

  it('streamLedgers calls ledgers().cursor().stream()', () => {
    const builder = createBuilder();
    mockServer.ledgers = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    const onMessage = jest.fn();
    svc.streamLedgers(onMessage);

    expect(builder.cursor).toHaveBeenCalledWith('now');
    expect(builder.stream).toHaveBeenCalledWith(
      expect.objectContaining({ onmessage: onMessage }),
    );
  });

  it('streamTransactions calls transactions().cursor().stream()', () => {
    const builder = createBuilder();
    mockServer.transactions = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    svc.streamTransactions(jest.fn());

    expect(builder.cursor).toHaveBeenCalledWith('now');
    expect(builder.stream).toHaveBeenCalled();
  });
});

describe('StellarService – account methods', () => {
  beforeEach(() => freshServer());

  it('getAccount calls accounts().accountId().call()', async () => {
    const builder = createBuilder();
    mockServer.accounts = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getAccount('GABC');

    expect(builder.accountId).toHaveBeenCalledWith('GABC');
    expect(builder.call).toHaveBeenCalled();
  });

  it('getAccountTransactions uses forAccount()', async () => {
    const builder = createBuilder();
    mockServer.transactions = jest.fn().mockReturnValue(builder);

    const svc = new StellarService('https://horizon.stellar.org');
    await svc.getAccountTransactions('GABC');

    expect(builder.forAccount).toHaveBeenCalledWith('GABC');
    expect(builder.call).toHaveBeenCalled();
  });
});
