# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Kenichiii999/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Kenichiii999/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols and writes a web dashboard that ranks the 198 pre-token, standalone protocols by what their launch would be worth, each with a costed farm plan and a FARM / MARGINAL / SKIP verdict.

## The model ("comps-2")

Implied value follows from the snapshot's own figures — no hardcoded names:

- **Size curve, fitted on traded tokens:** `log10(mcap) ≈ 3.3823 + 0.4721 · log10(TVL)`, fit on the 119 traded non-CEX protocols. Forward TVL carries the 7-day change forward (clamped −20%…+20%).
- **Category premium:** median `actual mcap / curve prediction` per category, shrunk toward 1, clamped [0.05, 5].
- **Launch odds:** survival-style per category + age — the token rate among the oldest third of the category (`pEver`) against the rate among protocols at least as old as this one (`pByAge`); odds = `(pEver − pByAge) / (1 − pByAge)`, clamped [0.02, 0.95].
- **Implied value** = value-if-it-launches × launch odds. Every row also carries a P10–P90 value range (from leave-one-out residuals) and a rank range (P10–P90 over 100 bootstrap refits).

## Validation (computed in-program, shown on the board)

| Check | Result |
|---|---|
| Leave-one-out median miss | **3.74×** (47.9% within 3×) |
| Range calibration | 49.6% inside P25–P75 (nominal 50%), 79.8% inside P10–P90 (nominal 80%) |
| Walk-forward (fit older 60, test newer 59) | **2.92×** median miss |
| Launch-odds signal, held out | **62.4%** vs 54.9% base rate |
| Flat-median-multiple baseline | 4.94× median miss (the curve beats it) |

Board: **198 rows** (all 40 watchlist protocols covered, ranks 4–168), total implied value **$428.1M**. Farm verdicts at plan size, 7% drop share: **FARM 25 · MARGINAL 61 · SKIP 112**. The accounting bar accounts for all 758 protocols: 198 ranked, 416 already have a token, 43 bridge, 43 liquid staking / restaking, 42 exchange custody, 11 versioned, 5 wrapped / staked by name.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (24 works). Writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. The dashboard is static, no network: open `out/dashboard/index.html` in a browser.

---

<sub>Entered on [make.fun](https://make.fun/?ref=9v6tjk8q&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
