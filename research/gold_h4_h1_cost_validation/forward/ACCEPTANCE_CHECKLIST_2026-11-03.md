# H4_H1PR_01 仮想フォワード開始前チェック（2026-11-03）

## 現在の判断

**研究候補として仮想フォワードに進む。実売買候補としては未承認。**

- 凍結IS：167取引、PF 1.161、期待値 +0.091R（spread 0.55、片道slippage 0.05 のモデル）
- 過去に観測済みのOOS：114取引、PF 1.375、期待値 +0.192R
- OOS年度別：初年度60取引 PF 0.915 / E -0.051R、次年度54取引 PF 2.113 / E +0.463R（基準コスト）
- このOOSは既に確認済みで、独立した未使用ホールドアウトではない。初年度がマイナスで翌年度の利益に偏るため、安定性の証明とは扱わない。
- データはDukascopy XAUUSD M5 BID。XM GOLD#の5年分ネイティブBid/Askではない。
- 実測スリッページ、スワップ、手数料は未取得。

## 監視EAの範囲

対象ファイル：`GOLD_H4_H1PR01_VirtualMonitor.mq4`

- 完了済みXM GOLD# M5 BID履歴から完全なUTC H1/H4を再構築し、固定済みH4/H1条件を判定する。
- BUYの仮想EntryはAsk、Exit判定はBid。SELLはEntryがBid、Exit判定がAsk。
- 仮想ポジション、処理済みシグナル時刻をMT4 Global Variablesへ保存し、再起動時の重複を抑止する。
- `OrderSend`、`OrderClose`、`OrderModify`、`OrderDelete`等の注文APIは含まない（静的テストで確認）。
- リアル口座は初期化拒否。銘柄は完全一致の `GOLD#` のみ。
- Render、Supabase、/api/gold/signal、GOLD V2、MT4 V19には接続・変更しない。
- `GOLD_DemoExecutionCostLogger.mq4` は別の手動デモ約定コスト計測EAであり、この仮想監視EAの起動には不要。今回は使用しない。

## MT4での初期導入

1. **XMデモ口座**のMT4を使用する。リアル口座には添付しない。
2. MetaEditorで `GOLD_H4_H1PR01_VirtualMonitor.mq4` を開き、F7でコンパイルする。
3. コンパイル結果（Errors / Warnings）を保存する。0 errorsを確認できるまで添付しない。警告があれば内容を記録する。
4. XMデモの `GOLD#` チャート1つだけに添付する。同じ口座・銘柄で複数インスタンスを同時起動しない。
5. `RequireDemoAccount=true`、`ExpectedSymbol=GOLD#`、`EnableEventCsv=true` のままにする。発注を有効にする設定は存在しない。
6. Expertsログの `NO_ORDER_VIRTUAL_MONITOR_ONLY` と `Virtual entries only` を確認する。
7. 週末・市場休場時に開始した場合、最初の新しいティックで時差が確認されるまで `MONITOR_BLOCKED` のままになる。時刻確認後の `MONITOR_RESUMED` を確認する。
8. `MQL4/Files/GOLD_H4_H1PR01_ForwardEvents.csv` が生成され、`MONITOR_START`、`SIGNAL_CHECK`、`VIRTUAL_ENTRY`、`VIRTUAL_EXIT` 等が記録されることを確認する。

## 最初に必要な照合

- MetaEditorのコンパイル結果を記録する。
- Expertsログのserver time / GMT / offsetと、固定した複数時点のM5バー時刻を照合する。
- UTC H1/H4足が不完全なM5集合やDST切替の曖昧な時刻から生成されていないことを確認する。
- 起動時に過去シグナルを遡って仮想エントリーしないことを確認する。
- CSVのBid/Ask/Spread、UTC/サーバー時差、signal/entry/exit時刻を記録する。
- CSVに口座番号などの個人情報が含まれていないことを確認してから共有する。

## 受入ゲート

MetaEditorコンパイルと時刻照合が完了するまでは、出力を成績データとして集計しない。最初の受入後も最低数週間・複数の相場局面で仮想ポジションを観測し、候補数、スキップ理由、仮想R、スプレッド分布、最大連敗、年度/週別分布を確認する。

仮想RはBid/Askによる価格ベースであり、実約定のスリッページ・手数料・スワップを含まない。実売買への承認は別途、XMネイティブの約定コストと十分な前向き検証の後に判断する。

**安全境界：GOLD V2/V19、Render、Supabase、ライブSpread 0.50、実注文ゲートは変更しない。**
