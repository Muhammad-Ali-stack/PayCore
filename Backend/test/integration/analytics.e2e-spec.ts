import { createAdmin, createTestApp, TestContext, auth, deposit, openWallet, signUp } from './helpers/app';
import { createMerchant, fundedUser, scanAndPay } from './helpers/phase2';
import { idemKey } from './helpers/app';

describe('Analytics (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  it('converts every wallet into the preferred currency for the total balance', async () => {
    const user = await signUp(ctx, { tier: 'TIER_2' });
    const pkr = await openWallet(ctx, user, 'PKR');
    const usd = await openWallet(ctx, user, 'USD');
    await deposit(ctx, user, pkr, '1000.00');
    await deposit(ctx, user, usd, '10.00'); // 10 USD = 2,785.00 PKR at the simulated mid rate

    const res = await ctx.http().get('/v1/analytics/currencies').set(auth(user)).expect(200);
    expect(res.body).toMatchObject({ preferredCurrency: 'PKR', total: { currency: 'PKR', amount: '3785.00' } });
    expect(res.body.items).toEqual([
      expect.objectContaining({ currency: 'PKR', balance: expect.objectContaining({ amount: '1000.00' }), share: '0.2642' }),
      expect.objectContaining({ currency: 'USD', converted: expect.objectContaining({ amount: '2785.00' }), share: '0.7357' }),
    ]);
    const usdView = await ctx.http().get('/v1/analytics/currencies?currency=USD').set(auth(user)).expect(200);
    expect(usdView.body.preferredCurrency).toBe('USD');
  });

  it('groups outflows by category and merchant, and reports in/out per day', async () => {
    const admin = await createAdmin(ctx);
    const shop = await createMerchant(ctx, admin, { name: 'Chai Point' }); // MCC 5812 -> Dining
    const { user, wallet } = await fundedUser(ctx, { amount: '5000' });
    const friend = await signUp(ctx, { tier: 'TIER_2' });
    await openWallet(ctx, friend, 'PKR');

    await scanAndPay(ctx, user, wallet, shop.staticPayload, '300.00');
    await ctx
      .http()
      .post('/v1/transfers')
      .set(auth(user))
      .set('Idempotency-Key', idemKey())
      .send({ fromWalletId: wallet, toPhone: friend.phone, amount: '700.00', pin: user.pin })
      .expect(201);

    const byCategory = await ctx.http().get('/v1/analytics/spending?currency=PKR&groupBy=CATEGORY').set(auth(user)).expect(200);
    expect(byCategory.body.total.amount).toBe('1000.00');
    expect(byCategory.body.groups).toEqual([
      expect.objectContaining({ key: 'Transfers', amount: expect.objectContaining({ amount: '700.00' }), count: 1, share: '0.7000' }),
      expect.objectContaining({ key: 'Dining', amount: expect.objectContaining({ amount: '300.00' }), count: 1, share: '0.3000' }),
    ]);

    const byMerchant = await ctx.http().get('/v1/analytics/spending?currency=PKR&groupBy=MERCHANT').set(auth(user)).expect(200);
    expect(byMerchant.body.groups).toEqual([expect.objectContaining({ key: 'Chai Point', count: 1 })]);

    const trend = await ctx.http().get('/v1/analytics/trend?currency=PKR&granularity=DAY&periods=7').set(auth(user)).expect(200);
    expect(trend.body.points).toHaveLength(7);
    expect(trend.body.points[6]).toMatchObject({ in: { amount: '5000.00' }, out: { amount: '1000.00' } });
    expect(trend.body.points[0]).toMatchObject({ in: { amount: '0.00' }, out: { amount: '0.00' } });

    await ctx.http().get('/v1/analytics/trend?currency=PKR&granularity=WEEK').set(auth(user)).expect(400);
  });
});
