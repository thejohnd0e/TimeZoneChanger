const test = require('node:test');
const assert = require('node:assert/strict');
const { backgroundContext, deferred } = require('./helpers/background-context.cjs');

test('first config waits for IP detection before locking a timezone', async () => {
  const gate=deferred();
  const bg=backgroundContext({fetch:()=>gate.promise});
  bg.data.local={};
  const config=bg.run('getPageConfig(1,"example.com")');
  gate.resolve({ok:true,json:async()=>({timezone:{id:'Asia/Tokyo'},ip:'203.0.113.1'})});
  assert.equal((await config).timezone,'Asia/Tokyo');
  assert.equal(bg.data.session.tabStateV1[1].lockedTimezone,'Asia/Tokyo');
});

test('offline system fallback is not locked and later success can resolve it', async () => {
  const bg=backgroundContext();
  bg.data.local={};
  await bg.run('getPageConfig(1,"example.com")');
  assert.equal(bg.data.session.tabStateV1?.[1]?.lockedTimezone,undefined);
  bg.data.local={timezone:'Asia/Tokyo'};
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).timezone,'Asia/Tokyo');
});

test('confirmed lock survives reload, navigation, IP change and tab override reset', async () => {
  const bg=backgroundContext();
  await bg.run('getPageConfig(1,"example.com")');
  bg.data.local.timezone='Asia/Tokyo';
  assert.equal((await bg.run('getPageConfig(1,"another.example")')).timezone,'Europe/Berlin');
  await bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'fixed',timezone:'UTC'});
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).timezone,'UTC');
  await bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'auto'});
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).timezone,'Europe/Berlin');
  await bg.run('clearTabState(1)');
  assert.equal((await bg.run('getPageConfig(2,"example.com")')).timezone,'Asia/Tokyo');
});
