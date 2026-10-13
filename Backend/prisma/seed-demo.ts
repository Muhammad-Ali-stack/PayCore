/**
 * Demo data for screenshots and walkthroughs:
 *
 *   npm run db:seed:demo
 *
 * Everything is created through the real HTTP API (registration, KYC, funding via the simulated bank,
 * P2P, FX, payment requests, QR payments, refunds, settlement), so every balance and ledger entry is
 * genuine and the books stay balanced.
 *
 * To give charts and history a realistic 30-day spread, the script works in daily batches. After each
 * batch it shifts the timestamps of the rows that batch created back to the target day. Ledger amounts
 * and balances are never changed; only the append-only guard triggers are switched off, inside the
 * single shifting transaction. Refuses to run with NODE_ENV=production. Skips if the demo users exist.
 *
 * Runs without Redis: the app boots in-process with an in-memory Redis and the inline queue driver.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── environment (must be set before the app module is loaded) ─────────────────────────────
function loadDotEnv(): void {
  try {
    for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* rely on the real environment */
  }
}
loadDotEnv();
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}
Object.assign(process.env, {
  LOG_LEVEL: 'warn',
  QUEUE_DRIVER: 'inline',
  INLINE_SCHEDULER_ENABLED: 'false',
  BANK_SIM_ENABLED: 'true',
  BANK_SIM_WEBHOOK_URL: '',
  OTP_DEV_ECHO: 'true',
  OTP_RESEND_COOLDOWN_SECONDS: '0',
  THROTTLE_LIMIT: '1000000',
  AUTH_THROTTLE_LIMIT: '1000000',
  LOOKUP_THROTTLE_LIMIT: '1000000',
});

const PASSWORD = 'Password123';
const PIN = '2580';
const DAY = 24 * 3600 * 1000;

// Deterministic RNG so reruns on a fresh DB produce the same story.
let seed = 20261013;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const between = (min: number, max: number, step = 10) => Math.round((min + rand() * (max - min)) / step) * step;
const money = (n: number) => n.toFixed(2);

interface Person {
  key: string;
  phone: string;
  fullName: string;
  username: string;
  role: 'CONSUMER' | 'MERCHANT';
  id?: string;
  token?: string;
  loginAt?: number;
  wallets: Partial<Record<'PKR' | 'AED' | 'USD', string>>;
}

const people: Record<string, Person> = {
  ayesha: { key: 'ayesha', phone: '+923001234567', fullName: 'Ayesha Khan', username: 'ayesha', role: 'CONSUMER', wallets: {} },
  ali: { key: 'ali', phone: '+923001112233', fullName: 'Ali Raza', username: 'ali_k', role: 'CONSUMER', wallets: {} },
  sara: { key: 'sara', phone: '+971501234567', fullName: 'Sara Ahmed', username: 'sara', role: 'CONSUMER', wallets: {} },
  bilal: { key: 'bilal', phone: '+923004445566', fullName: 'Bilal Hussain', username: 'bilal', role: 'CONSUMER', wallets: {} },
  zainab: { key: 'zainab', phone: '+923007778899', fullName: 'Zainab Malik', username: 'zainab', role: 'CONSUMER', wallets: {} },
  usman: { key: 'usman', phone: '+923009876543', fullName: 'Usman Tariq', username: 'chaipoint', role: 'MERCHANT', wallets: {} },
  hina: { key: 'hina', phone: '+923211234567', fullName: 'Hina Siddiqui', username: 'readings', role: 'MERCHANT', wallets: {} },
  kamran: { key: 'kamran', phone: '+923331234567', fullName: 'Kamran Qureshi', username: 'kk_kebabs', role: 'MERCHANT', wallets: {} },
};

const NOTES = ['Lunch', 'Rent share', 'Movie night', 'Groceries', 'Birthday gift', 'Fuel', 'Dinner split', 'Books', 'Cricket kit', 'Eid gift'];

async function main(): Promise<void> {
  const { Test } = await import('@nestjs/testing');
  const RedisMock = (await import('ioredis-mock')).default;
  const request = (await import('supertest')).default;
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const { PrismaService } = await import('../src/common/prisma/prisma.service');
  const { RedisService } = await import('../src/common/redis/redis.service');
  const { OutboxRelay } = await import('../src/common/outbox/outbox.service');
  const { LedgerService } = await import('../src/modules/ledger/ledger.service');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedisService)
    .useValue(new RedisMock())
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  const outbox = app.get(OutboxRelay);

  try {
    if (await prisma.user.findUnique({ where: { phone: people.ayesha!.phone } })) {
      console.log('Demo data already present (found Ayesha Khan). Nothing to do.');
      return;
    }

    // ── HTTP helpers ────────────────────────────────────────────────────────────────────────
    type Body = Record<string, unknown> | undefined;
    /**
     * Supabase's pooler occasionally drops a connection ("Server has closed the connection"), which
     * surfaces as a 500. Retry those with the SAME Idempotency-Key, so a money request can never be
     * applied twice; 409 "in progress" means the first attempt is still finishing, so wait and retry.
     */
    async function call(method: 'get' | 'post' | 'put' | 'patch', path: string, token?: string, body?: Body, idem = false) {
      const key = idem ? `seed-${randomUUID()}` : undefined;
      for (let attempt = 1; ; attempt++) {
        let req = request(app.getHttpServer())[method](path);
        if (token) req = req.set('Authorization', `Bearer ${token}`);
        if (key) req = req.set('Idempotency-Key', key);
        const res = await (body ? req.send(body) : req);
        if (res.status >= 200 && res.status < 300) return res.body;
        const transient = res.status >= 500 || (res.status === 409 && res.body?.error?.code === 'IDEMPOTENCY_IN_PROGRESS');
        if (transient && attempt < 6) {
          console.warn(`\n  retry ${attempt} ${method.toUpperCase()} ${path} (${res.status} ${res.body?.error?.code ?? ''})`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        throw new Error(`${method.toUpperCase()} ${path} -> ${res.status} ${JSON.stringify(res.body?.error ?? res.body)}`);
      }
    }

    const admin = { phone: process.env.ADMIN_PHONE ?? '', password: process.env.ADMIN_PASSWORD ?? '', token: '', at: 0 };
    async function adminToken(): Promise<string> {
      if (!admin.token || Date.now() - admin.at > 10 * 60_000) {
        const r = await call('post', '/v1/auth/login', undefined, { phone: admin.phone, password: admin.password, deviceId: 'demo-seed' });
        admin.token = r.accessToken;
        admin.at = Date.now();
      }
      return admin.token;
    }
    async function tok(p: Person): Promise<string> {
      if (!p.token || Date.now() - (p.loginAt ?? 0) > 10 * 60_000) {
        const r = await call('post', '/v1/auth/login', undefined, { phone: p.phone, password: PASSWORD, deviceId: 'demo-seed' });
        p.token = r.accessToken;
        p.loginAt = Date.now();
      }
      return p.token as string;
    }
    const as = async (p: Person, method: 'get' | 'post' | 'put' | 'patch', path: string, body?: Body, idem = false) =>
      call(method, path, await tok(p), body, idem);

    // ── backdating ──────────────────────────────────────────────────────────────────────────
    const EXCLUDED = new Set(['sessions', 'refresh_tokens', 'otp_challenges', 'idempotency_records', '_prisma_migrations']);
    async function batchStart(): Promise<Date> {
      const [row] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
      return new Date(Math.min(row!.now.getTime(), Date.now()) - 60_000);
    }
    async function shiftSince(start: Date, offsetMs: number): Promise<void> {
      const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'`;
      const byTable = new Map<string, string[]>();
      for (const c of cols) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
      const guards = await prisma.$queryRaw<Array<{ tbl: string; tgname: string }>>`
        SELECT c.relname AS tbl, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE '%append_only%'`;
      const secs = Math.round(offsetMs / 1000);
      const iso = start.toISOString();
      await prisma.$transaction(
        async (tx) => {
          for (const g of guards) await tx.$executeRawUnsafe(`ALTER TABLE "${g.tbl}" DISABLE TRIGGER "${g.tgname}"`);
          for (const [table, columns] of byTable) {
            if (EXCLUDED.has(table) || !columns.includes('created_at')) continue;
            const sets = columns.map((c) => `"${c}" = "${c}" - make_interval(secs => ${secs})`).join(', ');
            await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${sets} WHERE "created_at" >= '${iso}'::timestamp`);
          }
          for (const g of guards) await tx.$executeRawUnsafe(`ALTER TABLE "${g.tbl}" ENABLE TRIGGER "${g.tgname}"`);
        },
        { timeout: 180_000, maxWait: 30_000 },
      );
    }
    /** Run `work`, then move everything it created back to `daysAgo` (with some time-of-day spread). */
    async function day(daysAgo: number, work: () => Promise<void>): Promise<void> {
      const start = await batchStart();
      await work();
      await outbox.drainAll();
      if (daysAgo > 0) await shiftSince(start, daysAgo * DAY + between(0, 9 * 3600, 60) * 1000);
      process.stdout.write(daysAgo > 0 ? `.` : '\n');
    }

    // ── domain helpers ──────────────────────────────────────────────────────────────────────
    async function register(p: Person): Promise<void> {
      const reg = await call('post', '/v1/auth/register', undefined, { phone: p.phone, password: PASSWORD, fullName: p.fullName, role: p.role });
      p.id = reg.userId;
      await call('post', '/v1/auth/verify-phone', undefined, { phone: p.phone, code: reg.devOtp });
      const t = await tok(p);
      await call('post', '/v1/auth/pin', t, { password: PASSWORD, pin: PIN });
      await call('patch', '/v1/users/me', t, { username: p.username });
    }
    const basicKyc = { dateOfBirth: '1994-03-14', address: 'House 21, Street 4, Gulberg III, Lahore' };
    async function kyc(p: Person, targetTier: string, documentType: string, documentNumber: string, extra: Body = {}) {
      return as(p, 'post', '/v1/kyc/submissions', { targetTier, documentType, documentNumber, ...basicKyc, ...extra });
    }
    const approveKyc = async (id: string) => call('post', `/v1/admin/kyc/submissions/${id}/approve`, await adminToken(), { note: 'Documents verified' });
    async function wallet(p: Person, currency: 'PKR' | 'AED' | 'USD'): Promise<void> {
      p.wallets[currency] = (await as(p, 'post', '/v1/wallets', { currency })).id;
    }
    async function topup(p: Person, currency: 'PKR' | 'AED' | 'USD', amount: number, outcome: 'SUCCEEDED' | 'FAILED' | null = 'SUCCEEDED') {
      const f = await as(p, 'post', '/v1/funding/topups', { walletId: p.wallets[currency], amount: money(amount), method: pick(['BANK_TRANSFER', 'CARD']) }, true);
      if (outcome) await as(p, 'post', '/v1/dev/bank/simulate', { fundingId: f.id, outcome });
    }
    async function withdraw(p: Person, amount: number, outcome: 'SUCCEEDED' | null) {
      const f = await as(
        p,
        'post',
        '/v1/funding/withdrawals',
        { walletId: p.wallets.PKR, amount: money(amount), bankAccount: { iban: 'PK36SCBL0000001123456702', accountTitle: p.fullName, bankName: 'Standard Chartered' }, pin: PIN },
        true,
      );
      await outbox.drainAll(); // the worker submits the payout to the bank
      if (outcome) await as(p, 'post', '/v1/dev/bank/simulate', { fundingId: f.id, outcome });
    }
    async function send(from: Person, to: Person, currency: 'PKR' | 'AED' | 'USD', amount: number, note?: string) {
      return as(from, 'post', '/v1/transfers', { fromWalletId: from.wallets[currency], toPhone: to.phone, amount: money(amount), pin: PIN, note }, true);
    }
    async function sendFx(from: Person, fromCcy: 'PKR' | 'AED' | 'USD', to: Person, toCcy: 'PKR' | 'AED' | 'USD', amount: number, note?: string) {
      const q = await as(from, 'post', '/v1/transfers/quotes', {
        fromWalletId: from.wallets[fromCcy],
        to: { username: `@${to.username}` },
        toCurrency: toCcy,
        amount: money(amount),
        amountSide: 'SEND',
      });
      return as(from, 'post', '/v1/transfers', { quoteId: q.id, pin: PIN, note }, true);
    }
    async function convert(p: Person, from: 'PKR' | 'AED' | 'USD', to: 'PKR' | 'AED' | 'USD', amount: number) {
      const q = await as(p, 'post', '/v1/fx/quotes', { fromCurrency: from, toCurrency: to, sellAmount: money(amount) });
      return as(p, 'post', '/v1/fx/conversions', { quoteId: q.id, pin: PIN }, true);
    }
    async function payQr(payer: Person, payload: string, amount?: number) {
      const preview = await as(payer, 'post', '/v1/qr/resolve', { payload });
      return as(payer, 'post', '/v1/qr/pay', { previewToken: preview.previewToken, fromWalletId: payer.wallets.PKR, pin: PIN, ...(amount ? { amount: money(amount) } : {}) }, true);
    }

    interface Shop { owner: Person; merchantId: string; outlets: Array<{ id: string; payload: string; terminalId?: string }>; payments: string[] }
    async function onboard(owner: Person, businessName: string, category: string, mdrBps: number, delayDays: number, outlets: Array<[string, string]>): Promise<Shop> {
      const m = await as(owner, 'post', '/v1/merchants', {
        businessName,
        category,
        registrationNumber: `SECP-${between(10000, 99999, 1)}`,
        settlementCurrency: 'PKR',
        settlementBank: { iban: 'PK36MEZN0000001123456702', accountTitle: businessName, bankName: 'Meezan Bank' },
        website: `https://${businessName.toLowerCase().replace(/[^a-z]/g, '')}.pk`,
      });
      const at = await adminToken();
      await call('post', `/v1/admin/merchants/${m.id}/approve`, at);
      await call('put', `/v1/admin/merchants/${m.id}/pricing`, at, { mdrBps, settlementDelayDays: delayDays });
      const shop: Shop = { owner, merchantId: m.id, outlets: [], payments: [] };
      for (const [name, address] of outlets) {
        const o = await as(owner, 'post', '/v1/merchant/outlets', { name, address });
        const t = await as(owner, 'post', `/v1/merchant/outlets/${o.id}/terminals`, { label: 'Till 1' });
        await as(owner, 'post', `/v1/merchant/outlets/${o.id}/terminals`, { label: 'Till 2' });
        shop.outlets.push({ id: o.id, payload: o.staticQr.payload, terminalId: t.id });
      }
      return shop;
    }
    async function shopSale(shop: Shop, payer: Person, amount: number): Promise<void> {
      const outlet = pick(shop.outlets);
      let payment;
      if (rand() < 0.5) {
        payment = await payQr(payer, outlet.payload, amount);
      } else {
        const qr = await as(shop.owner, 'post', '/v1/merchant/qr/dynamic', {
          amount: money(amount),
          currency: 'PKR',
          outletId: outlet.id,
          terminalId: outlet.terminalId,
          reference: `INV-${between(1000, 9999, 1)}`,
          expiresInSeconds: 300,
        });
        payment = await payQr(payer, qr.payload);
      }
      shop.payments.push(payment.id);
    }

    const { ayesha, ali, sara, bilal, zainab, usman, hina, kamran } = people as Required<typeof people>;
    let chai!: Shop;
    let books!: Shop;

    // ── day -30: everyone joins, verifies, funds ────────────────────────────────────────────
    console.log('Seeding demo data (each dot is one day of history)...');
    await day(30, async () => {
      for (const p of [ayesha, ali, sara, bilal, zainab, usman, hina]) await register(p);

      for (const [p, doc, num] of [
        [ayesha, 'CNIC', '35202-4417853-2'],
        [ali, 'CNIC', '35201-7765412-5'],
        [sara, 'EMIRATES_ID', '784-1994-5521873-1'],
      ] as const) {
        await approveKyc((await kyc(p, 'TIER_2', doc, num)).id);
      }
      await kyc(bilal, 'TIER_1', 'CNIC', '35202-9981234-7'); // auto-approved
      await kyc(zainab, 'TIER_1', 'CNIC', '35202-1238876-4'); // auto-approved
      for (const [p, biz] of [
        [usman, 'Chai Point'],
        [hina, 'Readings Bookstore'],
      ] as const) {
        await approveKyc((await kyc(p, 'TIER_3', 'BUSINESS_REGISTRATION', `SECP-${between(10000, 99999, 1)}`, { businessName: biz })).id);
      }

      for (const c of ['PKR', 'AED', 'USD'] as const) await wallet(ayesha, c);
      await wallet(ali, 'PKR');
      await wallet(ali, 'USD');
      await wallet(sara, 'AED');
      await wallet(sara, 'PKR');
      await wallet(bilal, 'PKR');
      await wallet(zainab, 'PKR');

      chai = await onboard(usman, 'Chai Point', '5812', 150, 1, [
        ['Chai Point, Gulberg', 'MM Alam Road, Gulberg III, Lahore'],
        ['Chai Point, DHA', 'Phase 5, DHA, Lahore'],
      ]);
      books = await onboard(hina, 'Readings Bookstore', '5942', 200, 2, [['Readings, Main Boulevard', 'Main Boulevard, Gulberg, Lahore']]);

      await topup(ayesha, 'PKR', 250_000);
      await topup(ayesha, 'AED', 5_000);
      await topup(ayesha, 'USD', 1_500);
      await topup(ali, 'PKR', 150_000);
      await topup(ali, 'USD', 800);
      await topup(sara, 'AED', 8_000);
      await topup(sara, 'PKR', 40_000);
      await topup(bilal, 'PKR', 20_000);
      await topup(zainab, 'PKR', 15_000);
    });

    // Zainab tries for TIER_2 and is rejected (shows in her history and the admin audit).
    await day(26, async () => {
      const sub = await kyc(zainab, 'TIER_2', 'PASSPORT', 'AB7714420');
      await call('post', `/v1/admin/kyc/submissions/${sub.id}/reject`, await adminToken(), { reason: 'Passport photo page is blurry; please re-upload.' });
    });

    // ── days -28 .. -1: everyday life ───────────────────────────────────────────────────────
    const consumersPkr = [ayesha, ayesha, ali, sara, bilal, zainab];
    for (let d = 28; d >= 1; d--) {
      if (d === 26) continue;
      await day(d, async () => {
        const sales = between(1, 4, 1);
        for (let i = 0; i < sales; i++) await shopSale(chai, pick(consumersPkr), between(180, 1400));
        if (d % 3 === 0) await shopSale(books, pick([ayesha, ali, sara]), between(900, 4800));
        if (d % 2 === 0) await send(pick([ayesha, ali]), pick([sara, bilal, zainab]), 'PKR', between(500, 6000, 50), pick(NOTES));
        if (d % 4 === 1) await send(bilal, ayesha, 'PKR', between(300, 2500, 50), pick(NOTES));

        if (d === 25) await sendFx(ayesha, 'USD', sara, 'AED', 120, 'Concert tickets');
        if (d === 21) await convert(ayesha, 'USD', 'PKR', 200);
        if (d === 18) await sendFx(sara, 'AED', ayesha, 'PKR', 350, 'Eid gift');
        if (d === 15) await topup(ayesha, 'PKR', 60_000);
        if (d === 14) {
          const r = await as(sara, 'post', '/v1/payment-requests', { to: { phone: ayesha.phone }, amount: '120.00', currency: 'AED', note: 'Brunch at Dubai Mall' });
          await as(ayesha, 'post', `/v1/payment-requests/${r.id}/accept`, { fromWalletId: ayesha.wallets.AED, pin: PIN }, true);
        }
        if (d === 12) await withdraw(ayesha, 20_000, 'SUCCEEDED');
        if (d === 9) {
          const r = await as(ayesha, 'post', '/v1/payment-requests', { to: { phone: bilal.phone }, amount: '2000.00', currency: 'PKR', note: 'Cricket kit share' });
          await as(bilal, 'post', `/v1/payment-requests/${r.id}/decline`);
        }
        if (d === 7) await topup(ali, 'PKR', 30_000);
        if (d === 5) {
          const qr = await as(ayesha, 'post', '/v1/qr/receive', { currency: 'PKR', amount: '500.00' });
          await payQr(ali, qr.payload);
        }
        if (d === 4) {
          const target = chai.payments[chai.payments.length - 3]!;
          await as(usman, 'post', `/v1/merchant/payments/${target}/refunds`, { amount: '100.00', reason: 'Order was missing one item' }, true);
        }
        if (d === 3) {
          const target = books.payments[books.payments.length - 1]!;
          await as(hina, 'post', `/v1/merchant/payments/${target}/refunds`, { reason: 'Customer returned the book' }, true);
        }
        if (d === 2) await convert(sara, 'AED', 'PKR', 150);
      });
    }

    // ── today: things that should look "live" ───────────────────────────────────────────────
    await day(0, async () => {
      for (let i = 0; i < 3; i++) await shopSale(chai, pick(consumersPkr), between(200, 1200));
      await shopSale(books, ali, 2350);
      await send(ayesha, ali, 'PKR', 1800, 'Dinner split');

      await as(ali, 'post', '/v1/payment-requests', { to: { phone: ayesha.phone }, amount: '1500.00', currency: 'PKR', note: 'Cinema tickets' });
      await as(zainab, 'post', '/v1/payment-requests', { to: { phone: ayesha.phone }, amount: '650.00', currency: 'PKR', note: 'Groceries split' });

      await topup(ali, 'PKR', 10_000, null); // stays PENDING
      await topup(ayesha, 'PKR', 5_000, 'FAILED');
      await withdraw(ali, 5_000, null); // submitted, awaiting the bank

      await kyc(bilal, 'TIER_2', 'CNIC', '35202-9981234-7'); // waiting in the admin KYC queue

      await register(kamran);
      await approveKyc((await kyc(kamran, 'TIER_3', 'BUSINESS_REGISTRATION', 'SECP-55120', { businessName: 'Karachi Kebabs' })).id);
      await as(kamran, 'post', '/v1/merchants', {
        businessName: 'Karachi Kebabs',
        category: '5812',
        registrationNumber: 'SECP-55120',
        settlementCurrency: 'PKR',
        settlementBank: { iban: 'PK36UNIL0000001123456702', accountTitle: 'Karachi Kebabs', bankName: 'UBL' },
      }); // PENDING_REVIEW in the admin merchant queue

      const run = await call('post', '/v1/admin/settlements/run', await adminToken(), {});
      await outbox.drainAll();
      for (const s of run.settlements as Array<{ id: string }>) {
        await as(usman, 'post', '/v1/dev/bank/simulate', { settlementId: s.id, outcome: 'SUCCEEDED' });
      }
    });

    const report = await app.get(LedgerService).integrityReport();
    const counts = {
      users: await prisma.user.count(),
      journalEntries: await prisma.journalEntry.count(),
      payments: await prisma.payment.count(),
      settlements: await prisma.settlement.count(),
    };
    console.log('Done.', counts, `ledger healthy: ${report.healthy}`);
    if (!report.healthy) {
      console.error(JSON.stringify(report, null, 2));
      process.exitCode = 1;
    }
    console.log(`\nDemo logins (password "${PASSWORD}", PIN ${PIN}):`);
    for (const p of Object.values(people)) console.log(`  ${p.fullName.padEnd(15)} ${p.phone}  @${p.username}  (${p.role.toLowerCase()})`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
