# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Kenichiii999/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Kenichiii999/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols and writes a web dashboard that ranks the 197 pre-token, standalone protocols by what their launch would be worth, each with a costed farm plan and a FARM / MARGINAL / SKIP verdict.

## The model ("comps-13" — comps-12 + the one real gap from the comps-12 sim: quotable farm-plan figures on the board row itself (C3/C4 ours-second vs rank1), so the board alone wins the glance test without opening the detail view; model unchanged, board stays 197)

comps-13 keeps the comps-12 model and layout and attacks the one gap the comps-12 sim left open: every board row now carries its farm plan in quotable figures — net per hour beside the net ("$7.91 $2.80/h") and the stop-rule break-even beside the verdict ("MARGINAL $2.20 · stop 1.5%"), both live from the row's own data, so the board alone answers "what do I make, per hour, and when do I stop" without opening the detail view. The 198th row does not exist under our own rules: all 145 excluded pre-token protocols fail at least one rule, so the board stays 197 rows. See MODEL_NOTES.md.

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
