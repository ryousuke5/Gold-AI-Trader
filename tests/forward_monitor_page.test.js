import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Forward Monitor browser module script parses before deployment', async () => {
  const html = await readFile(new URL('../public/forward-monitor.html', import.meta.url), 'utf8');
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match, 'Forward Monitor module script must exist');

  const script = match[1].replace(
    /^\s*import\s+\{\s*getGoldDiagnosticsDisplayState\s*,\s*getGoldSafetyHeartbeatDisplayState\s*\}\s+from\s+['"][^'"]+['"]\s*;\s*/,
    ''
  );

  assert.doesNotThrow(() => new Function(script));
});
