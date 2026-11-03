# GOLD V3 Frozen IS — 正式再現結果（2026-11-03）

## 結論

**REJECT_FROZEN_V3_NO_OOS_NO_PARAMETER_TUNING**

V3初回案は候補数を大幅に増やした一方、コスト控除後の損益はIS全期間・全37か月・BUY/SELL両方向でマイナスだった。OOSへ進めず、この構成は採用・マージ・本番デプロイしない。結果を見て同じIS期間に合わせたパラメータ調整もしない。

## 再現性

- GitHub Actions workflow: [GOLD V3 Frozen IS Reproduction](https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/41555448367)
- Run ID: `41555448367`
- Commit: `16ace115f133e4d23df0b66ccb56e72378be87e5`
- Artifact: `gold-v3-frozen-is-reproduction` (Artifact ID `13195270207`)
- Workflow result: success（フルリポジトリテスト、データ取得・検証、構文チェック、IS replay、report、decision artifact upload）
- Dataset: Dukascopy Historical Data Feed / XAUUSD M5 BID
- Source period: `[2021-10-06T00:00:00Z, 2026-10-05T00:00:00Z)`
- Rows: 354,305; invalid OHLC rows: 0; duplicate timestamps: 0
- SHA-256: `83dbefaca0dd6f1f4a44cdedcd547edb0f7b03c3a2dca4d399dc603beaf70a8b`
- Frozen IS: `[2021-10-06T00:00:00Z, 2024-10-06T00:00:00Z)`
- First evaluated close: `2021-10-06T20:55:00Z`
- Last evaluated close: `2024-10-04T20:55:00Z`

This formally reproduces the checked-in Node replay builder, rather than the earlier independent local reproduction. V2 is imported read-only for candidate-count reference.

## 固定設定

- V3 strategy: `gold-h1-m5-expanded-pullback-reaccel-v3`
- H1 trend: close vs EMA50, EMA20/EMA50 alignment, RSI bands
- M5 impulse: confirmed pivot; 3–30 bars; at least 0.8 ATR
- Pullback: 23.6%–61.8%; max 3 closed M5 bars
- Re-acceleration: previous M5 high/low break; EMA20 alignment; body >=0.20 ATR
- Stop: recent pullback/signal swing plus 0.10 ATR; allowed width 0.25–1.80 ATR
- Target: fixed 2R
- Session: 07:00–20:00 UTC
- Execution: next contiguous M5 open; max entry gap 0.50 ATR; max hold 96 M5 bars; one open position per scenario; stop-first on same-bar stop/target overlap
- Baseline cost: spread 0.55 / slippage 0.05 each side
- Stress cost: spread 0.75 / slippage 0.10 each side

## 結果

| 指標 | Baseline | Stress |
|---|---:|---:|
| V3 candidates | 3,466 | 3,466 |
| V2 reference candidates | 4 | 4 |
| Trades | 2,131 | 2,148 |
| Wins / losses | 497 / 1,634 | 427 / 1,721 |
| Win rate | 23.32% | 19.88% |
| Profit factor | 0.3998 | 0.2881 |
| Expectancy | -0.5519R | -0.7408R |
| Net | -1,176.11R | -1,591.24R |
| Max drawdown | 1,179.71R | 1,591.24R |
| Profitable months | 0 / 37 | 0 / 37 |

### Baseline direction split

| Direction | Trades | Net R | Expectancy R/trade |
|---|---:|---:|---:|
| BUY | 1,054 | -292.46 | -0.277 |
| SELL | 1,077 | -883.65 | -0.821 |

Both directions failed; disabling one side is not supported as a fix.

### Pre-registered screening gates

| Gate | Result |
|---|---|
| Minimum 50 baseline trades | PASS |
| Baseline PF > 1 | FAIL |
| Baseline expectancy > 0 | FAIL |
| Stress PF > 1 | FAIL |
| Stress expectancy > 0 | FAIL |
| At least 55% profitable months | FAIL (0/37) |
| BUY expectancy > 0 | FAIL |
| SELL expectancy > 0 | FAIL |

## 解釈と制約

1. Frequency requirement was met in this historical proxy (3,466 candidates vs 4 V2 reference candidates), but the entries did not have a positive payoff distribution.
2. The nominal 2R target did not produce a positive realized expectancy; actual fills are modeled from OHLC, not broker tick-by-tick execution.
3. The input is Dukascopy M5 BID, not XM GOLD# native historical BID/ASK.
4. Spread/slippage assumptions are fixed and not timestamp-matched historical XM quote costs. Swap, financing, and account commissions are not included.
5. OHLC cannot show intrabar event sequence; stop-first is assumed if both stop and target lie within one M5 bar.
6. Do not treat these results as XM live-performance proof. They are nevertheless sufficient to reject this frozen first-pass hypothesis at IS.

## 安全・分離

Research only. No changes to GOLD V2 entry rules/defaults, production API routing, Render, Supabase, MT4 V19, 0.50 live spread gate, or live order settings. OOS was not evaluated. Real orders remain OFF.
