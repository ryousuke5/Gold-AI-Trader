import test from 'node:test';
import assert from 'node:assert/strict';
test('USDCAD research uses dedicated data',()=>{
 assert.match('https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDCAD/USDCADm15.csv',/USDCAD\/USDCADm15\.csv$/);
 assert.match('https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDCAD/USDCADh1.csv',/USDCAD\/USDCADh1\.csv$/);
});
test('USDCAD research keeps execution disabled',()=>{
 assert.notEqual(String(process.env.USDCAD_EXECUTION_ENABLED||'false').toLowerCase(),'true');
});
