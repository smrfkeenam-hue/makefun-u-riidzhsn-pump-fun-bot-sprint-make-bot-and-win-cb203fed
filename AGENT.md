# Agent build notes — Pump.fun Bot Sprint

Competition: u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed
Harness: pumpfun-replay/v2, Node 22, capital 10 SOL, max 5 open positions,
max order 1% of a mint's real SOL reserve, max 16 orders per batch, fees
95bps protocol + 30bps creator + 105,000 lamports tx fee per order, 2-slot
fill latency (orders decided on slot s fill at slot s + 2). Minimum bar: a
round trip of >= 0.01 SOL on each of >= 20 coins, max drawdown <= 50%.
Two runs must agree byte for byte (deterministic: no clock, no env, no
unseeded randomness). Ranked by net PnL; must be > 0 SOL to win anything.
Final window: 6h of fresh pump.fun data after entries close (28 Nov 16:00
WITA). Dev dataset: 24h sample 2–3 Nov, 1,222 mints, 126,801 trades.

## Strategy (v9, final)

Fast momentum scalper. Entry only when a coin has proven demand:
- price +10% to +80% from its first print, >= 4 trades, momentum fresh
  (<= 12,000 slots old)
- buy SOL volume >= 60% of total flow
- **5 consecutive buys, each printing higher than the last trade** — the key
  filter: on the dev tape a 3-trade rising sequence wins 28% of trades, a
  5-trade sequence wins 33–36%
- real SOL reserves >= 5 (liquidity floor; also makes the 1% size cap exactly
  the 0.05 SOL entry)

Size 0.05 SOL, max 2 new entries per batch, max 5 open positions, one entry
per mint. A rejected/failed buy leaves the mint eligible to retry.

Exits (all vs the filled entry price, i.e. SOL spent / tokens received):
take profit +25%, stop loss -10%, trailing stop armed at +8% that sells on
an 8% pullback from the peak, stale exit after 2,000 slots flat under +3%.

## Why this shape

A 0.05 SOL round trip costs ~3% in fees, so the win target must clear the
fee line and exits must be fast. The launch pop cannot be bought and held:
with 2-slot fill latency the pop is over by the time a bot can act, and the
price mean-reverts — every wide-target variant graded worse (v5 TP +54%:
-1.53 SOL; v6 deep-breakout TP +60%: -0.33 SOL on only 74 trades). The
trailing stop is what keeps the average loss small. Exit speed does NOT
throttle the trade count (v7 fast exits and v8 slow exits both traded 433
times); the entry filter does. So this version tightens the ENTRY (5-trade
rising sequence + 5 SOL reserve floor) and keeps the best-graded exits.

## Local validation (grade-local, --driver process, dev dataset)

| ver | shape | net PnL | trades | win rate | max DD |
|-----|-------|---------|--------|----------|--------|
| v1 | mom +18%, TP+30/SL-15, trail 12/10 | -0.89 SOL | 300 | 36% | — |
| v2 | mom +10%, streak>=3, TP+25/SL-10, trail 8/8 | -0.23 SOL | 176 | 25.6% | — |
| v3 | mom, TP+20/SL-10, tight trail/stale | -1.20 SOL | 468 | 23.5% | — |
| v4 | mom +30%, TP+30/SL-15 | -1.04 SOL | 347 | 28% | — |
| v5 | mom +30%, TP+54/SL-10, no trailing | -1.53 SOL | 424 | 14.2% | — |
| v6 | deep breakout real>=30, TP+60/SL-15, trail 13/10 | -0.33 SOL | 74 | 40.5% | 4.3% |
| v7 | mom +10%, streak>=3, TP+20/SL-8, trail 5/5 | -0.73 SOL | 433 | 26.3% | 7.5% |
| v8 | mom +10%, streak>=3, TP+30/SL-12, trail 10/10 | -1.15 SOL | 433 | 24.5% | 11.7% |
| v9 | mom +10%, streak>=5, real>=5, TP+25/SL-10, trail 8/8 | **-0.43 SOL** | **253** | **30.0%** | **4.8%** |

v9 detail: 253 round trips on 253 distinct mints (minimum bar met, 253 >= 20),
506 fills, 152 rejected orders (slippage retries), 6 failed txs, curve fees
0.312 SOL + tx fees 0.054 SOL, top-3 coins = 14.3% of gross gains, net
without top 3 = -0.57 SOL. Honest read: NO version is profitable on the dev
tape — the tape is mean-reverting after entry and fees take ~3% per round
trip. v9 is the best-tested momentum config (best win rate among the
high-count versions, lowest per-trade loss at -3.4%); the final 6h window is
fresh data, so the dev result is a guide, not a forecast.

## Stress test (grade-local --stress, 20 rebuilt copies)

20/20 copies ran OK, 0 failed. Median net PnL **-0.70 SOL**, p10 **-0.86 SOL**,
p90 **-0.46 SOL**; **all 20 copies lost money**. Dev score (-0.43 SOL) ranks
18 of 20 — it is above 90% of the rebuilt copies, i.e. the dev window
flattered the bot and the typical rebuilt copy does worse. Kit warnings:
"the dev score is above 90% of the rebuilt copies of the dev window" and
"half or more of the rebuilt copies lost money". The strategy has no
positive-expectation evidence on any resampled window; the final 6h tape is
fresh data, so the entry is a lottery ticket on a new draw, not a proven edge.

## Determinism

Two separate grade-local runs on the dev dataset produce byte-identical
action logs: action_log_sha256
4d19b7b39e721a1d4ad203260df59530c85c0bff104e98ee4108af463fe25c02 in both runs,
same net PnL -428,349,301 lamports. Deterministic: no clock, no environment,
no unseeded randomness (all decisions come from the hello seed and the
batches themselves).

## Files

- `main.ts` — the bot (imports `./vendor/makefun-bot.ts`, Node stdlib only)
- `vendor/makefun-bot.ts` — the kit SDK, byte-identical copy
  (sha256 4e243d4a0adce99b66b6124dd5a9c06867a92f7a0dd03dc6d65195f2f9ebbf08)
- `README.md` — 3 badges in the new make.fun format
- `LICENSE` — MIT, SPDX identifier on the first line
