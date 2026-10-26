const test = require('node:test');
const assert = require('node:assert/strict');
const { backgroundContext } = require('./helpers/background-context.cjs');

test('all settings write paths reject invalid fixed timezones without changing storage', async () => {
  const bg=backgroundContext();
  for(const timezone of ['', 'Not/AZone']) {
    for(const msg of [
      {action:'tzc:set-site-rule',pattern:'example.com',rule:{mode:'fixed',timezone}},
      {action:'tzc:set-tab-rule',tabId:1,mode:'fixed',timezone},
      {action:'tzc:update-settings',settings:{siteRules:{'example.com':{mode:'fixed',timezone}}}}
    ]) {
      const before=JSON.stringify(bg.data);
      const result=await bg.message(msg);
      assert.equal(result.ok,false);
      assert.equal(result.error,'invalid-timezone');
      assert.equal(JSON.stringify(bg.data),before);
    }
  }
});

test('legacy invalid fixed rules disable spoofing and report an error', async () => {
  const bg=backgroundContext();
  bg.data.sync.settings.siteRules['example.com']={mode:'fixed',timezone:'Not/AZone'};
  const config=await bg.run('getPageConfig(1,"example.com")');
  assert.equal(config.shouldSpoof,false);
  assert.equal(config.error,'invalid-timezone');
  bg.data.session.tabStateV1={2:{tabOverride:{mode:'fixed',timezone:''}}};
  const restarted=backgroundContext({data:bg.data});
  assert.equal((await restarted.run('getPageConfig(2,"example.net")')).shouldSpoof,false);
});

test('status exposes site rule and tab override independently of effective mode', async () => {
  const bg=backgroundContext();
  bg.data.sync.settings.siteRules['example.com']={mode:'fixed',timezone:'Asia/Tokyo'};
  await bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'disable'});
  const status=await bg.message({action:'tzc:get-tab-status'});
  assert.equal(status.siteRule.timezone,'Asia/Tokyo');
  assert.equal(status.tabOverride.mode,'disable');
  assert.equal(status.mode,'disable');
});

test('explicit auto override differs from inheriting site policy', async () => {
  const bg=backgroundContext();
  bg.data.sync.settings.siteRules['example.com']={mode:'disable',timezone:''};
  await bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'auto'});
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).shouldSpoof,true);
  await bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'inherit'});
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).shouldSpoof,false);
});

test('explicit site auto can override a broader disable rule, inherit removes it', async () => {
  const bg=backgroundContext();
  bg.data.sync.settings.siteRules['*']={mode:'disable',timezone:''};
  await bg.message({action:'tzc:set-site-rule',pattern:'example.com',rule:{mode:'auto'}});
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).mode,'auto');
  await bg.message({action:'tzc:set-site-rule',pattern:'example.com',rule:{mode:'inherit'}});
  assert.equal((await bg.run('getPageConfig(1,"example.com")')).mode,'disable');
});

test('storage failure returns an actionable error response', async () => {
  const bg=backgroundContext({beforeSet:()=>{throw new Error('quota exceeded');}});
  const result=await Promise.race([
    bg.message({action:'tzc:update-settings',settings:{}}),
    new Promise(resolve=>setTimeout(()=>resolve({error:'no-response'}),50))
  ]);
  assert.equal(result.ok,false);
  assert.equal(result.error,'storage-error');
});

test('exclusion/whitelist decisions precede site rules, while tab override wins', async () => {
  const bg=backgroundContext();
  const settings=bg.data.sync.settings;
  settings.excludedDomains=['excluded.example'];
  settings.whitelistDomains=['allowed.example'];
  settings.siteRules={
    'excluded.example':{mode:'fixed',timezone:'Asia/Tokyo'},
    'outside.example':{mode:'fixed',timezone:'Asia/Tokyo'},
    '*':{mode:'disable'},'allowed.example':{mode:'fixed',timezone:'UTC'}
  };
  assert.equal((await bg.run('getPageConfig(1,"excluded.example")')).source,'excluded');
  assert.equal((await bg.run('getPageConfig(2,"outside.example")')).source,'whitelist');
  assert.equal((await bg.run('getPageConfig(3,"allowed.example")')).timezone,'UTC');
  await bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'fixed',timezone:'Asia/Tokyo'});
  assert.equal((await bg.run('getPageConfig(1,"excluded.example")')).timezone,'Asia/Tokyo');
});

test('wildcards do not include the apex domain and default protection is retained', () => {
  const bg=backgroundContext();
  assert.equal(bg.run('TZC_SHARED.matchesPattern("google.com","*.google.com")'),false);
  assert.equal(bg.run('TZC_SHARED.resolveHostnameBehavior("gemini.google.com", TZC_SHARED.DEFAULT_SETTINGS).source'),'excluded');
  assert.equal(bg.run('TZC_SHARED.resolveHostnameBehavior("google.com", TZC_SHARED.DEFAULT_SETTINGS).mode'),'auto');
});

for(const url of ['chrome-extension://exampleid/options.html','chrome://settings/','about:blank','file:///C:/test.html','data:text/html,test','https://chromewebstore.google.com/detail/test','https://chrome.google.com/webstore/detail/test']) {
  test(`unsupported page status never locks timezone: ${url}`,async()=>{
    const bg=backgroundContext({activeTab:{id:1,url}});
    const status=await bg.message({action:'tzc:get-tab-status'});
    assert.equal(status.supported,false);
    assert.equal(status.tabId,1);
    assert.equal(status.shouldSpoof,false);
    assert.equal(status.source,'unsupported');
    assert.equal(status.hostname,'');
    assert.equal(bg.data.session.tabStateV1,undefined);
    const result=await bg.message({action:'tzc:set-tab-rule',tabId:1,mode:'fixed',timezone:'UTC'});
    assert.equal(result.ok,false);
    assert.equal(result.error,'unsupported-tab');
    assert.equal(bg.data.session.tabStateV1,undefined);
  });
}

test('supported status binds hostname and selected rule to the same tab id',async()=>{
  const bg=backgroundContext({activeTab:{id:42,url:'https://example.com/'}});
  const status=await bg.message({action:'tzc:get-tab-status'});
  assert.equal(status.supported,true);
  assert.equal(status.tabId,42);
  assert.equal(status.hostname,'example.com');
});

test('no active tab is explicitly unsupported',async()=>{
  const bg=backgroundContext({activeTab:null});
  const status=await bg.message({action:'tzc:get-tab-status'});
  assert.equal(status.supported,false);
  assert.equal(status.tabId,null);
});
