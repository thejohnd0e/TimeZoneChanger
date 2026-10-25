const test = require('node:test');
const assert = require('node:assert/strict');
const { backgroundContext, deferred } = require('./helpers/background-context.cjs');

test('simultaneous first page configs retain both tabs in storage and cache', async () => {
  const gate = deferred();
  const bg = backgroundContext({beforeGet: area=> area==='session' ? gate.promise : undefined});
  const configs = [bg.run('getPageConfig(1,"one.example")'), bg.run('getPageConfig(2,"two.example")')];
  gate.resolve();
  await Promise.all(configs);
  assert.deepEqual(Object.keys(await bg.run('getTabState()')).sort(), ['1','2']);
  assert.deepEqual(Object.keys(bg.data.session.tabStateV1).sort(), ['1','2']);
});

test('failed session read can be retried', async () => {
  let fail = true;
  const bg = backgroundContext({beforeGet:area=>{if(area==='session' && fail) {fail=false;throw new Error('read failed');}}});
  await assert.rejects(bg.run('getTabState()'), /read failed/);
  await bg.run('getPageConfig(1,"example.com")');
  assert.equal(bg.data.session.tabStateV1[1].lockedTimezone, 'Europe/Berlin');
});

test('concurrent frames, tab removal and worker restart retain consistent state', async () => {
  const bg = backgroundContext();
  await Promise.all([bg.run('getPageConfig(1,"a.example")'),bg.run('getPageConfig(1,"b.example")')]);
  await bg.run('getPageConfig(2,"example.com")');
  await bg.run('clearTabState(1)');
  const restarted = backgroundContext({data:bg.data});
  assert.deepEqual(Object.keys(await restarted.run('getTabState()')), ['2']);
});

test('older persist cannot overwrite a newer state', async () => {
  const gate=deferred();
  let first=true;
  const bg=backgroundContext({beforeSet:async area=>{if(area==='session' && first){first=false;await gate.promise;}}});
  await bg.run('getTabState()');
  const a=bg.run('getPageConfig(1,"example.com")');
  await new Promise(resolve=>setImmediate(resolve));
  const b=bg.run('getPageConfig(2,"example.com")');
  await new Promise(resolve=>setImmediate(resolve));
  gate.resolve();
  await Promise.all([a,b]);
  assert.deepEqual(Object.keys(bg.data.session.tabStateV1).sort(), ['1','2']);
});

test('rejected tab save never becomes active or persists through another tab', async () => {
  let fail=true;
  const bg=backgroundContext({beforeSet:area=>{if(area==='session'&&fail){fail=false;throw new Error('write rejected');}}});
  const result=await bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'fixed',timezone:'Asia/Tokyo'});
  assert.equal(result.ok,false);
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).timezone,'Europe/Berlin');
  await bg.run('getPageConfig(2,"example.com")');
  assert.equal(bg.data.session.tabStateV1[1].tabOverride,undefined);
  const restart=backgroundContext({data:bg.data});
  assert.equal((await restart.run('getPageConfig(1,"example.com")')).timezone,'Europe/Berlin');
});

test('failed transaction cannot roll back another concurrently saved rule', async () => {
  let fail=true;
  const bg=backgroundContext({beforeSet:area=>{if(area==='session'&&fail){fail=false;throw new Error('write rejected');}}});
  const [a,b]=await Promise.all([
    bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'fixed',timezone:'Asia/Tokyo'}),
    bg.message({action:'tzc:set-tab-rule',tabId:2,mode:'fixed',timezone:'UTC'})
  ]);
  assert.equal(a.ok,false);assert.equal(b.ok,true);
  assert.equal(bg.data.session.tabStateV1[1]?.tabOverride,undefined);
  assert.equal(bg.data.session.tabStateV1[2].tabOverride.timezone,'UTC');
});

test('failed lock persistence does not retain a rejected lock in memory', async () => {
  let fail=true;
  const bg=backgroundContext({beforeSet:area=>{if(area==='session'&&fail){fail=false;throw new Error('write rejected');}}});
  await assert.rejects(bg.run('getPageConfig(1,"example.com")'),/write rejected/);
  bg.data.local.timezone='Asia/Tokyo';
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).timezone,'Asia/Tokyo');
});
