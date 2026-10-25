const test=require('node:test');
const assert=require('node:assert/strict');
const {uiContext}=require('./helpers/ui-context.cjs');

test('popup restores separate saved rules and effective timezone',async()=>{
  const ui=await uiContext();
  assert.equal(ui.element('site-mode').value,'fixed');
  assert.equal(ui.element('site-timezone').value,'Asia/Tokyo');
  assert.equal(ui.element('tab-mode').value,'disable');
  assert.equal(ui.element('effective-timezone').textContent,'UTC');
});

test('failed tab save reports an error without reloading or clearing fields',async()=>{
  const ui=await uiContext();ui.fail();
  ui.element('tab-mode').value='fixed';ui.element('tab-timezone').value='Not/AZone';
  await ui.element('save-tab-rule-btn').listeners.click();
  assert.deepEqual(ui.reloads,[]);
  assert.equal(ui.element('tab-timezone').value,'Not/AZone');
  assert.ok(ui.element('status-message').textContent.length>0);
  assert.equal(ui.element('save-tab-rule-btn').disabled,false);
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
