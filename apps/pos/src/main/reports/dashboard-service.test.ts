import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import type { DashboardRequest, DashboardSummary } from '../../shared/dashboard-api';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { OwnerGate } from '../auth/owner-gate';
import { UserStore } from '../auth/user-store';
import { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';
import { DashboardFixture } from './dashboard-fixtures';
import { DashboardService } from './dashboard-service';

const TENANT = 'tenant-a';
/** Mexico City has been six hours behind UTC all year since 2022, so a November time is written with this offset. */
const CST = '-06:00';
const CDT = '-05:00';

let directory: string;
let store: LocalStore;
let fixture: DashboardFixture;
let service: DashboardService;
let auth: AuthService;
let owner: UserSummary;
let cashier: UserSummary;
let now = new Date('2026-11-12T18:00:00.000Z');
let hammer: string;
let cable: string;

/** A moment written in local time of Mexico City, as UTC text. */
function at(local: string, offset = CST): string {
  return new Date(`${local}${offset}`).toISOString();
}

function request(overrides: Partial<DashboardRequest> = {}): DashboardRequest {
  return { period: 'day', date: '2026-11-10', topMetric: 'quantity', topLimit: 10, ...overrides };
}

function ownerSummary(overrides: Partial<DashboardRequest> = {}): DashboardSummary {
  const result = service.summary(request(overrides), owner);
  if (result.status !== 'ok') {
    throw new Error(`expected a summary, got ${result.status}`);
  }
  return result.summary;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dashboard-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  fixture = new DashboardFixture(store, TENANT);
  now = new Date('2026-11-12T18:00:00.000Z');
  service = new DashboardService(store, TENANT, new OwnerGate(auth, new AuditLog(store, TENANT)), () => now);
  // A hammer at $116.00 with 16% VAT included (base $100.00, VAT $16.00) that costs $60.00.
  hammer = fixture.product('Martillo', 'piece', { costE6: 60_000_000 });
  fixture.stock(hammer, 100_000);
  // Cable at $12.50 the meter, with 100 m bought at $5.00 a meter.
  cable = fixture.product('Cable THW', 'meter', { priceE4: 125_000 });
  fixture.stock(cable, 100_000, 5_000_000);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

/** The day of the examples: 2026-11-10, a Tuesday. */
function seedTheDay(): void {
  const first = fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: hammer, milli: 2_000 }], cashierId: owner.id });
  fixture.sale({ at: at('2026-11-10T10:30:00.000'), lines: [{ productId: hammer, milli: 1_000 }, { productId: cable, milli: 3_275 }], cashierId: cashier.id, pay: ['cash', 'card'] });
  fixture.sale({ at: at('2026-11-10T23:59:59.999'), lines: [{ productId: hammer, milli: 1_000 }], cashierId: owner.id, pay: ['transfer'] });
  fixture.saleReturn(first, 0, 1_000, at('2026-11-10T15:00:00.000'), 11_600);
  fixture.cancelledSale({ at: at('2026-11-10T12:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }], cashierId: owner.id });
  fixture.openSale({ at: at('2026-11-10T13:00:00.000'), lines: [{ productId: hammer, milli: 5_000 }], cashierId: owner.id });
}

describe('the indicators of a day', () => {
  it('adds up the completed sales, which is what each number is checked against by hand', () => {
    seedTheDay();

    const { totals } = ownerSummary();

    // Sales: 23,200 + (11,600 + 4,094) + 11,600 = 50,494 with VAT, 43,529 before VAT, 6,965 of VAT.
    expect(totals).toMatchObject({ salesCount: 3, totalCents: 50_494, subtotalCents: 43_529, taxCents: 6_965 });
    // 50,494 / 3 = 16,831.33 per ticket. Four lines over three tickets is 1.33.
    expect(totals).toMatchObject({ averageTicketCents: 16_831, lineCount: 4, linesPerTicketX100: 133 });
    // One hammer came back for $116.00, of which $100.00 was the base: the net is 38,894 and 33,529.
    expect(totals).toMatchObject({ returnsCount: 1, returnsCents: 11_600, netCents: 38_894, netSubtotalCents: 33_529 });
  });

  it('values the cost of what was sold net of what came back, and takes the margin over the net sale', () => {
    seedTheDay();

    const { totals } = ownerSummary();

    // Hammers: 4 sold less 1 back is 3 at $60.00 = 18,000, cable 3.275 m at $5.00 = 1,637.5 which rounds to 1,638 cents.
    // Written as 4 × 6,000 − 1 × 6,000 + 1,638 = 19,638.
    expect(totals.costOfGoodsCents).toBe(19_638);
    // The net sale before VAT is 33,529, so the profit is 33,529 − 19,638 = 13,891, which is 41.43% of it.
    expect(totals.grossProfitCents).toBe(13_891);
    expect(totals.marginBp).toBe(4_143);
    expect(totals.productsWithoutCostSold).toBe(0);
  });

  it('does not count a cancelled sale or an open one', () => {
    seedTheDay();

    const summary = ownerSummary();

    expect(summary.totals.salesCount).toBe(3);
    expect(summary.cancellations).toEqual({ count: 1, totalCents: 11_600 });
    expect(summary.topSellers.find((seller) => seller.productId === hammer)?.quantityMilli).toBe(4_000);
  });

  it('counts a mixed payment once, as mixed, and still says how much came in by each means', () => {
    seedTheDay();

    const { paymentKinds, methodAmounts } = ownerSummary();

    expect(paymentKinds).toEqual([
      { kind: 'cash', salesCount: 1, totalCents: 23_200 },
      { kind: 'card', salesCount: 0, totalCents: 0 },
      { kind: 'transfer', salesCount: 1, totalCents: 11_600 },
      { kind: 'mixed', salesCount: 1, totalCents: 15_694 },
    ]);
    // The mixed sale of 15,694 paid 7,847 in cash and 7,847 by card.
    expect(methodAmounts).toEqual([
      { method: 'cash', amountCents: 23_200 + 7_847 },
      { method: 'card', amountCents: 7_847 },
      { method: 'transfer', amountCents: 11_600 },
    ]);
  });

  it('counts a card typed by hand as a card', () => {
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }], pay: ['card_manual'] });

    expect(ownerSummary().paymentKinds.find((row) => row.kind === 'card')).toMatchObject({ salesCount: 1, totalCents: 11_600 });
  });

  it('groups by the hour and the weekday of the register, with zeros for the rest', () => {
    seedTheDay();

    const { byHour, byWeekday } = ownerSummary();

    expect(byHour).toHaveLength(24);
    expect(byHour.filter((row) => row.salesCount > 0)).toEqual([
      { hour: 10, salesCount: 2, totalCents: 38_894 },
      { hour: 23, salesCount: 1, totalCents: 11_600 },
    ]);
    // 2026-11-10 is a Tuesday.
    expect(byWeekday.map((row) => row.salesCount)).toEqual([0, 3, 0, 0, 0, 0, 0]);
  });

  it('shows the sales of each cashier, only to the owner', () => {
    seedTheDay();

    expect(ownerSummary().byCashier).toEqual([
      { name: 'Ana', salesCount: 1, totalCents: 15_694 },
      { name: 'Mauricio', salesCount: 2, totalCents: 34_800 },
    ]);
  });

  it('is empty for a day without sales, so it never divides by zero', () => {
    const { totals, topSellers } = ownerSummary({ date: '2020-01-15' });

    expect(totals).toMatchObject({ salesCount: 0, totalCents: 0, averageTicketCents: 0, linesPerTicketX100: 0, marginBp: null, costOfGoodsCents: 0, grossProfitCents: 0 });
    expect(topSellers).toEqual([]);
  });

  it('compares with the previous period', () => {
    seedTheDay();
    fixture.sale({ at: at('2026-11-09T10:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    const summary = ownerSummary();

    expect(summary.previousPeriod).toMatchObject({ fromDay: '2026-11-09', toDay: '2026-11-09' });
    expect(summary.previousTotals).toMatchObject({ salesCount: 1, totalCents: 11_600, grossProfitCents: 4_000 });
    expect(summary.isInProgress).toBe(false);
  });
});

describe('the limits of a day, a week, a month and a year', () => {
  function salesIn(period: DashboardRequest['period'], date: string): number {
    return ownerSummary({ period, date }).totals.salesCount;
  }

  it('puts a sale at midnight on the day that starts, and the one a millisecond before on the day that ends', () => {
    fixture.sale({ at: at('2026-11-10T23:59:59.999'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-11-11T00:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    expect(salesIn('day', '2026-11-10')).toBe(1);
    expect(salesIn('day', '2026-11-11')).toBe(1);
  });

  it('puts Sunday night in one week and Monday at midnight in the next', () => {
    fixture.sale({ at: at('2026-11-15T23:59:59.999'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-11-16T00:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    expect(salesIn('week', '2026-11-10')).toBe(1);
    expect(salesIn('week', '2026-11-16')).toBe(1);
    // The Sunday sale is the last of its week, which is a Sunday in the weekday chart.
    expect(ownerSummary({ period: 'week', date: '2026-11-10' }).byWeekday[6]?.salesCount).toBe(1);
  });

  it('puts the last night of a month in that month, and the first midnight in the next', () => {
    fixture.sale({ at: at('2026-10-31T23:59:59.999'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-11-01T00:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-11-30T23:59:59.999'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-12-01T00:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    expect(salesIn('month', '2026-10-15')).toBe(1);
    expect(salesIn('month', '2026-11-15')).toBe(2);
    expect(salesIn('month', '2026-12-15')).toBe(1);
  });

  it('puts New Year midnight in the new year, even though it is already the year after in UTC six hours earlier than local', () => {
    // 2026-12-31 23:30 local is 2027-01-01 05:30 UTC: it belongs to 2026 although UTC already says 2027.
    fixture.sale({ at: at('2026-12-31T23:30:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2027-01-01T00:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    expect(salesIn('year', '2026-06-01')).toBe(1);
    expect(salesIn('year', '2027-06-01')).toBe(1);
  });

  it('reads a custom range with both of its days included', () => {
    fixture.sale({ at: at('2026-11-09T23:59:59.999'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-11-10T00:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-11-12T23:59:59.999'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-11-13T00:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    const summary = ownerSummary({ period: 'custom', date: '2026-11-10', endDate: '2026-11-12' });

    expect(summary.totals.salesCount).toBe(2);
    expect(summary.trend.map((bucket) => bucket.key)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
  });

  it('counts a return in the period it was made, not in the period of its sale', () => {
    const sale = fixture.sale({ at: at('2026-11-09T10:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.saleReturn(sale, 0, 1_000, at('2026-11-10T10:00:00.000'), 11_600);

    expect(ownerSummary({ date: '2026-11-09' }).totals.returnsCount).toBe(0);
    expect(ownerSummary({ date: '2026-11-10' }).totals).toMatchObject({ returnsCount: 1, netCents: -11_600, netSubtotalCents: -10_000 });
  });

  it('reads the hours right on the day the clocks went forward, which has no 02:00 hour', () => {
    fixture.sale({ at: at('2022-04-03T01:30:00.000', CST), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2022-04-03T03:30:00.000', CDT), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2022-04-03T23:59:59.999', CDT), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2022-04-04T00:00:00.000', CDT), lines: [{ productId: hammer, milli: 1_000 }] });

    const summary = ownerSummary({ date: '2022-04-03' });

    expect(summary.totals.salesCount).toBe(3);
    expect(summary.byHour.filter((row) => row.salesCount > 0).map((row) => row.hour)).toEqual([1, 3, 23]);
    expect(ownerSummary({ date: '2022-04-04' }).totals.salesCount).toBe(1);
  });

  it('reads the hours right on the day the clocks went back, when 01:30 happens twice', () => {
    fixture.sale({ at: at('2022-10-30T01:30:00.000', CDT), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2022-10-30T01:30:00.000', CST), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2022-10-30T23:59:59.999', CST), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2022-10-31T00:00:00.000', CST), lines: [{ productId: hammer, milli: 1_000 }] });

    const day = ownerSummary({ date: '2022-10-30' });

    expect(day.totals.salesCount).toBe(3);
    expect(day.byHour[1]).toMatchObject({ salesCount: 2 });
    expect(day.byHour[23]).toMatchObject({ salesCount: 1 });
    // The month spans both offsets and still puts every sale on its own local day: the 31st holds the fourth sale.
    const month = ownerSummary({ period: 'month', date: '2022-10-15' });
    expect(month.totals.salesCount).toBe(4);
    expect(month.trend.find((bucket) => bucket.key === '2022-10-31')?.salesCount).toBe(1);
    expect(month.trend.find((bucket) => bucket.key === '2022-10-30')?.salesCount).toBe(3);
  });

  it('groups a long range by month and a short one by day', () => {
    fixture.sale({ at: at('2026-03-15T10:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });
    fixture.sale({ at: at('2026-03-20T10:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    const year = ownerSummary({ period: 'year', date: '2026-01-01' });

    expect(year.trendUnit).toBe('month');
    expect(year.trend).toHaveLength(12);
    expect(year.trend[2]).toEqual({ key: '2026-03', salesCount: 2, totalCents: 23_200 });
    expect(ownerSummary({ period: 'month', date: '2026-03-01' }).trendUnit).toBe('day');
  });

  it('says that a period that has not ended is in progress', () => {
    now = new Date('2026-11-12T18:00:00.000Z');

    expect(ownerSummary({ period: 'month', date: '2026-11-01' }).isInProgress).toBe(true);
    expect(ownerSummary({ period: 'day', date: '2026-11-11' }).isInProgress).toBe(false);
  });
});

describe('the best sellers', () => {
  function names(summary: DashboardSummary): string[] {
    return summary.topSellers.map((seller) => seller.name);
  }

  it('orders by quantity, importe or utilidad, and keeps the measured units with three decimals', () => {
    const pipe = fixture.product('Tubo', 'meter', { priceE4: 200_000, costE6: 18_000_000 });
    fixture.stock(pipe, 50_000);
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: hammer, milli: 3_000 }, { productId: pipe, milli: 7_500 }, { productId: cable, milli: 12_250 }] });

    const byQuantity = ownerSummary({ topMetric: 'quantity' });
    const byAmount = ownerSummary({ topMetric: 'amount' });
    const byProfit = ownerSummary({ topMetric: 'profit' });

    // Quantities in thousandths: cable 12.250, pipe 7.500, hammers 3.000.
    expect(names(byQuantity)).toEqual(['Cable THW', 'Tubo', 'Martillo']);
    expect(byQuantity.topSellers[0]).toMatchObject({ rank: 1, quantityMilli: 12_250, unit: 'meter' });
    // Amounts: hammers 3 × 11,600 = 34,800; cable 12.25 × 12.50 = 153.125 → 15,313; pipe 7.5 × 20.00 = 150.00 → 15,000.
    expect(names(byAmount)).toEqual(['Martillo', 'Cable THW', 'Tubo']);
    expect(byAmount.topSellers.map((seller) => seller.amountCents)).toEqual([34_800, 15_313, 15_000]);
    // Profit before VAT: hammers 30,000 − 18,000 = 12,000; pipe 12,931 − 13,500 is negative; cable has the average cost of $5.00.
    expect(byProfit.topSellers[0]).toMatchObject({ name: 'Martillo', profitCents: 12_000, costE6: 60_000_000, costSource: 'typed' });
  });

  it('breaks ties by quantity, then amount, then name, and always the same way', () => {
    const alpha = fixture.product('Alfa', 'piece', { costE6: 1_000_000 });
    const beta = fixture.product('Beta', 'piece', { costE6: 1_000_000 });
    const gamma = fixture.product('Gamma', 'piece', { costE6: 1_000_000, priceE4: 2_320_000 });
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: beta, milli: 2_000 }, { productId: alpha, milli: 2_000 }, { productId: gamma, milli: 2_000 }] });

    // All three sold 2 pieces; Gamma costs double, so it leads by amount; Alfa and Beta tie in everything and go by name.
    expect(names(ownerSummary({ topMetric: 'quantity' }))).toEqual(['Gamma', 'Alfa', 'Beta']);
    expect(names(ownerSummary({ topMetric: 'amount' }))).toEqual(['Gamma', 'Alfa', 'Beta']);
    expect(ownerSummary({ topMetric: 'quantity' }).topSellers.map((seller) => seller.rank)).toEqual([1, 2, 3]);
  });

  it('cuts the list at the limit that was asked', () => {
    const sales = Array.from({ length: 12 }, (_, index) => fixture.product(`Producto ${String(index).padStart(2, '0')}`, 'piece'));
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: sales.map((productId, index) => ({ productId, milli: (index + 1) * 1_000 })) });

    const top = ownerSummary({ topLimit: 10 }).topSellers;

    expect(top).toHaveLength(10);
    expect(top[0]?.name).toBe('Producto 11');
    expect(ownerSummary({ topLimit: 20 }).topSellers).toHaveLength(12);
  });

  it('marks a product without a cost instead of inventing one, and leaves it out of the profit', () => {
    const nails = fixture.product('Clavos', 'kilogram', { priceE4: 300_000 });
    fixture.stock(nails, 20_000);
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: nails, milli: 1_500 }, { productId: hammer, milli: 1_000 }] });

    const summary = ownerSummary({ topMetric: 'profit' });

    expect(summary.topSellers.map((seller) => seller.name)).toEqual(['Martillo', 'Clavos']);
    expect(summary.topSellers[1]).toMatchObject({ profitCents: null, costE6: null, costSource: 'none', quantityMilli: 1_500 });
    expect(summary.totals.productsWithoutCostSold).toBe(1);
    // Only the hammer is in the profit: $100.00 before VAT less its $60.00 cost.
    expect(summary.totals.grossProfitCents).toBe(4_000);
    expect(summary.totals.marginBp).toBe(4_000);
    expect(summary.inventory?.withoutCost.items.map((line) => line.name)).toEqual(['Clavos']);
  });

  it('uses the weighted average of the entries with a cost, mixed with the stock that was left', () => {
    const tape = fixture.product('Cinta', 'piece', { priceE4: 200_000 });
    // 10 at $5.00; 4 are sold, which leaves 6; then 6 more at $8.00 make the average (6 × 5 + 6 × 8) / 12 = $6.50.
    fixture.stock(tape, 10_000, 5_000_000);
    fixture.sale({ at: at('2026-11-01T10:00:00.000'), lines: [{ productId: tape, milli: 4_000 }] });
    fixture.stock(tape, 6_000, 8_000_000, 'adjustment');
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: tape, milli: 2_000 }] });

    const [seller] = ownerSummary().topSellers;

    expect(seller).toMatchObject({ name: 'Cinta', costE6: 6_500_000, costSource: 'average' });
    // 2 pieces cost 2 × $6.50 = $13.00 = 1,300 cents; they sold for 2 × $20.00 = 4,000 with VAT, 3,448 before it.
    expect(seller?.profitCents).toBe(3_448 - 1_300);
  });

  it('prefers the cost the owner typed to the average of the ledger', () => {
    fixture.stock(hammer, 1_000, 1_000_000);
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    const [hammerSeller] = ownerSummary().topSellers;

    expect(hammerSeller).toMatchObject({ costE6: 60_000_000, costSource: 'typed' });
  });

  it('counts a miscellaneous item as sold but never as a product with a cost', () => {
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: '00000000-0000-7000-8000-000000000000', milli: 1_000 }] });

    const summary = ownerSummary();

    expect(summary.topSellers[0]).toMatchObject({ name: 'Varios (sin catálogo)', costSource: 'none' });
    expect(summary.totals.productsWithoutCostSold).toBe(0);
    expect(summary.inventory?.withoutCost.total).toBe(0);
  });
});

describe('the inventory', () => {
  it('values the stock at cost, per product rounded half up, and says what has no cost', () => {
    const nails = fixture.product('Clavos', 'kilogram');
    fixture.stock(nails, 2_500);

    const { inventory } = ownerSummary();

    // 100 hammers at $60.00 = 600,000 cents. 100 m of cable at $5.00 = 50,000 cents. The nails have no cost.
    expect(inventory?.valueCents).toBe(650_000);
    expect(inventory?.stockedWithoutCost).toBe(1);
  });

  it('lists what has stock and did not sell in the period, what ran out, and what will run out at this pace', () => {
    const idle = fixture.product('Pintura', 'piece', { costE6: 100_000_000 });
    fixture.stock(idle, 5_000);
    const empty = fixture.product('Brochas', 'piece', { costE6: 10_000_000 });
    fixture.stock(empty, 1_000);
    fixture.sale({ at: at('2026-11-09T10:00:00.000'), lines: [{ productId: empty, milli: 1_000 }] });
    const low = fixture.product('Focos', 'piece', { costE6: 10_000_000 });
    fixture.stock(low, 3_000);
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: low, milli: 2_000 }] });
    const given = fixture.product('Descontinuado', 'piece', { isActive: false });
    fixture.stock(given, 1_000);
    fixture.sale({ at: at('2026-11-10T11:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });

    const { inventory } = ownerSummary();

    expect(inventory?.outOfStock.items.map((line) => line.name)).toEqual(['Brochas']);
    // Focos has 1 left after selling 2 today: at this pace it runs out in the next period. The hammer has 99 left after 1.
    expect(inventory?.runningLow.items.map((line) => line.name)).toEqual(['Focos']);
    // The ones that did not sell today, most valuable first: cable (50,000) and paint (50,000) tie, then by name.
    expect(inventory?.notSelling.items.map((line) => line.name)).toEqual(['Cable THW', 'Pintura']);
    expect(inventory?.notSelling.items[1]).toMatchObject({ valueCents: 50_000, stockMilli: 5_000 });
    // A product that was given up never shows in the lists.
    expect(JSON.stringify(inventory)).not.toContain('Descontinuado');
  });

  it('cuts a long list at 50 and says how many there are', () => {
    for (let index = 0; index < 60; index += 1) {
      fixture.stock(fixture.product(`Producto ${String(index).padStart(2, '0')}`, 'piece'), 1_000);
    }

    const { notSelling, withoutCost } = ownerSummary().inventory!;

    expect(notSelling.total).toBe(62);
    expect(notSelling.items).toHaveLength(50);
    expect(withoutCost.total).toBe(60);
  });
});

describe('who sees what', () => {
  function cashierSummary(overrides: Partial<DashboardRequest> = {}): DashboardSummary {
    const result = service.summary(request(overrides), cashier);
    if (result.status !== 'ok') {
      throw new Error(`expected a summary, got ${result.status}`);
    }
    return result.summary;
  }

  it('gives a cashier only the sales of their own shift, with no costs, profit or inventory', () => {
    const ana = fixture.session('2026-11-12T14:00:00.000Z', null);
    fixture.sale({ at: '2026-11-12T15:00:00.000Z', lines: [{ productId: hammer, milli: 1_000 }], cashierId: cashier.id, sessionId: ana });
    fixture.sale({ at: '2026-11-12T16:00:00.000Z', lines: [{ productId: hammer, milli: 2_000 }], cashierId: owner.id, sessionId: ana });
    // A sale of Ana in an older shift stays out.
    const older = fixture.session('2026-11-11T14:00:00.000Z', '2026-11-11T22:00:00.000Z');
    expect(older).toBeTruthy();

    const summary = cashierSummary({ topMetric: 'profit' });

    expect(summary).toMatchObject({ scope: 'shift', includesCosts: false, previousPeriod: null, previousTotals: null, byCashier: null, inventory: null });
    expect(summary.totals).toMatchObject({ salesCount: 1, totalCents: 11_600, costOfGoodsCents: null, grossProfitCents: null, marginBp: null });
    // «Por utilidad» is not available without costs, so it falls back to the amount.
    expect(summary.topMetric).toBe('amount');
    expect(summary.topSellers[0]).toMatchObject({ name: 'Martillo', profitCents: null, costE6: null, costSource: null });
    expect(JSON.stringify(summary)).not.toMatch(/costE6":\d|profitCents":\d|costOfGoodsCents":\d/);
  });

  it('shows a cashier with no open register the last shift they sold in', () => {
    const shift = fixture.session('2026-11-11T14:00:00.000Z', null);
    fixture.sale({ at: '2026-11-11T15:00:00.000Z', lines: [{ productId: hammer, milli: 1_000 }], cashierId: cashier.id, sessionId: shift });
    fixture.closeSession(shift, '2026-11-11T22:00:00.000Z');

    expect(cashierSummary().totals.salesCount).toBe(1);
  });

  it('shows a cashier with no shift nothing', () => {
    expect(cashierSummary().totals).toMatchObject({ salesCount: 0, totalCents: 0 });
  });

  it('gives a cashier the whole summary with the PIN of an owner, and writes a wrong PIN in the audit log', () => {
    seedTheDay();

    const refused = service.summary(request({ ownerPin: '0000' }), cashier);
    const approved = service.summary(request({ ownerPin: '4321' }), cashier);

    expect(refused).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });
    expect(approved.status === 'ok' && approved.summary).toMatchObject({ scope: 'business', includesCosts: true });
    const entries = store.prepare("SELECT user_id AS userId, action FROM audit_log WHERE action = 'report.dashboard_denied'").all() as unknown as { userId: string; action: string }[];
    expect(entries).toEqual([{ userId: cashier.id, action: 'report.dashboard_denied' }]);
  });

  it('locks after too many wrong PINs', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      service.summary(request({ ownerPin: '0000' }), cashier);
    }

    expect(service.summary(request({ ownerPin: '4321' }), cashier)).toMatchObject({ status: 'locked' });
  });

  it('refuses a day that does not exist', () => {
    expect(() => service.summary(request({ date: '2026-02-30' }), owner)).toThrow(RangeError);
    expect(() => service.summary(request({ period: 'custom', date: '2026-11-10', endDate: '2026-11-01' }), owner)).toThrow(RangeError);
  });
});

describe('the speed of a year of sales', () => {
  it('answers in less than 300 ms with thousands of sales', () => {
    const products = Array.from({ length: 300 }, (_, index) => fixture.product(`Producto ${index}`, index % 3 === 0 ? 'meter' : 'piece', { costE6: 1_000_000 + index * 10_000 }));
    for (const product of products) {
      fixture.stock(product, 500_000, 900_000);
    }
    const session = fixture.openSession();
    const statements = {
      sale: store.prepare('INSERT INTO sale (id, tenant_id, idempotency_key, status, subtotal_cents, tax_cents, total_cents, occurred_at, cash_session_id, cashier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      line: store.prepare(
        'INSERT INTO sale_line (id, tenant_id, sale_id, line_number, product_id, product_name, unit, quantity_milli, unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      payment: store.prepare('INSERT INTO payment (id, tenant_id, sale_id, method, amount_cents, reference, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      done: store.prepare("UPDATE sale SET status = 'completed', resolved_at = ?, folio = ? WHERE id = ?"),
      stock: store.prepare('INSERT INTO stock_movement (id, tenant_id, product_id, type, quantity_milli, source, source_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    };
    const salesToWrite = 5_000;
    store.transaction(() => {
      for (let index = 0; index < salesToWrite; index += 1) {
        const saleId = uuidV7();
        const moment = new Date(Date.UTC(2026, 0, 1) + Math.floor((index * 364 * 86_400_000) / salesToWrite) + 36_000_000).toISOString();
        statements.sale.run(saleId, TENANT, uuidV7(), 'pending_payment', 3_000, 480, 3_480, moment, session, 'fixture-cashier');
        for (let line = 0; line < 3; line += 1) {
          const lineId = uuidV7();
          const productId = products[(index * 7 + line * 13) % products.length]!;
          statements.line.run(lineId, TENANT, saleId, line + 1, productId, 'Producto', 'piece', 1_000, 11_600 * 100, 'rate', 1_600, 1_000, 160, 1_160);
          statements.stock.run(uuidV7(), TENANT, productId, 'sale', -1_000, 'sale_line', lineId, moment);
        }
        statements.payment.run(uuidV7(), TENANT, saleId, index % 3 === 0 ? 'card' : 'cash', 3_480, index % 3 === 0 ? 'REF' : null, moment);
        statements.done.run(moment, index + 1, saleId);
      }
    });

    const timings: number[] = [];
    let summary: DashboardSummary | null = null;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      summary = ownerSummary({ period: 'year', date: '2026-06-15', topLimit: 50 });
      timings.push(performance.now() - started);
    }

    expect(summary?.totals.salesCount).toBe(salesToWrite);
    expect(summary?.totals.lineCount).toBe(salesToWrite * 3);
    expect(summary?.topSellers).toHaveLength(50);
    // The first run opens the caches of the database, so the best of three is what a second look at the screen costs.
    expect(Math.min(...timings)).toBeLessThan(300);
  }, 60_000);
});
