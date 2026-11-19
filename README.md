# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Kenichiii999/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Kenichiii999/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols and writes a web dashboard that ranks the 197 pre-token, standalone protocols by what their launch would be worth, each with a costed farm plan and a FARM / MARGINAL / SKIP verdict.

## The model ("comps-10" — comps-9 + detail-view farm depth in shot 2: visual 8-step timeline strip, break-even stop rule, model line + log-scale P10–P90 bar + 7-day TVL spark in the detail head; 198th-row angle verified dead, board stays 197)

comps-10 keeps the comps-9 model and layout unchanged and makes the farm plan visible at a glance in the detail view: the plan now opens with a colour-coded timeline strip (one numbered cell per step) above the "Plan timeline" legend, a stop rule derived from the row's own verdict table (break-even drop share, net at 3.5% and 14%), and the detail head repeats the model ("implied = 10^3.3823 × forward TVL^0.4721 × premium × odds · launch odds 74% held out vs 55% base · LOO miss ×3.03 vs flat ×4.94") beside a log-scale P10–P90 range bar and a 7-day TVL spark (TVL 7 days ago → today, from the snapshot's own 7-day change). The 198th row was checked and does not exist under our own rules: all 145 excluded pre-token protocols fail at least one rule (37 bridge incl. circle-gateway, 29 liquid-staking, 37 CEX, 11 versioned, 5 wrapped/staked), so the board stays 197 rows. See MODEL_NOTES.md.

Implied value follows from the snapshot's own figures — no hardcoded names:

- **Size curve, fitted on traded tokens:** `log10(mcap) ≈ 3.3823 + 0.4721 · log10(TVL)`, fit on the 119 traded non-CEX protocols. Forward TVL carries the 7-day change forward (clamped −20%…+20%).
- **Category premium:** median `actual mcap / curve prediction` over the category's live peers, shrunk toward 1 (k = 4), clamped [0.05, 5] — but only when the category has at least 5 live peers; fewer peers earn 1.0 (no premium).
- **Launch odds:** survival-style from a ridge logistic model (λ = 3) of P(has token) fitted on the snapshot: 6 age bins + a missing-age dummy + log TVL + TVL relative to its category + 7-day change + chain count + Ethereum-first + category + top-8 first-chain dummies. Odds = `(pEver − F(t)) / (1 − F(t))`, clamped [0.02, 0.95], where F(t) is the model's P(has token) at the protocol's own age and pEver its highest P at any age.
- **Implied value** = value-if-it-launches × launch odds. Every row also carries a P10–P90 value range (from leave-one-out residuals) and a rank range (P10–P90 over 100 bootstrap refits).

## Validation (computed in-program, shown on the board)

| Check | Result |
|---|---|
| Leave-one-out median miss | **3.03×** (48.7% within 3×) |
| Range calibration | 49.6% inside P25–P75 (nominal 50%), 79.8% inside P10–P90 (nominal 80%) |
| Walk-forward (fit older 60, test newer 59) | **2.97×** median miss |
| Launch-odds signal, held out | **73.75%** vs 54.9% base rate (Brier 0.1835, log-loss 0.5478; independent exact leave-one-out refit also 73.75%) |
| Flat-median-multiple baseline | 4.94× median miss (the curve beats it) |

Board: **197 rows** (all 40 watchlist protocols covered, ranks 1–182; 26 of the top 40 rows are watchlist), total implied value **$992.7M**. Farm verdicts at plan size, 7% drop share: **FARM 59 · MARGINAL 66 · SKIP 72**. The accounting bar accounts for all 758 protocols: 197 ranked, 416 already have a token, 44 bridge, 43 liquid staking / restaking, 42 exchange custody, 11 versioned, 5 wrapped / staked by name.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (24 works). Writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. The dashboard is static, no network: open `out/dashboard/index.html` in a browser.

---

<sub>Entered on [make.fun](https://make.fun/?ref=9v6tjk8q&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
