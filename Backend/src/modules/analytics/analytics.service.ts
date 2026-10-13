import { Injectable } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { moneyView } from '../../common/money/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { convertMinor } from '../wallets/fx/fx.math';
import { RatesService } from '../wallets/fx/rates.service';

const DAY = 24 * 3600 * 1000;

/** ISO 18245 merchant category codes -> human-friendly spending categories. */
const MCC_CATEGORIES: Array<[string[], string]> = [
  [['5811', '5812', '5813', '5814'], 'Dining'],
  [['5411', '5422', '5441', '5451', '5462', '5499'], 'Groceries'],
  [['5942', '5943', '5192', '5994'], 'Books & Stationery'],
  [['4111', '4121', '4131', '5541', '5542', '4789'], 'Transport'],
  [['5311', '5651', '5661', '5691', '5699', '5732', '5945'], 'Shopping'],
  [['4814', '4899', '4900'], 'Utilities & Bills'],
  [['7832', '7922', '7991', '7996'], 'Entertainment'],
  [['5912', '8011', '8021', '8062'], 'Health'],
];
export function categoryForMcc(mcc: string): string {
  return MCC_CATEGORIES.find(([codes]) => codes.includes(mcc))?.[1] ?? 'Other merchants';
}

/** Category for outflows that aren't merchant payments, from the payment or entry type. */
export function categoryForType(paymentType: string | null, entryType: string): string {
  if (paymentType && ['P2P', 'P2P_FX', 'REQUEST', 'QR_P2P'].includes(paymentType)) return 'Transfers';
  switch (entryType) {
    case 'TRANSFER':
      return 'Transfers';
    case 'WITHDRAWAL':
      return 'Withdrawals';
    case 'FX_CONVERSION':
      return 'Currency exchange';
    case 'REVERSAL':
    case 'ADJUSTMENT':
      return 'Adjustments';
    default:
      return 'Other';
  }
}

/** Decimal share string "0.1234" (4 dp, truncated), "1.0000" for the whole. */
export function shareOf(part: bigint, total: bigint): string {
  if (total <= 0n) return '0.0000';
  const bps = (part * 10000n) / total;
  return bps >= 10000n ? '1.0000' : `0.${bps.toString().padStart(4, '0')}`;
}

/** Period keys for the last `periods` UTC days ("2026-10-13") or months ("2026-10"), oldest first. */
export function periodKeys(granularity: 'DAY' | 'MONTH', periods: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let i = periods - 1; i >= 0; i--) {
    keys.push(
      granularity === 'DAY'
        ? new Date(now.getTime() - i * DAY).toISOString().slice(0, 10)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
    );
  }
  return keys;
}

/**
 * Read-only spending analytics derived from the user's wallet postings (the ledger is the source
 * of truth). For a wallet (liability) a debit (amount > 0) is money OUT, a credit is money IN.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
  ) {}

  async spending(userId: string, q: { currency: Currency; groupBy: 'CATEGORY' | 'MERCHANT'; from?: string; to?: string }) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * DAY);
    const rows = await this.prisma.$queryRaw<
      Array<{ mcc: string | null; merchant: string | null; payment_type: string | null; entry_type: string; amount: bigint; n: bigint }>
    >`
      SELECT m.category AS mcc, m.business_name AS merchant, p.type::text AS payment_type, je.type::text AS entry_type,
             SUM(po.amount)::bigint AS amount, COUNT(*)::bigint AS n
        FROM postings po
        JOIN wallets w ON w.ledger_account_id = po.account_id
        JOIN journal_entries je ON je.id = po.entry_id
        LEFT JOIN payments p ON p.journal_entry_id = je.id
        LEFT JOIN merchants m ON m.id = p.merchant_id
       WHERE w.user_id = ${userId}::uuid AND w.currency = ${q.currency}::"Currency"
         AND po.amount > 0
         AND po.created_at >= ${from.toISOString()}::timestamp AND po.created_at < ${to.toISOString()}::timestamp
       GROUP BY 1, 2, 3, 4`;

    const groups = new Map<string, { amount: bigint; count: number }>();
    for (const r of rows) {
      if (q.groupBy === 'MERCHANT' && !r.merchant) continue;
      const key = q.groupBy === 'MERCHANT' ? (r.merchant as string) : r.mcc ? categoryForMcc(r.mcc) : categoryForType(r.payment_type, r.entry_type);
      const g = groups.get(key) ?? { amount: 0n, count: 0 };
      g.amount += r.amount;
      g.count += Number(r.n);
      groups.set(key, g);
    }
    const total = [...groups.values()].reduce((s, g) => s + g.amount, 0n);
    return {
      currency: q.currency,
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy: q.groupBy,
      total: moneyView(total, q.currency),
      groups: [...groups.entries()]
        .sort((a, b) => (b[1].amount > a[1].amount ? 1 : b[1].amount < a[1].amount ? -1 : 0))
        .map(([key, g]) => ({ key, label: key, amount: moneyView(g.amount, q.currency), count: g.count, share: shareOf(g.amount, total) })),
    };
  }

  async trend(userId: string, q: { currency: Currency; granularity: 'DAY' | 'MONTH'; periods: number }) {
    const keys = periodKeys(q.granularity, q.periods);
    const start = q.granularity === 'DAY' ? `${keys[0]}T00:00:00.000Z` : `${keys[0]}-01T00:00:00.000Z`;
    const unit = q.granularity === 'DAY' ? 'day' : 'month';
    const fmt = q.granularity === 'DAY' ? 'YYYY-MM-DD' : 'YYYY-MM';
    const rows = await this.prisma.$queryRaw<Array<{ period: string; inn: bigint; out: bigint }>>`
      SELECT to_char(date_trunc(${unit}, po.created_at), ${fmt}) AS period,
             COALESCE(SUM(-po.amount) FILTER (WHERE po.amount < 0), 0)::bigint AS inn,
             COALESCE(SUM(po.amount)  FILTER (WHERE po.amount > 0), 0)::bigint AS out
        FROM postings po
        JOIN wallets w ON w.ledger_account_id = po.account_id
       WHERE w.user_id = ${userId}::uuid AND w.currency = ${q.currency}::"Currency"
         AND po.created_at >= ${start}::timestamp
       GROUP BY 1`;
    const byPeriod = new Map(rows.map((r) => [r.period, r]));
    return {
      currency: q.currency,
      granularity: q.granularity,
      points: keys.map((period) => ({
        period,
        in: moneyView(byPeriod.get(period)?.inn ?? 0n, q.currency),
        out: moneyView(byPeriod.get(period)?.out ?? 0n, q.currency),
      })),
    };
  }

  /** Balances of all open wallets, converted into `preferred` at the mid rate. */
  async currencies(userId: string, preferred: Currency) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, status: { not: 'CLOSED' } },
      include: { ledgerAccount: { select: { balance: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const items = await Promise.all(
      wallets.map(async (w) => {
        const balance = w.ledgerAccount.balance;
        const converted =
          w.currency === preferred ? balance : convertMinor(balance, await this.rates.midRate(w.currency, preferred), w.currency, preferred);
        return { currency: w.currency, balance, converted };
      }),
    );
    const total = items.reduce((s, i) => s + i.converted, 0n);
    return {
      preferredCurrency: preferred,
      total: moneyView(total, preferred),
      rateAsOf: new Date().toISOString(),
      items: items.map((i) => ({
        currency: i.currency,
        balance: moneyView(i.balance, i.currency),
        converted: moneyView(i.converted, preferred),
        share: shareOf(i.converted, total),
      })),
    };
  }
}
