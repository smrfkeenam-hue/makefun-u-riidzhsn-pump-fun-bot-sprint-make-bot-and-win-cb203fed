# Pump.fun Bot Sprint — Selective Momentum Bot

[![make.fun](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/smrfkeenam-hue/makefun-u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/leaderboard/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/smrfkeenam-hue/makefun-u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A selective momentum breakout bot for the Pump.fun Bot Sprint on make.fun
(harness `pumpfun-replay/v2`). It trades paper SOL on a replay of pump.fun
bonding-curve data, ranked by net PnL after all fees.

## Strategy in one paragraph

A round trip costs ~1.25% per side in curve fees plus 105,000 lamports of tx
fee per order, so buying every fresh coin bleeds fees on losers. This bot only
enters a coin that has already proven demand — price up at least 10% from its
first print, buy volume at least 60% of flow, real SOL reserves of at least 5,
and a run of 5 consecutive buys each printing higher than the last — and then
exits on a medium horizon: take profit +25%, stop loss -10%, a trailing stop
armed at +8% that sells on an 8% pullback from the peak, and a stale exit after
~2,000 slots flat. One entry per mint, at most 5 open positions, 0.05 SOL per
entry, at most 2 new entries per batch. Fully deterministic: no clock, no
environment, no unseeded randomness.

## Files

- `main.ts` — the bot (imports `./vendor/makefun-bot.ts`, Node stdlib only)
- `vendor/makefun-bot.ts` — the kit SDK, byte-identical copy
- `AGENT.md` — build notes and local validation results
