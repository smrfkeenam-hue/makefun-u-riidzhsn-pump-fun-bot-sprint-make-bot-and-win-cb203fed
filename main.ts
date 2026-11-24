// Pump.fun Bot Sprint — fast momentum scalper (agent-fun/replay/v2).
//
// How the protocol works: the harness sends one hello, then one batch of orders
// per slot; orders decided on the batch for slot s fill at slot s + 2 (latency).
// Every reply carries at most 16 orders and the two runs must agree byte for byte,
// so nothing here reads the clock, the environment or unseeded randomness.
//
// Why this shape: offline analysis of the 24h dev tape (1,222 mints) with a
// faithful fill model, plus real grade-local runs, shows the launch pop cannot be
// bought and held — by the time a bot can act (2-slot fill latency) the pop is
// over and the price mean-reverts, so wide targets (+50-60%) bleed ~7% per trade
// (v6 deep-breakout grade: -0.33 SOL). The least-bad shape is a momentum
// scalper: enter early (+10% from first print) only on a confirmed rising
// sequence, then exit on a medium horizon. Grades so far: v2 (streak>=3,
// TP +25%, SL -10%, trail +8%/-8%, stale 2,000) -0.23 SOL / 176 trades — best
// total; v7 (faster exits) -0.73 SOL / 433 trades; v8 (slower exits) -1.15 SOL /
// 433 trades — exit speed does not throttle the trade count, the entry filter
// does. This version (v9) tightens the ENTRY instead: 5 consecutive rising buys
// (sim win rate 33-36% vs 28% at streak 3) plus a 5 SOL real-reserve floor
// (sim -3.1%/trade vs -3.5% without it), keeping v2's exits.
//
// Fees: ~95bps protocol + 30bps creator per side plus 105,000 lamports of tx fee
// per order, about 3% of a 0.05 SOL round trip — the fast exits keep the bot from
// paying that fee on long, hopeless holds. One entry per mint, at most 5 open
// positions, at most 2 new entries per batch.
//
// Terms the harness uses: hello (seed, caps, fees, latency), batch (one slot of
// events, marks and fills), orders (the buys/sells decided on this slot).

import { runBot, LAMPORTS_PER_SOL } from './vendor/makefun-bot.ts';
import type { Batch, BotState } from './vendor/makefun-bot.ts';

const SOL = LAMPORTS_PER_SOL; // 1_000_000_000n
const TARGET_BUY = (SOL * 5n) / 100n; // 0.05 SOL per entry
const MIN_BUY = (SOL * 15n) / 1000n; // 0.015 SOL: below this the fixed tx fees eat the trade
const MAX_POSITIONS = 5;
const MAX_NEW_PER_BATCH = 2;

const ENTRY_RISE_MIN = 1.1; // +10% from first print: enter early, before the pop is spent
const ENTRY_RISE_MAX = 1.8; // never chase past +80%
const ENTRY_BUY_SHARE = 0.6; // buy SOL volume share of flow
const ENTRY_MIN_TRADES = 4;
const ENTRY_MIN_UP_STREAK = 5; // 5 consecutive buys, each printing higher: the
// key filter. The dev-tape sim shows streak>=3 wins 28% of trades, streak>=5
// wins 33-36% — a 5-trade rising sequence is sustained buying, not one-slot noise.
const ENTRY_MAX_AGE_SLOTS = 12000; // momentum must be fresh
const MIN_RESERVE = (SOL * 5n); // need >= 5 SOL real reserves: another quality
// filter (sim: streak>=5 alone -3.5%/trade, streak>=5 + real>=5 -3.1%/trade,
// win rate 36%). The 1% order cap at 5 SOL real is exactly the 0.05 SOL size.

// Exits (v2's set — the best-graded exits so far): medium horizon, trailing
// stop arms at +8% and sells on an 8% pullback from the peak.
const TAKE_PROFIT = 1.25; // +25% from entry cost basis
const STOP_LOSS = 0.9; // -10%
const TRAIL_ARM = 1.08; // trailing stop arms once the price is +8% over entry
const TRAIL_DROP = 0.92; // then sells on an 8% pullback from the peak
const STALE_SLOTS = 2000; // ~7 min flat: exit if still below +3% after this long
const STALE_RISE = 1.03;
const SLIPPAGE_BPS = 500;

interface Coin {
  firstPrice: number;
  firstSlot: number;
  buyVol: bigint;
  sellVol: bigint;
  trades: number;
  lastPrice: number;
  upStreak: number; // consecutive buy trades each printing higher than the last
}

function priceOf(curve: { virtual_quote_reserves: bigint; virtual_token_reserves: bigint }): number {
  const q = Number(curve.virtual_quote_reserves);
  const t = Number(curve.virtual_token_reserves);
  return t > 0 ? q / t : 0;
}

const coins = new Map<string, Coin>();
const entered = new Set<string>(); // mints with a filled buy (one entry per mint)
const sentBuys = new Map<string, string>(); // client_id -> mint, until its fill arrives
const entrySlot = new Map<string, number>();
const peakRatio = new Map<string, number>();
let orderNo = 0;

function nextId(): string {
  orderNo += 1;
  return `b${orderNo}`;
}

await runBot({
  onHello(_state: BotState): void {
    // Nothing to seed: every decision below comes from the batches themselves.
  },

  onBatch(state: BotState, batch: Batch) {
    const out: Array<
      | { side: 'buy'; mint: string; quote_lamports: bigint; max_slippage_bps: number; client_id: string }
      | { side: 'sell'; mint: string; token_amount: bigint; max_slippage_bps: number; client_id: string }
    > = [];

    // 1. Fold this batch's fills: a filled buy marks the mint entered (one entry
    // per mint); a rejected/failed buy leaves it eligible to retry.
    for (const fill of batch.fills) {
      const mint = sentBuys.get(fill.client_id);
      if (mint === undefined) continue;
      sentBuys.delete(fill.client_id);
      if (fill.status === 'filled' && fill.side === 'buy') {
        entered.add(mint);
        entrySlot.set(mint, batch.slot);
        peakRatio.set(mint, 1);
      }
    }

    // 2. Fold this batch's events into per-coin flow stats. Prices come from
    // each event's own post-trade reserves, so the up-streak sees trade order.
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        if (!coins.has(e.mint)) {
          const p = Number(e.virtual_sol_reserves) / Number(e.virtual_token_reserves);
          coins.set(e.mint, {
            firstPrice: p,
            firstSlot: e.slot,
            buyVol: 0n,
            sellVol: 0n,
            trades: 0,
            lastPrice: p,
            upStreak: 0,
          });
        }
      } else if (e.event === 'TradeEvent') {
        const p = Number(e.virtual_sol_reserves) / Number(e.virtual_token_reserves);
        let coin = coins.get(e.mint);
        if (coin === undefined) {
          coin = { firstPrice: p, firstSlot: e.slot, buyVol: 0n, sellVol: 0n, trades: 0, lastPrice: p, upStreak: 0 };
          coins.set(e.mint, coin);
        }
        if (e.is_buy) {
          coin.buyVol += BigInt(e.sol_amount);
          coin.upStreak = p > coin.lastPrice ? coin.upStreak + 1 : 0;
        } else {
          coin.sellVol += BigInt(e.sol_amount);
          coin.upStreak = 0;
        }
        coin.lastPrice = p;
        coin.trades += 1;
      } else {
        // CompleteEvent: curve is over; forget it so no order ever targets it.
        coins.delete(e.mint);
      }
    }

    // 3. Exits first: free slots and lock in wins before looking for new entries.
    for (const [mint, holding] of state.positions) {
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const entryPrice = Number(holding.cost_lamports) / Number(holding.token_amount);
      const cur = priceOf(curve);
      if (entryPrice <= 0 || cur <= 0) continue;
      const ratio = cur / entryPrice;
      const peak = Math.max(peakRatio.get(mint) ?? 1, ratio);
      peakRatio.set(mint, peak);
      const held = batch.slot - (entrySlot.get(mint) ?? batch.slot);
      const exit =
        ratio >= TAKE_PROFIT ||
        ratio <= STOP_LOSS ||
        (peak >= TRAIL_ARM && ratio <= peak * TRAIL_DROP) ||
        (held >= STALE_SLOTS && ratio < STALE_RISE);
      if (exit) {
        out.push({
          side: 'sell',
          mint,
          token_amount: holding.token_amount,
          max_slippage_bps: SLIPPAGE_BPS,
          client_id: nextId(),
        });
        peakRatio.delete(mint);
        entrySlot.delete(mint);
      }
    }

    // 4. Entries: only with a free position slot, only on proven momentum.
    const freeSlots = MAX_POSITIONS - state.committedPositionCount();
    if (freeSlots > 0) {
      let added = 0;
      for (const [mint, curve] of state.curves) {
        if (added >= Math.min(MAX_NEW_PER_BATCH, freeSlots)) break;
        if (curve.complete || entered.has(mint)) continue;
        if (state.positions.has(mint)) continue;
        if ([...sentBuys.values()].includes(mint)) continue;
        const coin = coins.get(mint);
        if (coin === undefined || coin.firstPrice <= 0) continue;
        if (coin.trades < ENTRY_MIN_TRADES) continue;
        if (coin.upStreak < ENTRY_MIN_UP_STREAK) continue;
        if (batch.slot - coin.firstSlot > ENTRY_MAX_AGE_SLOTS) continue;
        const cur = priceOf(curve);
        const rise = cur / coin.firstPrice;
        if (rise < ENTRY_RISE_MIN || rise > ENTRY_RISE_MAX) continue;
        const flow = coin.buyVol + coin.sellVol;
        if (flow === 0n) continue;
        const buyShare = Number(coin.buyVol) / Number(flow);
        if (buyShare < ENTRY_BUY_SHARE) continue;
        if (curve.real_quote_reserves < MIN_RESERVE) continue;
        const cap = state.maxBuyLamports(mint);
        let size = TARGET_BUY < cap ? TARGET_BUY : cap;
        const free = state.freeCashLamports() - SOL / 10n; // keep a 0.1 SOL cash buffer
        if (size > free) size = free;
        if (size < MIN_BUY) continue;
        const id = nextId();
        sentBuys.set(id, mint);
        out.push({ side: 'buy', mint, quote_lamports: size, max_slippage_bps: SLIPPAGE_BPS, client_id: id });
        added += 1;
      }
    }

    return out;
  },

  onDone(_state: BotState): void {
    // The harness flattens positions; nothing to do.
  },
});
