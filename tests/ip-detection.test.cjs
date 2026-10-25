const test = require('node:test');
const assert = require('node:assert/strict');
const { backgroundContext, deferred } = require('./helpers/background-context.cjs');
const response = data=>({ok:true,json:async()=>data});

test('concurrent refresh callers share the successful result', async () => {
  const gate=deferred();
  const bg=backgroundContext({fetch:()=>gate.promise});
  const a=bg.run('updateTimezone(true)'), b=bg.run('updateTimezone(true)');
  gate.resolve(response({timezone:{id:'Asia/Tokyo'},ip:'203.0.113.1'}));
  assert.deepEqual(await Promise.all([a,b]),[true,true]);
  assert.equal(bg.data.local.timezone,'Asia/Tokyo');
});

test('timed-out primary falls back instead of blocking all updates', async () => {
  const bg=backgroundContext({
    setTimeout:fn=>setTimeout(fn,1),
    fetch:async(url,{signal}={})=>{
      if(url.includes('ipwho')) {
        return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(new Error('aborted'))));
      }
      return response({timeZones:['Asia/Kathmandu'],ipAddress:'203.0.113.2'});
    }
  });
  const result=await Promise.race([bg.run('updateTimezone(true)'),new Promise(resolve=>setTimeout(()=>resolve('stuck'),100))]);
  assert.equal(result,true);
  assert.equal(bg.data.local.timezone,'Asia/Kathmandu');
});

test('invalid provider timezone is rejected before storing runtime', async () => {
  const bg=backgroundContext({fetch:async(url)=>response(url.includes('ipwho')?{timezone:{id:'Not/AZone'}}:{timeZones:['UTC'],ipAddress:'203.0.113.3'})});
  assert.equal(await bg.run('updateTimezone(true)'),true);
  assert.equal(bg.data.local.timezone,'UTC');
});

test('bad JSON and offline fallback preserve last known good runtime', async () => {
  const bg=backgroundContext({fetch:async(url)=>{
    if(url.includes('ipwho')) return {ok:true,json:async()=>{throw new Error('bad json');}};
    throw new Error('offline');
  }});
  assert.equal(await bg.run('updateTimezone(true)'),false);
  assert.equal(bg.data.local.timezone,'Europe/Berlin');
});
