const test=require('node:test');
const assert=require('node:assert/strict');
const {uiContext}=require('./helpers/ui-context.cjs');

test('one popup editor restores saved rules independently for each scope',async()=>{
  const ui=await uiContext();
  assert.equal(ui.element('rule-scope').value,'tab');
  assert.equal(ui.element('rule-mode').value,'disable');
  assert.equal(ui.element('effective-timezone').textContent,'UTC');
  ui.element('rule-scope').value='site';ui.element('rule-scope').listeners.change();
  assert.equal(ui.element('rule-mode').value,'fixed');
  assert.equal(ui.element('rule-timezone').value,'Asia/Tokyo');
  assert.equal(ui.element('rule-timezone').hidden,false);
});

test('failed tab save reports an error without reloading or clearing fields',async()=>{
  const ui=await uiContext();ui.fail();
  ui.element('rule-mode').value='fixed';ui.element('rule-timezone').value='Not/AZone';
  await ui.element('apply-rule-btn').listeners.click();
  assert.deepEqual(ui.reloads,[]);
  assert.equal(ui.element('rule-timezone').value,'Not/AZone');
  assert.ok(ui.element('status-message').textContent.length>0);
  assert.equal(ui.element('apply-rule-btn').disabled,false);
});

test('transport errors restore refresh button and are visible',async()=>{
  const ui=await uiContext();ui.transportError();
  await ui.element('refresh-btn').listeners.click();
  assert.equal(ui.element('refresh-btn').disabled,false);
  assert.ok(ui.element('status-message').textContent.length>0);
});

test('failed options save preserves user input and shows the error',async()=>{
  const ui=await uiContext('options.js');ui.fail();
  ui.element('rule-pattern').value='example.com';
  ui.element('rule-mode').value='fixed';ui.element('rule-timezone').value='Not/AZone';
  await ui.element('add-rule-btn').listeners.click();
  assert.equal(ui.element('rule-timezone').value,'Not/AZone');
  assert.equal(ui.element('rule-pattern').value,'example.com');
  assert.ok(ui.element('status-message').textContent.length>0);
});

test('switching scope preserves independent unsaved timezone drafts',async()=>{
  const ui=await uiContext();
  ui.element('rule-mode').value='fixed';ui.element('rule-timezone').value='UTC';
  ui.element('rule-scope').value='site';ui.element('rule-scope').listeners.change();
  ui.element('rule-timezone').value='Europe/Berlin';
  ui.element('rule-scope').value='tab';ui.element('rule-scope').listeners.change();
  assert.equal(ui.element('rule-mode').value,'fixed');assert.equal(ui.element('rule-timezone').value,'UTC');
  ui.element('rule-scope').value='site';ui.element('rule-scope').listeners.change();
  assert.equal(ui.element('rule-timezone').value,'Europe/Berlin');
});

for(const scope of ['site','tab']) test(`single Apply targets ${scope} and reloads only after successful save`,async()=>{
  const ui=await uiContext();
  ui.element('rule-scope').value=scope;ui.element('rule-scope').listeners.change();
  ui.element('rule-mode').value='fixed';ui.element('rule-timezone').value='UTC';
  await ui.element('apply-rule-btn').listeners.click();
  const writes=ui.calls.filter(msg=>msg.action===`tzc:set-${scope}-rule`);
  assert.equal(writes.length,1);
  if(scope==='tab'){assert.equal(writes[0].tabId,1);assert.equal(writes[0].timezone,'UTC');}
  else {assert.equal(writes[0].pattern,'example.com');assert.equal(writes[0].rule.timezone,'UTC');}
  assert.deepEqual(ui.reloads,[1]);
});

test('unsupported pages disable rules, do not display fake timezone and retain global actions',async()=>{
  const ui=await uiContext('popup.js',{status:{supported:false,tabId:1,hostname:'',timezone:'',source:'unsupported',siteRule:null,tabOverride:null}});
  for(const id of ['rule-scope','rule-mode','rule-timezone','apply-rule-btn'])assert.equal(ui.element(id).disabled,true);
  assert.equal(ui.element('effective-timezone').textContent,'Not available');
  assert.match(ui.element('page-message').textContent,/not available on this page/i);
  await ui.element('apply-rule-btn').listeners.click();
  assert.equal(ui.calls.some(msg=>msg.action.startsWith('tzc:set-')),false);
  await ui.element('refresh-btn').listeners.click();
  assert.equal(ui.element('apply-rule-btn').disabled,true);
  await ui.element('open-options-btn').listeners.click();
  assert.equal(ui.openedOptions.length,1);
});

test('failed initial status leaves rule actions disabled',async()=>{
  const ui=await uiContext('popup.js',{transportError:true});
  assert.equal(ui.element('apply-rule-btn').disabled,true);
  await ui.element('apply-rule-btn').listeners.click();
  assert.equal(ui.calls.some(msg=>msg.action.startsWith('tzc:set-')),false);
});

test('site scope explains a higher-priority tab override',async()=>{
  const ui=await uiContext();
  ui.element('rule-scope').value='site';ui.element('rule-scope').listeners.change();
  assert.match(ui.element('scope-hint').textContent,/tab override/i);
});

test('site scope explains exclusion without changing its priority',async()=>{
  const ui=await uiContext('popup.js',{status:{source:'excluded',tabOverride:null}});
  assert.equal(ui.element('rule-scope').value,'site');
  assert.match(ui.element('scope-hint').textContent,/exclusion/i);
});

test('refresh preserves a partially edited rule',async()=>{
  const ui=await uiContext();
  ui.element('rule-mode').value='fixed';ui.element('rule-timezone').value='Asia/Kathmandu';
  await ui.element('refresh-btn').listeners.click();
  assert.equal(ui.element('rule-mode').value,'fixed');
  assert.equal(ui.element('rule-timezone').value,'Asia/Kathmandu');
});

test('absent overrides show inherited site policy and hide fixed timezone',async()=>{
  const ui=await uiContext('popup.js',{status:{siteRule:null,tabOverride:null}});
  assert.equal(ui.element('rule-scope').value,'site');
  assert.equal(ui.element('rule-mode').value,'inherit');
  assert.equal(ui.element('rule-timezone').hidden,true);
});

test('apply stays bound to its original tab across an active-tab change',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const ui=await uiContext('popup.js',{beforeMessage:msg=>msg.action==='tzc:set-tab-rule'?gate:undefined});
  ui.element('rule-mode').value='fixed';ui.element('rule-timezone').value='UTC';
  const save=ui.element('apply-rule-btn').listeners.click();
  assert.equal(ui.element('rule-scope').disabled,true);
  assert.equal(ui.element('apply-rule-btn').disabled,true);
  ui.status.tabId=2;ui.status.hostname='other.example';
  release();await save;
  assert.deepEqual(ui.reloads,[1]);
  assert.equal(ui.calls.find(msg=>msg.action==='tzc:set-tab-rule').tabId,1);
});
