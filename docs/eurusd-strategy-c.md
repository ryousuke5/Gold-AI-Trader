# EURUSD Strategy C — Trend Pullback Core

Strategy C is a research-only alternative to Strategy B V3. It keeps the H1 trend plus M15 pullback thesis but removes the second post-break confirmation bar that made V3 produce zero candidates in the five-year test.

Hypothesis:
- H1 EMA20 > EMA50 > EMA200 or the symmetric downtrend, plus six-bar direction agreement.
- M15 impulse followed by a controlled pullback into the EMA20 area while preserving EMA50 structure.
- Entry occurs on one completed M15 trigger candle that breaks the pullback extreme directly.
- RSI is a continuation filter, not the signal generator.
- Stop is beyond pullback structure; target is a fixed R multiple.
- Spread, stop distance, and spread-to-target economics are hard filters.

Research-only safety: Strategy C is not wired to the live EURUSD signal route. EURUSD live execution approval flags remain false by default.

Evaluation policy:
1. Use 1825 days of Dukascopy M15 data.
2. Compare predeclared parameter presets.
3. Evaluate the most recent 365 days separately.
4. Stress transaction costs at 0.8/0.1, 1.2/0.2, and 1.5/0.3 pips.
5. Require positive expectancy, adequate sample size, and stable year/direction behavior before demo or live consideration.

Trade frequency is a guideline, not a hard gate.
