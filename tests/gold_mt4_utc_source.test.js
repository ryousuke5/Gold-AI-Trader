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
