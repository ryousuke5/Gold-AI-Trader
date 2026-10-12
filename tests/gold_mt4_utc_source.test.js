import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('MT4 signal payload converts all sent bar timestamps from broker time to UTC', async () => {
  const source = await readFile(new URL('../mt4/GoldAITraderV18.mq4', import.meta.url), 'utf8');
  assert.match(source, /bool GetServerUtcOffsetSeconds\(int &offsetSeconds\)/);
  assert.match(source, /datetime closedBarTimeUtc = closedBarTime - serverUtcOffsetSeconds;/);
  assert.match(source, /\[GOLD UTC DIAG\]/);
  assert.match(source, /bar_time_epoch=/);
  assert.match(source, /terminal_gmt=/);
  assert.match(source, /bar_time[^\n]*closedBarTimeUtc/);
  assert.match(source, /barOpenM5 \+ 300 - serverUtcOffsetSeconds/);
  assert.match(source, /barOpenH1 \+ 3600 - serverUtcOffsetSeconds/);
  assert.match(source, /server_utc_offset_seconds/);
});


test('MT4 GOLD bridge suppresses retries for the same unrecoverable stale M5 bar', async () => {
  const source = await readFile(new URL('../mt4/GoldAITraderV18.mq4', import.meta.url), 'utf8');
  assert.ok(source.includes('bool IsStaleBarTimeRejection(string response)'));
  assert.ok(source.includes('StringFind(response, "invalid_bar_time") >= 0'));
  assert.ok(source.includes('StringFind(response, "bar_time_too_old") >= 0'));
  const onTimer = source.split('void OnTimer()')[1]?.split('// EA lifecycle')[0] || '';
  assert.ok(onTimer.includes('else if(IsStaleBarTimeRejection(response))'));
  const staleBranch = onTimer.split('else if(IsStaleBarTimeRejection(response))')[1] || '';
  assert.ok(staleBranch.includes('g_lastClosedM5Bar = closedBar;'));
  assert.ok(staleBranch.includes('suppressing retries until a newer bar'));
});
