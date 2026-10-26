# XM GOLD# デモ約定コスト計測EA

## 目的と制限

`GOLD_DemoExecutionCostLogger.mq4` はデモ口座専用の計測EAです。GOLD#のBid/Askを記録し、ボタンからユーザーが手動で実行した小口のデモ注文について、発注直前価格と約定価格の差、決済直前価格と決済価格の差、履歴上の手数料・スワップ・損益を記録します。

- 初期設定 `EnableDemoProbeOrders=false`。EA起動時に注文を出しません。
- 口座がデモでない場合は初期化を拒否します。チャート銘柄が `ExpectedSymbol` と完全一致しない場合も起動を拒否します。
- 取引はボタンクリック時のみ。BUY/SELLは初期Lots 0.01の市場注文で、SL/TPを自動設定しません。デモ専用ですが、ポジションは必ず自分で監視し、計測終了後にCLOSEボタンまたはMT4で決済してください。
- これはH4/H1戦略の売買EAではありません。手動プローブ注文で約定コストの測り方を検証します。これだけで戦略の優位性を評価しません。
- エントリーのスリッページはOrderSend直前に取得したAsk（BUY）/Bid（SELL）と実際のOrderOpenPriceとの差です。クローズボタンから決済した場合は、決済直前Bid（BUYを閉じる）/Ask（SELLを閉じる）とOrderClosePriceとの差を記録します。MT4や別EA、SL/TPで直接閉じた取引は決済直前価格が取れていないため、スリッページは空欄となります。
- `OrderCommission`, `OrderSwap`, `OrderProfit` は決済履歴から取得します。合計は口座通貨で `Profit + Commission + Swap` として算出します。MT4「口座履歴」は「全履歴」に設定してください。

## インストール

1. XMの**デモ口座**のMT4で `GOLD#` チャートを開く。リアル口座ではこのEAは動作しません。
2. MT4で「ファイル → データフォルダを開く → MQL4 → Experts」を開き、`GOLD_DemoExecutionCostLogger.mq4` を配置。
3. MetaEditorで開き、コンパイルする。
4. デモ口座の `GOLD#` チャートにEAを添付する。初期設定の `EnableDemoProbeOrders=false` のまま気配値ログのみ記録できることを確認する。
5. 実約定計測が必要な段階で、EA入力の `EnableDemoProbeOrders=true` を明示的に設定する。BUY/SELLボタンは**手動で**押す。
6. エントリー約定が出た後、必要に応じて一度の営業日ロールオーバーを跨いでスワップの変化を観察する。自動決済はないため、デモポジションを継続監視する。計測を終えるときは「CLOSE LATEST PROBE」を押す。長期保有を無人で行わない。
7. MT4データフォルダの `MQL4/Files` から `GOLD_DemoQuoteLog.csv` と `GOLD_DemoExecutionEvents.csv` を取得する。CSVは口座番号や認証情報を含む想定ではありませんが、共有前に内容を確認してください。

## 出力

- `GOLD_DemoQuoteLog.csv`: サーバー時刻、GMT時刻、時差、Bid/Ask、スプレッド、接続。
- `GOLD_DemoExecutionEvents.csv`: ENTRY_REQUEST / ENTRY_FILL、OPEN_COST_SNAPSHOT、CLOSE_REQUEST / CLOSE_FINAL、拒否理由、実測スリッページ、コミッション、スワップ、損益。

集計（Python 3 と NumPy が必要）:

```bash
python summarize_demo_execution_costs.py --events GOLD_DemoExecutionEvents.csv --quotes GOLD_DemoQuoteLog.csv --outdir demo_cost_report
```

## スワップ・手数料の解釈

XM公式はKIWAMI極口座について手数料なしと案内し、スワップフリーは特定銘柄に適用すると説明しています。GOLD#の個別条件を一般論で決めつけず、口座の取引履歴に記録される実際の値を優先します。

- XM公式手数料説明: https://www.xmtrading.com/jp/trading-fees
- XM KIWAMI極口座説明: https://www.xmtrading.com/jp/account-types/kiwami

まずは複数の小口デモ取引でBUY/SELL双方を記録します。1回または少数の試行を長期的なコスト分布とは扱いません。これは実約定コストの計測であり、H4/H1戦略のフォワード成績検証とは別です。
