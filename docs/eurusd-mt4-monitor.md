# EURUSD M15 MT4 monitoring bridge

このEA (`mt4/EURUSDAIMonitor.mq4`) は、MT4とEURUSD APIを接続する監視専用ブリッジです。

## What it does

- 最新の確定M15足を監視します。
- 確定M15足ごとに1回だけシグナルAPIを呼び出します。
- 通信失敗時は限定時間だけ再試行します。
- 確定M15/H1のOHLC、インジケータ、直近80本を送信します。
- 口座残高・有効証拠金・DD・日次損益・ブローカー仕様を送信します。
- APIの `bar_time` には確定足の終値時刻を使用します。
- 注文の発注・変更・決済は行いません。

## MT4 setup

1. MetaTrader 4を開きます。
2. `mt4/EURUSDAIMonitor.mq4` をExpertsフォルダへ置き、MetaEditorでコンパイルします。
3. MT4の **Tools → Options → Expert Advisors** を開きます。
4. **Allow WebRequest for listed URL** を有効にし、EAで設定したRenderのベースURLを追加します。
5. `EURUSDAIMonitor` をEURUSDチャートへアタッチします。
6. `ApiKey` にRenderで設定した `GOLD_API_KEY` を入力します。
7. URLとAPIキーを確認してから `EnableSignalRequests=true` にします。
8. 監視専用で運用し、注文執行は有効化しません。

## Time convention

M15足のMT4 open timeを T とすると、APIへ送る `bar_time` は `T + 900` 秒です。H1も同様に `T + 3600` 秒として送ります。

APIはM15シグナル時刻以前に確定した最新のH1足を使用します。

## Request behavior

通常のポーリング間隔は5秒です。新しい確定M15足を検知すると即時にリクエストし、失敗した場合は30秒間隔で最大12分まで再試行します。HTTPタイムアウトは65秒です。

HTTP 409かつ `duplicate_bar` の場合は、すでに処理済みの足として正常扱いします。

## Safety boundary

このEAは監視専用です。`OrderSend`、`OrderClose`、`OrderModify` などの注文執行経路を実装していません。サーバー側の `EURUSD_EXECUTION_ENABLED` も無効のままです。