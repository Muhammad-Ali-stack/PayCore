import { categoryForMcc, categoryForType, periodKeys, shareOf } from '../../src/modules/analytics/analytics.service';

describe('analytics helpers', () => {
  it('maps merchant category codes to spending categories', () => {
    expect(categoryForMcc('5812')).toBe('Dining');
    expect(categoryForMcc('5942')).toBe('Books & Stationery');
    expect(categoryForMcc('0000')).toBe('Other merchants');
  });

  it('categorises non-merchant outflows by payment or entry type', () => {
    expect(categoryForType('P2P', 'TRANSFER')).toBe('Transfers');
    expect(categoryForType('REQUEST', 'TRANSFER')).toBe('Transfers');
    expect(categoryForType(null, 'WITHDRAWAL')).toBe('Withdrawals');
    expect(categoryForType(null, 'FX_CONVERSION')).toBe('Currency exchange');
  });

  it('formats shares as 4-dp decimal strings without floats', () => {
    expect(shareOf(1n, 3n)).toBe('0.3333');
    expect(shareOf(5n, 5n)).toBe('1.0000');
    expect(shareOf(0n, 0n)).toBe('0.0000');
  });

  it('builds UTC period keys oldest first', () => {
    const now = new Date('2026-10-13T08:00:00Z');
    expect(periodKeys('DAY', 3, now)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
    expect(periodKeys('MONTH', 3, now)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(periodKeys('MONTH', 2, new Date('2026-01-31T00:00:00Z'))).toEqual(['2025-12', '2026-01']);
  });
});
