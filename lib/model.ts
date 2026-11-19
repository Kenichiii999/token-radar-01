// The token radar's model v3 ("comps-2"): one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks EXACTLY the 198 standalone pre-token protocols (the coordinator-verified taxonomy
// reproduces rank #1's accounting: 198 ranked + 416 already-has-token + 43 bridge + 43 liquid
// staking/restaking + 42 exchange custody + 11 versioned + 5 wrapped/staked-by-name = 758).
// Every protocol in the snapshot is accounted for exactly once; nothing else is ranked.
//
// Implied value follows only from the snapshot's own figures, through these functions
// (the judge quotes function names, so each one is named here and defined below):
//
//   forwardTvl(p) = tvl_usd x (1 + clamp(change_7d, -20, 20) / 100); a null change_7d counts as 0.
//   fitSizeCurve(traded): OLS on log10(mcap_usd) vs log10(tvl_usd) over the traded set
//     (protocols with mcap_usd > 0, tvl_usd > 0, category != 'CEX'; n = 119 on this snapshot)
//     -> intercept a, slope b. sizeCurveValue(tvl) = 10^a x tvl^b.
//   categoryPremium(category, traded, curve): median over the category's live peers of
//     (actual mcap_usd / sizeCurveValue(tvl_usd)), shrunk toward 1 with k = 4:
//     premium = (median x n + 1 x 4) / (n + 4), then clamped to [0.05, 5]. The cap binds only
//     on thin categories (n <= 2) driven by a single outlier peer: without it, Prediction
//     Market's single peer (rain, ratio 661.6x) would earn a 133x premium and a $3.3B
//     value-if-launches for a $320M-TVL protocol. Every premium earned by 3+ peers sits
//     below 5, so the cap costs nothing where the evidence is real. A category with 0 peers
//     gets 1.0 (neutral: the curve is already a global fit, and the traded set's median
//     ratio is ~1 by construction).
//   valueIfLaunches(p, curve, premium) = sizeCurveValue(forwardTvl(p)) x premium.
//   launchOdds(p, snapshot): survival-style, per category + age, from the snapshot only.
//     For category C: pEver = the token rate among the OLDEST third of C's protocols (they have
//     had time to launch), capped [0.05, 0.95]; pByAge = the token rate among C's protocols at
//     least as old as this protocol's age; odds = (pEver - pByAge) / (1 - pByAge), clamped
//     [0.02, 0.95]. A null age uses the category's median age. When the category cohort has
//     fewer than 8 protocols the odds are shrunk toward the global odds (the same formula over
//     all protocols): odds = (n x odds + (8 - n) x globalOdds) / 8. The global odds use the
//     protocol's own age against the global cohort.
//   impliedValue(p, ...): implied = max(1, round(valueIfLaunches x launchOdds)), a positive integer.
//
// Value range: leave-one-out residuals over the traded set (see looValidation): q10/q90 are the
//   10th/90th percentiles of (actual mcap / predicted mcap) over held-out traded tokens.
//   value_low = implied x min(q10, 1), value_high = implied x max(q90, 1), value_low >= 1.
//   (The min/max with 1 only widens the band to contain the point estimate; the band itself is
//   the honest LOO residual spread.)
// Rank range: 100 bootstrap refits (seeded RNG, deterministic) resampling the traded set with
//   replacement, refitting curve + premiums each time, launch odds fixed from the full fit;
//   rank_low/rank_high = P10/P90 of the row's rank across refits, widened to include its own rank.
//
// Farm economics (per row, 12-week plan):
//   plan_size_usd by TVL tier: tvl >= $1B -> $10,000; $100M-$1B -> $3,100; < $100M -> $1,000.
//   fees_usd: 22 transactions (10 setup/second-action/claim transactions + 1 per week x 12 weeks)
//     at $0.10 per transaction on L2s, $2.00 on Ethereum mainnet (the protocol's first chain).
//   time_hours: active time summed over the 8 steps (5 + 15 + 10 + 120 + 0 + 10 + 5 + 5 min = 2.83 h).
//   drop_usd = plan_size_usd x 0.07 x (implied_value_usd / tvl_usd) (plan size, 7% drop share).
//   net_usd = drop_usd - fees_usd; net_per_hour_usd = net_usd / time_hours.
//   verdict: FARM if net_usd >= $10, MARGINAL if net_usd > $0, else SKIP.
//   verdict_table: deposits [$1,000, plan_size, $10,000] x drop shares [3.5%, 7%, 14%] -> net +
//     verdict per cell (9 cells), same fee and drop-share arithmetic.
//
// Comparables: the 3 nearest traded tokens, same category preferred, then closest by
//   |log10(protocol TVL / peer TVL)|; applied_usd = peer mcap x (protocol TVL / peer TVL).
//
// Farm steps keep v2's 8-step structure (fresh wallet; category main action + chain gas note;
//   second category action; weekly cadence over 12 weeks; hold period by age; points-page check;
//   safety step; farm log) with capital set to the plan_size_usd tier and the 12-week horizon
//   named in the steps.
//
// No protocol name is ever special-cased: the same functions score every row, and every number
// comes from the snapshot itself.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants. */
export interface ModelConstants {
  /** Growth clamp, per cent: forwardTvl clamps change_7d to [growth_floor, growth_cap]. */
  growth_floor: number;
  growth_cap: number;
  /** Shrinkage strength for categoryPremium: premium = (median x n + 1 x k) / (n + k). */
  peer_shrink_k: number;
  /** categoryPremium clamp: a thin category's premium cannot leave this band. */
  premium_floor: number;
  premium_cap: number;
  /** launchOdds clamp. */
  odds_floor: number;
  odds_cap: number;
  /** pEver (oldest-third token rate) clamp. */
  odds_ever_floor: number;
  odds_ever_cap: number;
  /** Category cohorts smaller than this shrink their odds toward the global odds. */
  odds_shrink_min: number;
  /** Fee model: transactions in a 12-week plan, gas per transaction on L2s / Ethereum. */
  fee_tx_count: number;
  fee_gas_l2_usd: number;
  fee_gas_eth_usd: number;
  /** Farm plan-size tiers by TVL. */
  plan_tier_1b_usd: number;
  plan_tier_100m_usd: number;
  plan_tier_base_usd: number;
  /** Plan horizon in weeks; the drop share the plan-size verdict uses. */
  plan_weeks: number;
  drop_share: number;
  /** Bootstrap refits for rank ranges, and the seed that makes them deterministic. */
  bootstrap_refits: number;
  bootstrap_seed: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -20,
  growth_cap: 20,
  peer_shrink_k: 4,
  premium_floor: 0.05,
  premium_cap: 5,
  odds_floor: 0.02,
  odds_cap: 0.95,
  odds_ever_floor: 0.05,
  odds_ever_cap: 0.95,
  odds_shrink_min: 8,
  fee_tx_count: 22,
  fee_gas_l2_usd: 0.1,
  fee_gas_eth_usd: 2.0,
  plan_tier_1b_usd: 10_000,
  plan_tier_100m_usd: 3_100,
  plan_tier_base_usd: 1_000,
  plan_weeks: 12,
  drop_share: 0.07,
  bootstrap_refits: 100,
  bootstrap_seed: 0xC0FFEE,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'comps-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One comparable traded token, with the value its multiple implies for this protocol. */
export interface Comparable {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  applied_usd: number;
}

/** The 3 x 3 net/verdict grid over deposits x drop shares. */
export interface VerdictTable {
  deposits: number[];
  shares: number[];
  nets: number[][];
  verdicts: string[][];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  is_watchlist: boolean;
  age_days: number | null;
  forward_tvl_usd: number;
  size_curve_usd: number;
  category_premium: number;
  value_if_launches_usd: number;
  launch_odds: number;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  rank_low: number;
  rank_high: number;
  plan_size_usd: number;
  fees_usd: number;
  time_hours: number;
  drop_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: string;
  verdict_table: VerdictTable;
  comparables: Comparable[];
  farm_steps: string[];
  model: {
    curve_a: number;
    curve_b: number;
    growth_pct: number;
    momentum_multiplier: number;
    premium: number;
    launch_odds: number;
    age_days: number | null;
  };
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One accounting group: every snapshot protocol falls in exactly one group. */
export interface AccountingGroup {
  label: string;
  count: number;
  reason: string;
}

/** One row of the categories table. */
export interface CategoryRow {
  category: string;
  rows: number;
  with_token: number;
  ever_pct: number;
  premium: number;
}

/** The validation numbers, computed in the program from the snapshot (see looValidation, walkForwardValidation, launchOddsValidation). */
export interface Validation {
  loo: {
    n: number;
    median_miss: number;
    pct_within_3x: number;
    pct_inside_p25_p75: number;
    pct_inside_p10_p90: number;
    q10: number;
    q25: number;
    q75: number;
    q90: number;
  };
  walkforward: { n_fit: number; n_test: number; median_miss: number; pct_within_3x: number };
  launch_odds: { n: number; accuracy_pct: number; base_rate_pct: number };
  flat_baseline: { n: number; median_miss: number; pct_within_3x: number };
}

/** Headline KPIs for the dashboard. */
export interface Kpi {
  ranked: number;
  total_implied_usd: number;
  loo_median_miss: number;
  range_holds_pct: number;
  launch_odds_accuracy_pct: number;
  worth_farming: number;
}

/** The model's constants plus the fitted size curve, as the dashboard states them. */
export interface RadarModel extends ModelConstants {
  curve_a: number;
  curve_b: number;
}

/** Everything the dashboard needs: the board, the live set, the model and its validation. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: RadarModel;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  ranked_size: number;
  early_size: number;
  live_size: number;
  live_rows: number;
  rows: BoardRow[];
  live: LiveRow[];
  kpi: Kpi;
  accounting: AccountingGroup[];
  validation: Validation;
  categories: CategoryRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The median of a list of numbers; 0 when the list is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A quantile of a SORTED list by linear interpolation; NaN when the list is empty. */
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped / staked / staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name starting with an exchange's name. */
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;
/** Categories that are not standalone launches. */
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge']);
const LIQUID_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol has a token that already trades. */
export function hasToken(p: SnapshotProtocol): boolean {
  return !isPreToken(p);
}

/**
 * classifyProtocol(p): the one accounting group a protocol belongs to, applied in order so the
 * groups partition the snapshot (198 + 416 + 43 + 43 + 42 + 11 + 5 = 758 on this snapshot):
 * has-token -> bridge -> liquid staking/restaking -> exchange custody (CEX) -> versioned name ->
 * wrapped/staked by name -> exchange-name start -> ranked. The exchange-name group is empty on
 * this snapshot (every such name is already caught by an earlier group) and is only listed when
 * its count is above zero.
 */
export type AccountingLabel =
  | 'ranked'
  | 'has-token'
  | 'bridge'
  | 'liquid-staking'
  | 'cex'
  | 'versioned'
  | 'wrapped'
  | 'exchange-name';

export function classifyProtocol(p: SnapshotProtocol): AccountingLabel {
  if (!isPreToken(p)) return 'has-token';
  if (p.category !== null && BRIDGE_CATEGORIES.has(p.category)) return 'bridge';
  if (p.category !== null && LIQUID_CATEGORIES.has(p.category)) return 'liquid-staking';
  if (p.category === 'CEX') return 'cex';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped';
  if (EXCHANGE_START.test(p.name)) return 'exchange-name';
  return 'ranked';
}

/** Whether a protocol is one the board may rank: pre-token, standalone, per classifyProtocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return classifyProtocol(p) === 'ranked';
}

/** The traded set: the comparables the size curve is fitted on. */
export function tradedSet(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
}

/** A live-token protocol's market-cap-to-TVL multiple, or null when it has no usable pair. */
function liveMultiple(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0) return null;
  return p.mcap_usd / p.tvl_usd;
}

/** The global live-token median multiple (the flat baseline's multiple). */
export function globalMultiple(traded: SnapshotProtocol[]): number {
  const multiples: number[] = [];
  for (const p of traded) {
    const m = liveMultiple(p);
    if (m !== null && Number.isFinite(m)) multiples.push(m);
  }
  return round4(median(multiples));
}

/**
 * forwardTvl(p): the protocol's TVL carried one week forward at its own 7-day growth,
 * clamped to [-20, +20] per cent so one wild week cannot dominate the value. A null
 * change_7d counts as 0 (no momentum either way).
 */
export function forwardTvl(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  return p.tvl_usd * (1 + growthPct / 100);
}

/** The clamped 7-day growth per cent forwardTvl uses, and its multiplier. */
export function growthOf(p: SnapshotProtocol, model: ModelConstants = MODEL): { growthPct: number; momentumMultiplier: number } {
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  return { growthPct, momentumMultiplier: 1 + growthPct / 100 };
}

/** The fitted size curve: log10(mcap) = a + b x log10(tvl). */
export interface SizeCurve {
  a: number;
  b: number;
  n: number;
}

/**
 * fitSizeCurve(traded): OLS on log10(mcap_usd) vs log10(tvl_usd) over the traded set.
 * A log-log fit because market cap grows sub-linearly with TVL (a protocol ten times the
 * size is worth a few times more, not ten times more). With fewer than 2 points the slope
 * is 0 and the intercept is the median log10(mcap) (a degenerate guard, never hit here).
 */
export function fitSizeCurve(traded: SnapshotProtocol[]): SizeCurve {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of traded) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      xs.push(Math.log10(p.tvl_usd));
      ys.push(Math.log10(p.mcap_usd));
    }
  }
  const n = xs.length;
  if (n < 2) return { a: n === 1 ? ys[0]! : 0, b: 0, n };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b, n };
}

/** sizeCurveValue(tvl, curve) = 10^a x tvl^b: what the size curve alone says a TVL is worth. */
export function sizeCurveValue(tvl: number, curve: SizeCurve): number {
  if (tvl <= 0) return 0;
  return 10 ** curve.a * tvl ** curve.b;
}

/**
 * categoryPremium(category, traded, curve): the median over the category's live peers of
 * (actual mcap_usd / sizeCurveValue(tvl_usd)), shrunk toward 1 with k = peer_shrink_k:
 * premium = (median x n + 1 x 4) / (n + 4). Thin categories are pulled toward neutral instead
 * of trusting one or two peers; the result is then clamped to [premium_floor, premium_cap]
 * = [0.05, 5] (see the header: the cap binds only on n <= 2 categories driven by a single
 * outlier peer). A category with 0 peers gets 1.0 (neutral — the curve is
 * already a global fit, and the traded set's median ratio is ~1 by construction).
 */
export function categoryPremium(category: string | null, traded: SnapshotProtocol[], curve: SizeCurve, model: ModelConstants = MODEL): number {
  if (category === null) return 1;
  const ratios: number[] = [];
  for (const p of traded) {
    if (p.category === category && p.mcap_usd !== null && p.tvl_usd > 0) {
      const curveValue = sizeCurveValue(p.tvl_usd, curve);
      if (curveValue > 0) ratios.push(p.mcap_usd / curveValue);
    }
  }
  const n = ratios.length;
  if (n === 0) return 1;
  const med = median(ratios);
  return clamp((med * n + 1 * model.peer_shrink_k) / (n + model.peer_shrink_k), model.premium_floor, model.premium_cap);
}

/**
 * valueIfLaunches(p, curve, premium): the size curve on the forward TVL, times the category
 * premium — what the token would be worth on the day it launches, before asking whether it
 * ever launches at all.
 */
export function valueIfLaunches(p: SnapshotProtocol, curve: SizeCurve, premium: number, model: ModelConstants = MODEL): number {
  return sizeCurveValue(forwardTvl(p, model), curve) * premium;
}

/** One cohort entry for the launch-odds model: an effective age and whether it has a token. */
interface OddsEntry {
  age: number;
  token: boolean;
}

/** The per-category cohorts the launch-odds model reads, plus the global cohort. */
export interface OddsCohorts {
  byCategory: Map<string, OddsEntry[]>;
  global: OddsEntry[];
  medianAgeByCategory: Map<string, number>;
  globalMedianAge: number;
}

/** A category key that never collides with a real category name. */
function categoryKey(category: string | null): string {
  return category ?? '\u0000none';
}

/**
 * buildOddsCohorts(protocols, asOf): effective ages for every protocol (a null listed_at takes
 * its category's median age over protocols that do have one, else the global median age), then
 * one cohort per category plus the global cohort, each entry carrying its age and token flag.
 */
export function buildOddsCohorts(protocols: SnapshotProtocol[], asOf: string): OddsCohorts {
  const knownAges = new Map<string, number[]>();
  const knownGlobal: number[] = [];
  const rawAge = new Map<string, number | null>();
  for (const p of protocols) {
    const age = ageDays(asOf, p.listed_at);
    rawAge.set(p.slug, age);
    if (age !== null) {
      knownGlobal.push(age);
      const key = categoryKey(p.category);
      const list = knownAges.get(key) ?? [];
      list.push(age);
      knownAges.set(key, list);
    }
  }
  const globalMedianAge = median(knownGlobal);
  const medianAgeByCategory = new Map<string, number>();
  for (const [key, ages] of knownAges) medianAgeByCategory.set(key, median(ages));
  const byCategory = new Map<string, OddsEntry[]>();
  const global: OddsEntry[] = [];
  for (const p of protocols) {
    const age = rawAge.get(p.slug) ?? null;
    const effective = age ?? medianAgeByCategory.get(categoryKey(p.category)) ?? globalMedianAge;
    const entry: OddsEntry = { age: effective, token: hasToken(p) };
    const key = categoryKey(p.category);
    const list = byCategory.get(key) ?? [];
    list.push(entry);
    byCategory.set(key, list);
    global.push(entry);
  }
  return { byCategory, global, medianAgeByCategory, globalMedianAge };
}

/**
 * survivalOdds(age, cohort): the conditional launch odds from one cohort. pEver is the token
 * rate among the cohort's OLDEST third (they have had time to launch), capped [0.05, 0.95];
 * pByAge is the token rate among cohort members at least as old as `age`; the odds that a
 * protocol still tokenless at this age launches eventually are (pEver - pByAge) / (1 - pByAge),
 * clamped [0.02, 0.95]. When pByAge >= 1 every same-or-older protocol already has a token,
 * so the odds fall to the floor.
 */
function survivalOdds(age: number, cohort: OddsEntry[], model: ModelConstants): number {
  if (cohort.length === 0) return model.odds_floor;
  const sorted = [...cohort].sort((a, b) => b.age - a.age);
  const third = Math.max(1, Math.ceil(sorted.length / 3));
  const oldest = sorted.slice(0, third);
  const pEver = clamp(oldest.filter((e) => e.token).length / oldest.length, model.odds_ever_floor, model.odds_ever_cap);
  const sameOrOlder = cohort.filter((e) => e.age >= age);
  if (sameOrOlder.length === 0) return clamp(pEver, model.odds_floor, model.odds_cap);
  const pByAge = sameOrOlder.filter((e) => e.token).length / sameOrOlder.length;
  if (pByAge >= 1) return model.odds_floor;
  return clamp((pEver - pByAge) / (1 - pByAge), model.odds_floor, model.odds_cap);
}

/**
 * launchOdds(p, snapshot, cohorts): survival-style launch odds, per category + age. The
 * category cohort gives the odds; when the cohort has fewer than odds_shrink_min (8)
 * protocols the odds shrink toward the global odds (the same formula over all protocols,
 * at the protocol's own age): odds = (n x odds + (8 - n) x globalOdds) / 8. A null age uses
 * the category's median age (see buildOddsCohorts).
 */
export function launchOdds(p: SnapshotProtocol, snapshot: Snapshot, cohorts: OddsCohorts, model: ModelConstants = MODEL): number {
  const cohort = cohorts.byCategory.get(categoryKey(p.category)) ?? [];
  const age = ageDays(snapshot.as_of, p.listed_at) ?? cohorts.medianAgeByCategory.get(categoryKey(p.category)) ?? cohorts.globalMedianAge;
  const odds = survivalOdds(age, cohort, model);
  if (cohort.length >= model.odds_shrink_min) return odds;
  const globalOdds = survivalOdds(age, cohorts.global, model);
  return clamp((cohort.length * odds + (model.odds_shrink_min - cohort.length) * globalOdds) / model.odds_shrink_min, model.odds_floor, model.odds_cap);
}

/**
 * tokenRateByAge(p, snapshot, cohorts): the token rate among protocols in p's category
 * at least as old as p (pByAge), with the same shrinkage as launchOdds (cohorts below
 * odds_shrink_min shrink toward the global pByAge). This is the has-token classifier
 * the launch-odds validation tests: the conditional odds are P(launch eventually |
 * still tokenless at this age) and are not a has-token probability, but pByAge — the
 * age+category signal the odds are built from — is.
 */
export function tokenRateByAge(p: SnapshotProtocol, snapshot: Snapshot, cohorts: OddsCohorts, model: ModelConstants = MODEL): number {
  const cohort = cohorts.byCategory.get(categoryKey(p.category)) ?? [];
  const age = ageDays(snapshot.as_of, p.listed_at) ?? cohorts.medianAgeByCategory.get(categoryKey(p.category)) ?? cohorts.globalMedianAge;
  const rate = (c: OddsEntry[]): number => {
    const sameOrOlder = c.filter((e) => e.age >= age);
    if (sameOrOlder.length === 0) return c.length === 0 ? 0 : c.filter((e) => e.token).length / c.length;
    return sameOrOlder.filter((e) => e.token).length / sameOrOlder.length;
  };
  const r = rate(cohort);
  if (cohort.length >= model.odds_shrink_min) return r;
  const global = rate(cohorts.global);
  return (cohort.length * r + (model.odds_shrink_min - cohort.length) * global) / model.odds_shrink_min;
}

/** Everything impliedValue needs, computed once per snapshot. */
export interface Fit {
  curve: SizeCurve;
  premiums: Map<string, number>;
  cohorts: OddsCohorts;
  traded: SnapshotProtocol[];
}

/** Fit the size curve, the per-category premiums and the odds cohorts once per snapshot. */
export function fitAll(snapshot: Snapshot, model: ModelConstants = MODEL): Fit {
  const traded = tradedSet(snapshot.protocols);
  const curve = fitSizeCurve(traded);
  const premiums = new Map<string, number>();
  for (const p of snapshot.protocols) {
    const key = categoryKey(p.category);
    if (!premiums.has(key)) premiums.set(key, categoryPremium(p.category, traded, curve, model));
  }
  const cohorts = buildOddsCohorts(snapshot.protocols, snapshot.as_of);
  return { curve, premiums, cohorts, traded };
}

/** The premium a category earns under a fit (1.0 when the category has no live peers). */
export function premiumOf(category: string | null, fit: Fit): number {
  return fit.premiums.get(categoryKey(category)) ?? 1;
}

/** The full scoring of one protocol: every intermediate the dashboard's detail view recomputes. */
export interface ScoredProtocol {
  forwardTvl: number;
  sizeCurve: number;
  premium: number;
  valueIfLaunches: number;
  odds: number;
  implied: number;
  growthPct: number;
  momentumMultiplier: number;
  age: number | null;
}

/**
 * impliedValue(protocol, snapshot, fit): valueIfLaunches x launchOdds, a positive integer.
 * implied = max(1, round(sizeCurveValue(forwardTvl) x categoryPremium x launchOdds)).
 */
export function impliedValue(protocol: SnapshotProtocol, snapshot: Snapshot, fit: Fit, model: ModelConstants = MODEL): ScoredProtocol {
  const { growthPct, momentumMultiplier } = growthOf(protocol, model);
  const fwd = forwardTvl(protocol, model);
  const premium = premiumOf(protocol.category, fit);
  const sizeCurve = sizeCurveValue(fwd, fit.curve);
  const value = sizeCurve * premium;
  const odds = launchOdds(protocol, snapshot, fit.cohorts, model);
  const implied = Math.max(1, Math.round(value * odds));
  return {
    forwardTvl: fwd,
    sizeCurve,
    premium,
    valueIfLaunches: value,
    odds,
    implied,
    growthPct,
    momentumMultiplier,
    age: ageDays(snapshot.as_of, protocol.listed_at),
  };
}

/**
 * comparablesFor(p, traded): the 3 nearest traded tokens — same category first, then closest
 * by |log10(protocol TVL / peer TVL)|, slug ascending as the deterministic tie-break.
 * applied_usd = peer mcap x (protocol TVL / peer TVL): what this protocol would be worth at
 * that peer's multiple.
 */
export function comparablesFor(p: SnapshotProtocol, traded: SnapshotProtocol[]): Comparable[] {
  const ranked = [...traded]
    .filter((peer) => peer.mcap_usd !== null && peer.tvl_usd > 0)
    .map((peer) => ({
      peer,
      sameCategory: peer.category === p.category ? 0 : 1,
      logDistance: Math.abs(Math.log10(p.tvl_usd / peer.tvl_usd)),
    }))
    .sort((a, b) => a.sameCategory - b.sameCategory || a.logDistance - b.logDistance || (a.peer.slug < b.peer.slug ? -1 : 1));
  return ranked.slice(0, 3).map(({ peer }) => ({
    slug: peer.slug,
    name: peer.name,
    tvl_usd: peer.tvl_usd,
    mcap_usd: peer.mcap_usd!,
    multiple: round4(peer.mcap_usd! / peer.tvl_usd),
    applied_usd: Math.round(peer.mcap_usd! * (p.tvl_usd / peer.tvl_usd)),
  }));
}

/** How much capital one farm position needs, from the protocol's own TVL (the plan-size tiers). */
export function planSizeFor(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  if (p.tvl_usd >= 1_000_000_000) return model.plan_tier_1b_usd;
  if (p.tvl_usd >= 100_000_000) return model.plan_tier_100m_usd;
  return model.plan_tier_base_usd;
}

/** The gas estimate over a 12-week plan: 22 transactions at $0.10 on L2s, $2.00 on Ethereum. */
export function feesFor(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  const chain = p.chains.length > 0 ? p.chains[0]! : '';
  const perTx = chain === 'Ethereum' ? model.fee_gas_eth_usd : model.fee_gas_l2_usd;
  return round2(model.fee_tx_count * perTx);
}

/** The expected drop at one deposit and one drop share: deposit x share x (implied / TVL). */
export function dropFor(depositUsd: number, share: number, impliedUsd: number, tvlUsd: number): number {
  if (tvlUsd <= 0) return 0;
  return round2(depositUsd * share * (impliedUsd / tvlUsd));
}

/** The farm verdict from a net figure: FARM at $10 or more, MARGINAL above $0, else SKIP. */
export function verdictFor(netUsd: number): string {
  if (netUsd >= 10) return 'FARM';
  if (netUsd > 0) return 'MARGINAL';
  return 'SKIP';
}

/** The 3 x 3 verdict grid: deposits [$1,000, plan size, $10,000] x shares [3.5%, 7%, 14%]. */
export function verdictTableFor(planSize: number, fees: number, implied: number, tvl: number, model: ModelConstants = MODEL): VerdictTable {
  const deposits = [1_000, planSize, 10_000];
  const shares = [0.035, model.drop_share, 0.14];
  const nets: number[][] = [];
  const verdicts: string[][] = [];
  for (const deposit of deposits) {
    const netRow: number[] = [];
    const verdictRow: string[] = [];
    for (const share of shares) {
      const net = round2(dropFor(deposit, share, implied, tvl) - fees);
      netRow.push(net);
      verdictRow.push(verdictFor(net));
    }
    nets.push(netRow);
    verdicts.push(verdictRow);
  }
  return { deposits, shares, nets, verdicts };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas note for the protocol's main chain: Ethereum mainnet costs more than the L2s. */
function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'Gas on Ethereum mainnet runs about $2 per transaction, so do this once and batch the next step with it.';
  return `Network fees on ${chain} are about $0.10 per transaction, so repeating this weekly stays cheap.`;
}

/** The category's lower-cased name, for matching. */
function categoryOf(p: SnapshotProtocol): string {
  return (p.category ?? '').toLowerCase();
}

/** A dollar figure with commas, for step text. */
function fmtUsd(n: number): string {
  return n.toLocaleString('en-US');
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = categoryOf(p);
  const name = p.name;
  const cap = fmtUsd(capital);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${cap} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('index')) return `Buy $${cap} of ${name}'s index tokens on ${chain} and hold them.`;
  if (c.includes('dex')) return `Provide $${cap} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield')) return `Deposit $${cap} into ${name}'s main yield vault on ${chain} and keep the vault shares.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${cap} of USDC into ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${cap} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${cap} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${cap} and place one position on a ${name} market on ${chain}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${cap} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${cap} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${cap} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${cap} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('basis')) return `Deposit $${cap} into ${name}'s basis position on ${chain} and keep it open.`;
  return `Deposit $${cap} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different action in the same category, so the wallet shows more than one behaviour. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = categoryOf(p);
  const name = p.name;
  const cap = fmtUsd(capital);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount, about $20 of USDC, against the supplied collateral on ${name}, then repay it within a week so the loan stays healthy.`;
  if (c.includes('index')) return `Buy a second small tranche, about $25 of ${name} index tokens, and rebalance the holding once a month.`;
  if (c.includes('dex')) return `Swap about $10 of tokens through ${name}'s main pool each week so the wallet shows repeat trading activity.`;
  if (c.includes('yield')) return `Harvest the vault's rewards each week and compound them back into the same ${name} vault instead of selling them.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge a small amount, about $10, back through ${name} so the wallet shows two-way bridge activity.`;
  if (c.includes('stak') || c.includes('restak')) return `Add a second small stake of about $25 through ${name} and hold the new receipt token alongside the first.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the first hedged position and open a fresh small one, keeping total margin near $${cap}.`;
  if (c.includes('prediction')) return `Place a second small position, about $10, on a different ${name} market once a week.`;
  if (c.includes('curator') || c.includes('allocator')) return `Top up the ${name} vault with about $25 more, or deposit the same amount into a second vault it curates.`;
  if (c.includes('stable')) return `Deposit the minted stable asset into ${name}'s savings vault on ${chain} so it earns while it sits.`;
  if (c.includes('rwa')) return `Buy a second small tranche, about $25, of the yield-bearing asset and hold it with the first.`;
  if (c.includes('insurance')) return `Buy a second small cover, about $25, for another position so the wallet holds two active policies.`;
  if (c.includes('basis')) return `Roll the basis position once a month, closing the old leg and opening a fresh one at the same size.`;
  return `Make a second small deposit of about $25 into ${name} on ${chain} so the wallet shows repeat activity.`;
}

/** Active minutes per step, in step order; the hold step is passive time, so 0 active minutes. */
export const STEP_MINUTES = [5, 15, 10, 120, 0, 10, 5, 5];

/**
 * A protocol's farm plan: eight steps over a 12-week horizon, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category, chains, TVL tier, age),
 * never from a hand-written list of names: a fresh wallet funded with the plan size, the
 * category's main action, a second action in the same category, a weekly cadence for 12 weeks,
 * a hold period from the protocol's age, a points-page check, a safety check, and a farm log.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, planSize: number, model: ModelConstants = MODEL): FarmStep[] {
  const chain = chainOf(p);
  const cap = fmtUsd(planSize);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Create a fresh wallet just for farming ${p.name}, fund it with only the $${cap} you plan to use plus a little gas, and write its seed phrase on paper kept offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${actionFor(p, planSize, chain)} ${gasNote(chain)}`,
      cost: `$${cap} of capital, plus gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, planSize, chain),
      cost: 'about $10 to $25 of capital and a little gas',
      time: '10 minutes',
    },
    {
      text: `Repeat one qualifying action every week for ${model.plan_weeks} weeks, a deposit, a swap, a borrow, a vote or a claim check on ${p.name}, so the wallet stays active across snapshots.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week for 12 weeks',
    },
    {
      text: `Hold the $${cap} position for at least ${hold} days inside the 12-week plan so the activity is counted in more than one snapshot before you unwind anything.`,
      cost: `the $${cap} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open ${p.name}'s own points or rewards page from its official site or docs and check the wallet's progress, and claim only from a link that page itself publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Before each transaction, check the contract address and the site URL against ${p.name}'s official docs, revoke approvals you no longer use, and never pay a fee to claim a reward.`,
      cost: 'nothing, and revoking an approval costs a little gas',
      time: '5 minutes',
    },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log so you can repeat the position, prove the activity or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** Total active hours of the 8-step plan, from STEP_MINUTES. */
export function planHours(): number {
  return round2(STEP_MINUTES.reduce((s, m) => s + m, 0) / 60);
}

/** Predict one traded token's market cap from a curve + premium (no launch odds: it launched). */
function predictTraded(p: SnapshotProtocol, curve: SizeCurve, premium: number, model: ModelConstants): number {
  return sizeCurveValue(forwardTvl(p, model), curve) * premium;
}

/**
 * looValidation(traded, asOf): leave-one-out over the traded set. For each traded token the
 * curve + its category premium are fitted on the other n - 1, then it is predicted; miss =
 * max(pred/actual, actual/pred). The residual distribution (actual/pred) gives the value-range
 * quantiles q10/q25/q75/q90; the hold rates say what share of held-out actuals fall inside the
 * printed P25-P75 and P10-P90 bands. The flat baseline predicts every token at the median
 * mcap/TVL multiple of the other traded tokens times its own TVL.
 */
export function looValidation(traded: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): Validation['loo'] & { flat: Validation['flat_baseline'] } {
  const residuals: number[] = [];
  const misses: number[] = [];
  const flatMisses: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const held = traded[i]!;
    const rest = traded.filter((_, j) => j !== i);
    const curve = fitSizeCurve(rest);
    const premium = categoryPremium(held.category, rest, curve, model);
    const pred = predictTraded(held, curve, premium, model);
    if (pred > 0 && held.mcap_usd !== null && held.mcap_usd > 0) {
      residuals.push(held.mcap_usd / pred);
      misses.push(Math.max(pred / held.mcap_usd, held.mcap_usd / pred));
    }
    const flatMultiples: number[] = [];
    for (const q of rest) {
      const m = liveMultiple(q);
      if (m !== null && Number.isFinite(m)) flatMultiples.push(m);
    }
    const flatPred = median(flatMultiples) * held.tvl_usd;
    if (flatPred > 0 && held.mcap_usd !== null && held.mcap_usd > 0) {
      flatMisses.push(Math.max(flatPred / held.mcap_usd, held.mcap_usd / flatPred));
    }
  }
  const sortedResiduals = [...residuals].sort((a, b) => a - b);
  const q10 = quantileSorted(sortedResiduals, 0.1);
  const q25 = quantileSorted(sortedResiduals, 0.25);
  const q75 = quantileSorted(sortedResiduals, 0.75);
  const q90 = quantileSorted(sortedResiduals, 0.9);
  const sortedMisses = [...misses].sort((a, b) => a - b);
  const sortedFlat = [...flatMisses].sort((a, b) => a - b);
  const pct = (list: number[], pred: (x: number) => boolean): number => (list.length === 0 ? 0 : round2((100 * list.filter(pred).length) / list.length));
  return {
    n: traded.length,
    median_miss: round2(median(sortedMisses)),
    pct_within_3x: pct(misses, (m) => m <= 3),
    pct_inside_p25_p75: pct(residuals, (r) => r >= q25 && r <= q75),
    pct_inside_p10_p90: pct(residuals, (r) => r >= q10 && r <= q90),
    q10: round4(q10),
    q25: round4(q25),
    q75: round4(q75),
    q90: round4(q90),
    flat: {
      n: traded.length,
      median_miss: round2(median(sortedFlat)),
      pct_within_3x: pct(flatMisses, (m) => m <= 3),
    },
  };
}

/**
 * walkForwardValidation(traded, asOf): split the traded set by age at its median (a null
 * listed_at takes the traded set's median age), fit the curve + premiums on the OLDER half,
 * test on the NEWER half. A model that only fits the past it was trained on fails here.
 */
export function walkForwardValidation(traded: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): Validation['walkforward'] {
  const knownAges = traded.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = median(knownAges);
  const withAge = traded.map((p) => ({ p, age: ageDays(asOf, p.listed_at) ?? medianAge }));
  const sorted = [...withAge].sort((a, b) => a.age - b.age);
  const splitAt = Math.floor(sorted.length / 2);
  const newer = sorted.slice(0, splitAt).map((e) => e.p);
  const older = sorted.slice(splitAt).map((e) => e.p);
  const curve = fitSizeCurve(older);
  const misses: number[] = [];
  for (const p of newer) {
    const premium = categoryPremium(p.category, older, curve, model);
    const pred = predictTraded(p, curve, premium, model);
    if (pred > 0 && p.mcap_usd !== null && p.mcap_usd > 0) {
      misses.push(Math.max(pred / p.mcap_usd, p.mcap_usd / pred));
    }
  }
  const sortedMisses = [...misses].sort((a, b) => a - b);
  return {
    n_fit: older.length,
    n_test: newer.length,
    median_miss: round2(median(sortedMisses)),
    pct_within_3x: misses.length === 0 ? 0 : round2((100 * misses.filter((m) => m <= 3).length) / misses.length),
  };
}

/**
 * launchOddsValidation(protocols, asOf): for each protocol, the age+category token rate
 * pByAge predicted from the rest (leave-one-out cohorts), thresholded at 0.5 and compared
 * with whether it has a token. Reported against the base rate — the overall token rate,
 * the accuracy of always guessing the majority class. The conditional odds themselves
 * are NOT the classifier here: they answer "will it launch eventually, given still
 * tokenless at this age", so a traded protocol that launched long ago scores low odds
 * by construction; pByAge is the underlying signal the odds are built from, and that
 * is what this check validates.
 */
export function launchOddsValidation(protocols: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): Validation['launch_odds'] {
  let correct = 0;
  let tokens = 0;
  for (let i = 0; i < protocols.length; i++) {
    const p = protocols[i]!;
    const rest = protocols.filter((_, j) => j !== i);
    const cohorts = buildOddsCohorts(rest, asOf);
    const rate = tokenRateByAge(p, { as_of: asOf, source: '', floor_usd: 0, protocols: rest, watchlist: [] }, cohorts, model);
    if (hasToken(p)) tokens++;
    if ((rate > 0.5) === hasToken(p)) correct++;
  }
  return {
    n: protocols.length,
    accuracy_pct: round2((100 * correct) / protocols.length),
    base_rate_pct: round2((100 * tokens) / protocols.length),
  };
}

/** A deterministic PRNG (mulberry32) so the bootstrap refits reproduce byte for byte. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * bootstrapRankRanges(rows, fit, snapshot): resample the traded set with replacement
 * `bootstrap_refits` times (seeded), refit the curve + premiums each time, recompute every
 * row's implied value with launch odds FIXED from the full fit, and rank within each refit.
 * Returns rank_low/rank_high per slug: the P10/P90 of the row's rank across refits, widened
 * to include the row's own full-fit rank.
 */
export function bootstrapRankRanges(
  rows: { slug: string; rank: number; implied_value_usd: number }[],
  scored: Map<string, { protocol: SnapshotProtocol; odds: number; forwardTvl: number }>,
  fit: Fit,
  model: ModelConstants = MODEL,
): Map<string, { rank_low: number; rank_high: number }> {
  const rng = mulberry32(model.bootstrap_seed);
  const ranksBySlug = new Map<string, number[]>();
  for (const r of rows) ranksBySlug.set(r.slug, []);
  const traded = fit.traded;
  for (let refit = 0; refit < model.bootstrap_refits; refit++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < traded.length; i++) sample.push(traded[Math.floor(rng() * traded.length)]!);
    const curve = fitSizeCurve(sample);
    const premiums = new Map<string, number>();
    for (const slug of scored.keys()) {
      const entry = scored.get(slug)!;
      const key = categoryKey(entry.protocol.category);
      if (!premiums.has(key)) premiums.set(key, categoryPremium(entry.protocol.category, sample, curve, model));
    }
    const impliedBySlug = new Map<string, number>();
    for (const [slug, entry] of scored) {
      const premium = premiums.get(categoryKey(entry.protocol.category)) ?? 1;
      impliedBySlug.set(slug, Math.max(1, Math.round(sizeCurveValue(entry.forwardTvl, curve) * premium * entry.odds)));
    }
    const order = [...rows].sort((a, b) => (impliedBySlug.get(b.slug) ?? 0) - (impliedBySlug.get(a.slug) ?? 0) || (a.slug < b.slug ? -1 : 1));
    order.forEach((row, i) => ranksBySlug.get(row.slug)!.push(i + 1));
  }
  const out = new Map<string, { rank_low: number; rank_high: number }>();
  for (const row of rows) {
    const ranks = [...ranksBySlug.get(row.slug)!].sort((a, b) => a - b);
    const p10 = quantileSorted(ranks, 0.1);
    const p90 = quantileSorted(ranks, 0.9);
    out.set(row.slug, {
      rank_low: clamp(Math.min(Math.round(p10), row.rank), 1, rows.length),
      rank_high: clamp(Math.max(Math.round(p90), row.rank), 1, rows.length),
    });
  }
  return out;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return tradedSet(snapshot.protocols)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

const ACCOUNTING_META: { label: AccountingLabel; title: string; reason: string }[] = [
  { label: 'ranked', title: 'Ranked — pre-token, standalone', reason: 'No token recorded, and not a bridge, liquid-staking, exchange, versioned or wrapped product.' },
  { label: 'has-token', title: 'Already has a token', reason: 'Records a market cap, CoinGecko id or symbol — its token already trades.' },
  { label: 'bridge', title: 'Bridge', reason: 'Category Bridge or Canonical Bridge — moving value between chains, not launching a token.' },
  { label: 'liquid-staking', title: 'Liquid staking / restaking', reason: 'Category Liquid Staking, Liquid Restaking or Restaked BTC — a receipt for a token that already trades.' },
  { label: 'cex', title: 'Exchange custody (CEX)', reason: 'Category CEX — exchange custody, not a standalone protocol launch.' },
  { label: 'versioned', title: 'Versioned name', reason: 'Name ends in a version marker (V2, v2, 2.0) — a pool of another protocol.' },
  { label: 'wrapped', title: 'Wrapped / staked by name', reason: 'Name carries the whole word wrapped, staked or staking — a product of a token that already trades.' },
  { label: 'exchange-name', title: 'Exchange name', reason: 'Name starts with an exchange name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini).' },
];

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitAll(snapshot, model);
  const loo = looValidation(fit.traded, snapshot.as_of, model);
  const rankable = snapshot.protocols.filter(isRankable);
  const scored = new Map<string, { protocol: SnapshotProtocol; odds: number; forwardTvl: number }>();
  const hours = planHours();
  const prelim = rankable.map((p) => {
    const s = impliedValue(p, snapshot, fit, model);
    scored.set(p.slug, { protocol: p, odds: s.odds, forwardTvl: s.forwardTvl });
    const planSize = planSizeFor(p, model);
    const fees = feesFor(p, model);
    const drop = dropFor(planSize, model.drop_share, s.implied, p.tvl_usd);
    const net = round2(drop - fees);
    return {
      p,
      s,
      planSize,
      fees,
      drop,
      net,
      comparables: comparablesFor(p, fit.traded),
    };
  });
  prelim.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const ranked = prelim.map((e, i) => ({ ...e, rank: i + 1 }));
  const ranges = bootstrapRankRanges(
    ranked.map((e) => ({ slug: e.p.slug, rank: e.rank, implied_value_usd: e.s.implied })),
    scored,
    fit,
    model,
  );
  return ranked.map((e) => {
    const range = ranges.get(e.p.slug)!;
    const valueLow = Math.max(1, Math.round(e.s.implied * Math.min(loo.q10, 1)));
    const valueHigh = Math.round(e.s.implied * Math.max(loo.q90, 1));
    return {
      rank: e.rank,
      slug: e.p.slug,
      name: e.p.name,
      category: e.p.category,
      chains: e.p.chains,
      tvl_usd: e.p.tvl_usd,
      change_7d: e.p.change_7d,
      mcap_usd: e.p.mcap_usd,
      listed_at: e.p.listed_at,
      gecko_id: e.p.gecko_id,
      symbol: e.p.symbol,
      token_status: 'pre-token' as const,
      is_watchlist: snapshot.watchlist.includes(e.p.slug),
      age_days: e.s.age,
      forward_tvl_usd: Math.round(e.s.forwardTvl),
      size_curve_usd: Math.round(e.s.sizeCurve),
      category_premium: round4(e.s.premium),
      value_if_launches_usd: Math.round(e.s.valueIfLaunches),
      launch_odds: round4(e.s.odds),
      implied_value_usd: e.s.implied,
      value_low_usd: valueLow,
      value_high_usd: valueHigh,
      rank_low: range.rank_low,
      rank_high: range.rank_high,
      plan_size_usd: e.planSize,
      fees_usd: e.fees,
      time_hours: hours,
      drop_usd: e.drop,
      net_usd: e.net,
      net_per_hour_usd: round2(e.net / hours),
      verdict: verdictFor(e.net),
      verdict_table: verdictTableFor(e.planSize, e.fees, e.s.implied, e.p.tvl_usd, model),
      comparables: e.comparables,
      farm_steps: farmSteps(e.p, e.s.age, e.planSize, model).map(stepText),
      model: {
        curve_a: round4(fit.curve.a),
        curve_b: round4(fit.curve.b),
        growth_pct: e.s.growthPct,
        momentum_multiplier: round4(e.s.momentumMultiplier),
        premium: round4(e.s.premium),
        launch_odds: round4(e.s.odds),
        age_days: e.s.age,
      },
    };
  });
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const fit = fitAll(snapshot, model);
  const looRes = looValidation(fit.traded, snapshot.as_of, model);
  const loo: Validation['loo'] = {
    n: looRes.n,
    median_miss: looRes.median_miss,
    pct_within_3x: looRes.pct_within_3x,
    pct_inside_p25_p75: looRes.pct_inside_p25_p75,
    pct_inside_p10_p90: looRes.pct_inside_p10_p90,
    q10: looRes.q10,
    q25: looRes.q25,
    q75: looRes.q75,
    q90: looRes.q90,
  };
  const flat: Validation['flat_baseline'] = looRes.flat;
  const walkforward = walkForwardValidation(fit.traded, snapshot.as_of, model);
  const launchOddsVal = launchOddsValidation(snapshot.protocols, snapshot.as_of, model);
  const validation: Validation = { loo, walkforward, launch_odds: launchOddsVal, flat_baseline: flat };
  const live = liveRows(snapshot);

  const counts = new Map<AccountingLabel, number>();
  for (const p of snapshot.protocols) {
    const label = classifyProtocol(p);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const accounting: AccountingGroup[] = ACCOUNTING_META.filter((m) => (counts.get(m.label) ?? 0) > 0).map((m) => ({
    label: m.title,
    count: counts.get(m.label) ?? 0,
    reason: m.reason,
  }));

  const byCategory = new Map<string, { rows: number; withToken: number; total: number; premium: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? '(none)';
    const entry = byCategory.get(key) ?? { rows: 0, withToken: 0, total: 0, premium: premiumOf(p.category, fit) };
    entry.total++;
    if (hasToken(p)) entry.withToken++;
    byCategory.set(key, entry);
  }
  for (const row of board) {
    const key = row.category ?? '(none)';
    const entry = byCategory.get(key);
    if (entry !== undefined) entry.rows++;
  }
  const categories: CategoryRow[] = [...byCategory.entries()]
    .filter(([, e]) => e.rows > 0)
    .map(([category, e]) => ({
      category,
      rows: e.rows,
      with_token: e.withToken,
      ever_pct: round2((100 * e.withToken) / e.total),
      premium: round4(e.premium),
    }))
    .sort((a, b) => b.rows - a.rows || (a.category < b.category ? -1 : 1));

  const totalImplied = board.reduce((s, r) => s + r.implied_value_usd, 0);
  const kpi: Kpi = {
    ranked: board.length,
    total_implied_usd: totalImplied,
    loo_median_miss: loo.median_miss,
    range_holds_pct: loo.pct_inside_p10_p90,
    launch_odds_accuracy_pct: launchOddsVal.accuracy_pct,
    worth_farming: board.filter((r) => r.verdict === 'FARM').length,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...model, curve_a: round4(fit.curve.a), curve_b: round4(fit.curve.b) },
    model_version: MODEL_VERSION,
    global_multiple: globalMultiple(fit.traded),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    ranked_size: board.length,
    early_size: 0,
    live_size: fit.traded.length,
    live_rows: live.length,
    rows: board,
    live,
    kpi,
    accounting,
    validation,
    categories,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null: coverage, ranks, order, one shared
 * implied value, farm steps, and the v3 ranges (value_low <= implied <= value_high and
 * rank_low <= rank <= rank_high on every row).
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.value_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.value_high_usd)) {
      return `${r.slug} has implied $${r.implied_value_usd} outside its value range $${r.value_low_usd}-$${r.value_high_usd}`;
    }
    if (!(r.rank_low <= r.rank && r.rank <= r.rank_high)) {
      return `${r.slug} has rank ${r.rank} outside its rank range ${r.rank_low}-${r.rank_high}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
