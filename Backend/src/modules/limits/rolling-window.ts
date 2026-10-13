import type { Redis } from 'ioredis';

/** One counted event (an outflow): when, how much (minor units), and a stable id for dedupe. */
export interface WindowEvent {
  id: string;
  at: number;
  amount: bigint;
}

export interface WindowTotals {
  count: number;
  sum: bigint;
}

/** Totals of the events with `from <= at <= to`. Pure. */
export function windowTotals(events: readonly WindowEvent[], from: number, to: number): WindowTotals {
  let count = 0;
  let sum = 0n;
  for (const e of events) {
    if (e.at < from || e.at > to) continue;
    count++;
    sum += e.amount;
  }
  return { count, sum };
}

/** A rolling window ending at `now`: the last `windowMs` milliseconds. Pure. */
export function rollingTotals(events: readonly WindowEvent[], now: number, windowMs: number): WindowTotals {
  return windowTotals(events, now - windowMs, now);
}

/** ZSET member encoding: "<id>|<amount>" (the id makes re-recording the same event a no-op). */
export const encodeMember = (e: Pick<WindowEvent, 'id' | 'amount'>): string => `${e.id}|${e.amount.toString()}`;

export function decodeMember(member: string, score: number): WindowEvent {
  const idx = member.lastIndexOf('|');
  return { id: member.slice(0, idx), amount: BigInt(member.slice(idx + 1)), at: score };
}

/** The longest window any caller asks for (calendar month + slack); older events are pruned. */
export const MAX_WINDOW_MS = 32 * 24 * 3600 * 1000;

/**
 * Rolling-window counters in Redis (sorted set per scope, score = event time). Redis is only a
 * CACHE: a scope is (re)hydrated from the database (the source of truth) whenever its marker key
 * has expired or was never written, so a cold or flushed Redis (or REDIS_MODE=memory) is always
 * correct, just slower. Authoritative limit decisions are still made in the database inside the
 * money transaction; these windows serve fast pre-checks, usage displays and fraud velocity.
 */
export class RollingWindowStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  private key(scope: string): string {
    return `lw:${scope}`;
  }

  private marker(scope: string): string {
    return `lw:${scope}:hydrated`;
  }

  /** Events of `scope` newer than `now - MAX_WINDOW_MS`, hydrating from `load` on a cache miss. */
  async events(scope: string, load: () => Promise<WindowEvent[]>, now = Date.now()): Promise<WindowEvent[]> {
    const key = this.key(scope);
    const hydrated = await this.redis.get(this.marker(scope));
    if (!hydrated) {
      const events = await load();
      const multi = this.redis.multi();
      multi.del(key);
      for (const e of events) multi.zadd(key, e.at, encodeMember(e));
      multi.pexpire(key, this.ttlSeconds * 1000);
      multi.set(this.marker(scope), '1', 'EX', this.ttlSeconds);
      await multi.exec();
      return events.filter((e) => e.at >= now - MAX_WINDOW_MS);
    }
    await this.redis.zremrangebyscore(key, '-inf', now - MAX_WINDOW_MS);
    const raw = await this.redis.zrangebyscore(key, now - MAX_WINDOW_MS, '+inf', 'WITHSCORES');
    const out: WindowEvent[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) out.push(decodeMember(raw[i] as string, Number(raw[i + 1])));
    return out;
  }

  /**
   * Record an event after its transaction committed. Only applied to a hydrated scope (otherwise
   * the next read hydrates from the database, which already contains it). Idempotent per event id.
   */
  async record(scope: string, event: WindowEvent): Promise<void> {
    if (!(await this.redis.get(this.marker(scope)))) return;
    await this.redis.zadd(this.key(scope), event.at, encodeMember(event));
  }

  /** Drop a scope (e.g. after a correction); the next read re-hydrates from the database. */
  async invalidate(scope: string): Promise<void> {
    await this.redis.del(this.marker(scope), this.key(scope));
  }
}
