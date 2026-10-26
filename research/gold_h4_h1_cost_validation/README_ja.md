# GOLD H4/H1 押し目・戻り再確認型 — コスト検証

凍結済み候補 H4_H1PR_01 を対象に、戦略条件を変えず、コスト仮定とデータ品質を監査する研究用パッケージです。過去OOSは既に確認済みのため、コスト感度の値は診断であり、新しい独立OOSではありません。

## 主な成果物

- `report_ja.md`: コスト感度と実運用前の検証ゲート
- `frozen_cost_sensitivity.csv`: IS/OOSのコスト別統計
- `frozen_cost_sensitivity_oos_annual.csv`: OOS年度ブロック別統計
- `audit_frozen_h4h1_costs.py`: 凍結候補のコスト感度再シミュレーション
- `audit_spread_log_integrity.py`: MT4 Bid/Askログ監査
- `reconciliation/SPREAD_DATA_RECONCILIATION_2026-10-26.md`: 元CSVと旧集計の不一致に関する照合報告
- `reconciliation/audit_available_spread_log.py`: 現存CSVから行数・期間・ハッシュ・重複・時間帯別分布を再生成
- `reconciliation/spread_log_reconciled_summary.csv`: 現在利用できる生CSVからの正本集計
- `demo/GOLD_DemoExecutionCostLogger.mq4`: XMデモ口座専用の手動プローブ/約定コスト計測EA（初期発注OFF）
- `demo/summarize_demo_execution_costs.py`: 実際のデモログからスリッページ・スワップ・手数料・損益を集計
- `demo/README_ja.md`: MT4への導入・デモ計測手順

## 再現実行

凍結済み履歴アーティファクト `xauusd-m5.json.gz` のSHA-256は `a7e6c7b9af8762bd0b02af1fc407c42e9d6c0be4c09d63c54cc87da14887e780` です。

```bash
python research/gold_h4_h1_cost_validation/audit_frozen_h4h1_costs.py --data /path/to/xauusd-m5.json.gz --outdir /tmp/h4h1-cost-results
```

スクリプトは入力データのSHA-256と凍結済みベースラインのIS/OOS統計を照合し、不一致なら停止します。

スプレッドログの正本再生成:

```bash
python research/gold_h4_h1_cost_validation/reconciliation/audit_available_spread_log.py /path/to/GOLD_KIWAMI_SpreadLog.csv --outdir /tmp/gold-spread-audit --legacy-summary /path/to/gold_kiwami_spread_log_summary.csv
```

デモログの集計:

```bash
python research/gold_h4_h1_cost_validation/demo/summarize_demo_execution_costs.py --events GOLD_DemoExecutionEvents.csv --quotes GOLD_DemoQuoteLog.csv --outdir demo_cost_report
```

## 重要：気配値データの不一致

現在取得できる元CSVは321,100行で、期間は2026-10-22 06:15:12 UTC〜2026-10-23 05:44:02 UTCです。旧集計が示す562,986行・2026-10-26までの完全CSVは現在のライブラリでは見つからず、現存CSVからその差分241,886行は再構成できません。現存CSV由来の要約を正本にし、旧集計は別版・未照合として保持しています。完全期間の不一致を閉じるには、MT4の `MQL4/Files/GOLD_KIWAMI_SpreadLog.csv` から完全版を再取得する必要があります。

現存CSVには `log_label=KIWAMI_REAL` とリアル口座サーバー表記があります。これは気配値のみのリアル口座ログで、デモ約定・スリッページ・スワップ・手数料は含みません。

## デモ計測の安全性

デモEAは非デモ口座上では初期化を拒否し、注文機能は初期設定OFFです。発注は手動ボタン操作時のみで、EA起動時やTick時に自動発注しません。MT4でコンパイルとデモ実約定をまだ実施していないため、実測コストの結果は未取得です。

価格履歴はDukascopy XAUUSD M5 BIDの代理データです。スリッページの過去推計は仮定値であり、スワップ・口座固有の実約定コストはXMデモ履歴による検証が必要です。本番EA、Render、Supabase、リアル注文ゲートは変更していません。
