# Gold V2 AI Environment Filter — Point-in-Time Replay

## Objective

Validate whether the AI environment filter improves the existing Gold V2 candidate set without look-ahead bias.

The replay must compare:

- V2 mechanical candidate selection
- V2 + AI environment filter

using the same historical XAUUSD M5 data, execution assumptions, and portfolio overlap policy.

## Core anti-look-ahead contract

Every candidate has an authoritative `asof_time`.

Historical evidence supplied to the AI must include `published_at` and:

`published_at <= asof_time`

Any future-dated evidence causes that replay item to fail.

The replay evaluator has **no web-search tool**. It may use only the candidate snapshot and the point-in-time historical context file.

This is necessary because running today's web search against a 2020/2021/2022 signal would leak information that was not available at the signal time.

## Files

- `scripts/build-gold-v2-ai-replay-dataset.mjs`
  - Replays the historical bars.
  - Recreates the Gold V2 candidate.
  - Stores the candidate's M5/H1 state and setup at the signal time.
  - Calculates the executable baseline outcome with the same spread, slippage, entry-gap, effective-RR, stop/target and max-hold assumptions.
  - Produces `gold_v2_ai_replay_dataset.jsonl`.
  - Requires `GOLD_BACKTEST_DATA_FILE` so the input dataset is explicit and reproducible.
  - Candidate generation is resumable through `build_checkpoint.json`; matching candidate IDs already written to the JSONL are not duplicated.

- `scripts/run-gold-v2-ai-replay.mjs`
  - Calls the historical replay evaluator.
  - Resumes from `ai_filter_results.jsonl` by candidate ID.
  - Uses no live web search.
  - Applies `AI_ENV_FILTER_MIN_SCORE` and ALIGNED candidate gating.

- `scripts/report-gold-v2-ai-replay.mjs`
  - Builds two portfolios from the same candidate pool.
  - Baseline: all executable V2 candidates.
  - Filtered: only AI-approved candidates.
  - Re-simulates overlap selection so rejecting one candidate can expose a later candidate.
  - Reports PF, expectancy R, net R, max drawdown R, win rate, losing streak, holding time, and year/month statistics.

- `src/gold_ai_replay.js`
  - Point-in-time Responses API evaluator.
  - Structured output only.
  - No web-search tool by design.

## Historical context file

Create:

`gold-ai-replay/historical_context.jsonl`

One JSON object per candidate timestamp:

```json
{
  "asof_time": 1760000000,
  "sources": [
    {
      "id": "source-1",
      "published_at": 1759996400,
      "title": "Example historical release",
      "url": "https://example.invalid/source",
      "summary": "Facts that were available at the time."
    }
  ]
}
```

The context can contain macro releases, central-bank statements, Treasury/yield information, dollar conditions, gold ETF/central-bank information, geopolitical developments, and scheduled events, but every item must be point-in-time valid.

Do not copy a later article that retrospectively explains the move.

## Recommended validation sequence

1. Build the replay dataset from the exact pinned XAUUSD M5 dataset.
2. Validate the dataset fingerprint and period.
3. Populate point-in-time historical context.
4. Run the AI replay; interrupted jobs resume from the JSONL result file.
5. Validate the historical context and provenance before AI replay.
6. Require 100% AI-result coverage before claiming full-sample results.
7. Generate the A/B report.
8. Split the history chronologically for development / validation / final holdout.
9. Tune the AI gate only on the development segment.
10. Freeze the prompt, model, threshold, and context rules.
11. Evaluate once on the untouched holdout.

## Acceptance criteria

The AI filter is not considered beneficial merely because PF increases.

Before considering paper trading, require evidence that:

- expectancy R improves or remains materially positive,
- PF improves without an unacceptable collapse in trade count,
- max drawdown is improved or remains within the risk budget,
- the result is not driven by one month/year,
- BUY and SELL are not hiding a major asymmetry,
- performance survives the chronological holdout,
- results remain reasonable under conservative execution assumptions,
- no future-dated context was accepted,
- the exact prompt/model/threshold and historical context version are reproducible.

Real orders remain OFF throughout replay and validation.
