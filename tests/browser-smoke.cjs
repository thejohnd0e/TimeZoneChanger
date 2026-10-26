// Isolated Chrome integration probe. No packages or existing browser profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');

class CDP {
  constructor(socket) {
    this.socket=socket; this.next=0; this.pending=new Map(); this.events=[];
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(!message.id) {this.events.push(message);return;}
      const task=this.pending.get(message.id);
      if(!task)return;
      this.pending.delete(message.id);clearTimeout(task.timer);
      message.error?task.reject(new Error(JSON.stringify(message.error))):task.resolve(message.result);
    });
  }
  static async connect(url) {
    const socket=new WebSocket(url);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    return new CDP(socket);
  }
  send(method,params={},sessionId) {
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Timeout: ${method}`));},15000);
      this.pending.set(id,{resolve,reject,timer});
      this.socket.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}));
    });
  }
  async evaluate(sessionId,expression) {
    const result=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
    if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,description) {
  const deadline=Date.now()+10000;
  do {const value=await check();if(value)return value;await pause(50);} while(Date.now()<deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const chromePath=process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const tempRoot=process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'Temp','opencode'):os.tmpdir();
  const profile=fs.mkdtempSync(path.join(tempRoot,'tzc-chrome-'));
  const server=http.createServer((req,res)=>{
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(req.url.includes('strict'))res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; frame-src 'self' http://localhost:*; worker-src 'self'");
    if(req.url==='/early.js'||req.url==='/worker.js'){
      res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(__dirname,'fixtures',req.url.slice(1))));return;
    }
    res.setHeader('Content-Type','text/html');
    res.end(req.url==='/frame.html'?'<title>frame</title>':fs.readFileSync(path.join(__dirname,'fixtures/injection.html'),'utf8').replaceAll('PORT',server.address().port));
  });
  await new Promise(resolve=>server.listen(0,resolve));
  const child=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
  let cdp;
  try {
    const endpointFile=path.join(profile,'DevToolsActivePort');
    const endpoint=await until(()=>fs.existsSync(endpointFile)&&fs.readFileSync(endpointFile,'utf8'),'Chrome DevTools endpoint');
    const [port,wsPath]=endpoint.trim().split(/\r?\n/);
    cdp=await CDP.connect(`ws://127.0.0.1:${port}${wsPath}`);
    const version=await cdp.send('Browser.getVersion');
    const {id}=await cdp.send('Extensions.loadUnpacked',{path:path.resolve(__dirname,'..')});
    async function page(url) {
      const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
      await cdp.send('Runtime.enable',{},sessionId);
      await cdp.send('Log.enable',{},sessionId);
      await cdp.send('Page.enable',{},sessionId);
      await cdp.send('Page.navigate',{url},sessionId);
      await until(()=>cdp.evaluate(sessionId,'document.readyState === "complete"'),'page load');
      return {targetId,sessionId};
    }
    const options=await page(`chrome-extension://${id}/options.html`);
    await cdp.evaluate(options.sessionId,`chrome.storage.sync.set({settings:{defaultMode:'auto',excludedDomains:[],whitelistDomains:[],siteRules:{'*':{mode:'fixed',timezone:'Asia/Tokyo'}}}})`);
    await cdp.evaluate(options.sessionId,`chrome.storage.local.set({timezone:'Europe/Berlin'})`);
    const results={browser:version.product,extensionId:id,profile,probes:[]};
    let normal;
    for(const route of ['/normal','/strict']) {
      const tab=await page(`http://127.0.0.1:${server.address().port}${route}`);
      if(route==='/normal') normal=tab;
      // Config is asynchronous; wait until successful injection or an explicit CSP failure.
      await until(async()=>await cdp.evaluate(tab.sessionId,'!!window.__TZ_SPOOFED__') || cdp.events.some(e=>e.sessionId===tab.sessionId && e.method==='Log.entryAdded' && /Content Security Policy/.test(e.params.entry.text)),'injection or CSP block');
      const probe=await cdp.evaluate(tab.sessionId,`(async()=>({route:${JSON.stringify(route)},earlyTimezone,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,savedFormatterTimezone:savedFormatter().resolvedOptions().timeZone,worker:await workerResult,offset:new Date('2026-01-15T12:00:00.123Z').getTimezoneOffset(),frames:['same','blank','srcdoc'].map(id=>({id,timezone:document.getElementById(id).contentWindow.Intl.DateTimeFormat().resolvedOptions().timeZone}))}))()`);
      results.probes.push(probe);
      if(route==='/normal') { assert.equal(probe.timezone,'Asia/Tokyo');assert.equal(probe.offset,-540); }
      const {frameTree}=await cdp.send('Page.getFrameTree',{},tab.sessionId);
      results.probes.at(-1).frameUrls=frameTree.childFrames?.map(frame=>frame.frame.url);
      const cross=await until(async()=>{
        const {targetInfos}=await cdp.send('Target.getTargets');
        return targetInfos.filter(target=>target.type==='iframe'&&target.url.includes('localhost:')).at(-1);
      },'cross-origin frame target');
      const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:cross.targetId,flatten:true});
      await until(()=>cdp.evaluate(sessionId,'!!window.__TZ_SPOOFED__'),'cross-origin injection');
      const crossTimezone=await cdp.evaluate(sessionId,'Intl.DateTimeFormat().resolvedOptions().timeZone');
      assert.equal(crossTimezone,'Asia/Tokyo');
      results.probes.at(-1).crossTimezone=crossTimezone;
    }
    const popup=await page(`chrome-extension://${id}/popup.html`);
    await cdp.send('Target.activateTarget',{targetId:popup.targetId});
    await cdp.evaluate(popup.sessionId,'updateUI()');
    assert.equal(await cdp.evaluate(popup.sessionId,'document.getElementById("apply-rule-btn").disabled'),true);
    assert.equal(await cdp.evaluate(popup.sessionId,'document.getElementById("effective-timezone").textContent'),'Not available');
    assert.equal(await cdp.evaluate(popup.sessionId,'document.querySelectorAll("#apply-rule-btn").length'),1);
    assert.equal(await cdp.evaluate(popup.sessionId,'document.querySelectorAll("#save-site-rule-btn, #save-tab-rule-btn, #add-exclusion-btn").length'),0);
    assert.equal(await cdp.evaluate(popup.sessionId,'document.getElementById("open-options-btn").disabled'),false);
    assert.equal(await cdp.evaluate(popup.sessionId,'document.getElementById("refresh-btn").disabled'),false);
    const internal=await page('chrome://settings/');
    await cdp.send('Target.activateTarget',{targetId:internal.targetId});
    await cdp.evaluate(popup.sessionId,'updateUI()');
    assert.equal(await cdp.evaluate(popup.sessionId,'document.getElementById("apply-rule-btn").disabled'),true);
    assert.equal(await cdp.evaluate(popup.sessionId,'document.getElementById("page-message").hidden'),false);
    const normalTabId=await cdp.evaluate(options.sessionId,`(async()=>{const tabs=await chrome.tabs.query({url:'http://127.0.0.1:${server.address().port}/normal'});await chrome.tabs.update(tabs[0].id,{active:true});return tabs[0].id;})()`);
    await cdp.evaluate(popup.sessionId,'updateUI()');
    assert.equal(await cdp.evaluate(popup.sessionId,'document.getElementById("effective-timezone").textContent'),'Asia/Tokyo');
    assert.equal(await cdp.evaluate(popup.sessionId,'document.getElementById("rule-scope").value'),'site');
    await cdp.evaluate(popup.sessionId,`document.getElementById('rule-mode').value='fixed';document.getElementById('rule-mode').dispatchEvent(new Event('change'));document.getElementById('rule-timezone').value='Not/AZone';document.getElementById('apply-rule-btn').click()`);
    await until(()=>cdp.evaluate(popup.sessionId,'document.getElementById("status-message").textContent.includes("valid timezone")'),'invalid UI timezone error');
    await cdp.evaluate(popup.sessionId,`document.getElementById('rule-timezone').value='Asia/Kathmandu';document.getElementById('apply-rule-btn').click()`);
    await until(()=>cdp.evaluate(popup.sessionId,'document.getElementById("status-message").textContent.includes("Saved")'),'saved UI site rule');
    const kathmandu=await cdp.evaluate(options.sessionId,'new Intl.DateTimeFormat("en", {timeZone:"Asia/Kathmandu"}).resolvedOptions().timeZone');
    try {
      await until(()=>cdp.evaluate(normal.sessionId,`Intl.DateTimeFormat().resolvedOptions().timeZone === ${JSON.stringify(kathmandu)}`),'saved site rule application');
    } catch(error) {
      console.error('UI diagnostic',JSON.stringify({
        popup:await cdp.evaluate(popup.sessionId,'({currentHost,currentTabId,scope:document.getElementById("rule-scope").value,mode:document.getElementById("rule-mode").value,status:document.getElementById("status-message").textContent})'),
        storage:await cdp.evaluate(options.sessionId,'chrome.storage.sync.get("settings")'),
        page:await cdp.evaluate(normal.sessionId,'({url:location.href,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,marker:window.__TZ_SPOOFED__,dataset:document.documentElement.dataset.tzChanger})')
      }));
      throw error;
    }
    results.ui={singleEditor:'one scoped form, old duplicated forms removed',unsupportedPages:'extension and chrome pages disabled',popupInvalidTimezone:'reported',siteSaveAndReload:'Asia/Kathmandu'};
    async function applyPopupRule(scope,mode,timezone='') {
      await cdp.evaluate(popup.sessionId,`document.getElementById('rule-scope').value=${JSON.stringify(scope)};document.getElementById('rule-scope').dispatchEvent(new Event('change'));document.getElementById('rule-mode').value=${JSON.stringify(mode)};document.getElementById('rule-mode').dispatchEvent(new Event('change'));document.getElementById('rule-timezone').value=${JSON.stringify(timezone)};document.getElementById('apply-rule-btn').click()`);
      await until(()=>cdp.evaluate(popup.sessionId,'document.getElementById("status-message").textContent.includes("Saved")'),'saved scoped popup rule');
    }
    await applyPopupRule('tab','fixed','UTC');
    await until(()=>cdp.evaluate(normal.sessionId,'Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC"'),'popup tab fixed UTC');
    await applyPopupRule('tab','inherit');
    await until(()=>cdp.evaluate(normal.sessionId,`Intl.DateTimeFormat().resolvedOptions().timeZone === ${JSON.stringify(kathmandu)}`),'popup tab inheritance');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:760,deviceScaleFactor:1,mobile:false},popup.sessionId);
    const screenshot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},popup.sessionId);
    const screenshotPath=path.join(tempRoot,'tzc-popup-preview.png');
    fs.writeFileSync(screenshotPath,Buffer.from(screenshot.data,'base64'));
    results.ui.preview=screenshotPath;
    const message=msg=>cdp.evaluate(options.sessionId,`chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
    await message({action:'tzc:set-tab-rule',tabId:normalTabId,mode:'disable'});
    await cdp.send('Page.reload',{},normal.sessionId);
    await until(()=>cdp.evaluate(normal.sessionId,'document.readyState === "complete"'),'disabled page reload');
    assert.notEqual(await cdp.evaluate(normal.sessionId,'Intl.DateTimeFormat().resolvedOptions().timeZone'),kathmandu);
    await message({action:'tzc:set-tab-rule',tabId:normalTabId,mode:'fixed',timezone:'UTC'});
    await cdp.send('Page.reload',{},normal.sessionId);
    await until(()=>cdp.evaluate(normal.sessionId,'Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC"'),'tab fixed UTC');
    await message({action:'tzc:set-tab-rule',tabId:normalTabId,mode:'inherit'});
    await cdp.send('Page.reload',{},normal.sessionId);
    await until(()=>cdp.evaluate(normal.sessionId,`Intl.DateTimeFormat().resolvedOptions().timeZone === ${JSON.stringify(kathmandu)}`),'tab inheritance');
    results.ui.tabRules='disable/fixed/inherit verified';
    async function settings(value) {
      const result=await message({action:'tzc:update-settings',settings:{defaultMode:'auto',excludedDomains:[],whitelistDomains:[],siteRules:{},...value}});
      assert.equal(result.ok,true);
    }
    async function reloadTimezone(tab,timezone) {
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>cdp.evaluate(tab.sessionId,`document.readyState === 'complete' && Intl.DateTimeFormat().resolvedOptions().timeZone === ${JSON.stringify(timezone)}`),'reloaded timezone '+timezone);
    }
    const systemTimezone=await cdp.evaluate(options.sessionId,'Intl.DateTimeFormat().resolvedOptions().timeZone');
    await settings({excludedDomains:['127.0.0.1'],siteRules:{'*':{mode:'fixed',timezone:'UTC'}}});
    await reloadTimezone(normal,systemTimezone);
    await settings({whitelistDomains:['not-this-site.example'],siteRules:{'*':{mode:'fixed',timezone:'UTC'}}});
    await reloadTimezone(normal,systemTimezone);
    await settings({});
    await cdp.evaluate(options.sessionId,'chrome.storage.local.set({timezone:"Europe/Berlin"})');
    await reloadTimezone(normal,'Europe/Berlin');
    await cdp.evaluate(options.sessionId,'chrome.storage.local.set({timezone:"Asia/Tokyo"})');
    await reloadTimezone(normal,'Europe/Berlin');
    const fresh=await page(`http://127.0.0.1:${server.address().port}/fresh`);
    await until(()=>cdp.evaluate(fresh.sessionId,'Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Tokyo"'),'new auto tab timezone');
    await cdp.send('Target.closeTarget',{targetId:fresh.targetId});
    results.ui.exclusionWhitelist='both take precedence over site rules';
    results.ui.autoLock='reload retains confirmed zone; new tab uses updated runtime';
    results.errors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Log.entryAdded'&&e.params.entry.level==='error').map(e=>e.params);
    console.log(JSON.stringify(results,null,2));
  } finally {
    if(cdp){await cdp.send('Browser.close').catch(()=>{});cdp.socket.close();}
    child.kill();
    await new Promise(resolve=>server.close(resolve));
    // Keep only the isolated profile for diagnosis; never touch the user's profile.
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
