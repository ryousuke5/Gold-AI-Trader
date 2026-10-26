# GOLD H4/H1 押し目・戻り再確認型 — コスト検証

凍結済み候補 H4_H1PR_01 を対象に、戦略条件を変更せずスプレッドと仮定スリッページだけを変えて再シミュレーションした研究成果です。過去OOSは既に確認済みのため、OOS結果はコスト感度の診断であり、独立した新規OOSではありません。

## 主な成果物

- report_ja.md: 日本語レポートと次のデモ検証ゲート
- frozen_cost_sensitivity.csv: IS/OOSのコスト別統計
- frozen_cost_sensitivity_oos_annual.csv: OOSの年ブロック別統計
- audit_frozen_h4h1_costs.py: 凍結候補のコスト感度再シミュレーション
- audit_spread_log_integrity.py: MT4のBid/Askログの完全性・算術・重複監査
- demo_execution_log_template.csv: デモ約定コスト用の空ログテンプレート

## 再現実行

Python 3 と NumPy が必要です。凍結済み履歴アーティファクト xauusd-m5.json.gz（SHA-256: a7e6c7b9af8762bd0b02af1fc407c42e9d6c0be4c09d63c54cc87da14887e780）を別途用意し、次を実行します。

```bash
python research/gold_h4_h1_cost_validation/audit_frozen_h4h1_costs.py --data /path/to/xauusd-m5.json.gz --outdir /tmp/h4h1-cost-results
```

スクリプトは入力データのSHA-256と、凍結済みベースラインのIS/OOS統計を照合し、不一致なら停止します。別データで診断する場合に限り --allow-unverified-data を指定できますが、その結果を凍結済み結果と同列に扱わないでください。

スプレッドログの監査は次のとおりです。生CSVは口座・気配値情報を含むため、リポジトリには含めていません。

```bash
python research/gold_h4_h1_cost_validation/audit_spread_log_integrity.py /path/to/GOLD_KIWAMI_SpreadLog.csv --outdir /tmp/gold-spread-audit
```

## 主要な注意点

価格データはDukascopy XAUUSD M5 BIDで、XM GOLD# の5年分のBID/ASKヒストリーではありません。スリッページは未測定で、スワップ・資金調達費・口座固有の手数料は未計上です。

現時点で保存されているスプレッド要約は562,986行・2026-10-26までを示しますが、ライブラリから取得できる元CSVは321,100行・2026-10-23までです。要約と生データが一致するまで、長い方の統計は照合済みとして扱いません。

本番EA、Render、Supabase、リアル注文ゲートは変更していません。
