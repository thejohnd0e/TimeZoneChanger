const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function backgroundContext(options = {}) {
  const data = options.data || {
    sync: {settings:{excludedDomains:[], whitelistDomains:[], siteRules:{}, defaultMode:'auto'}},
    local: {timezone:'Europe/Berlin'}, session: {}
  };
  const listeners = {};
  const event = name => ({addListener(fn) { listeners[name] = fn; }});
  const storage = Object.fromEntries(['sync', 'local', 'session'].map(area => [area, {
    async get(keys) {
      const snapshot = structuredClone(data[area]);
      if (options.beforeGet) await options.beforeGet(area, keys);
      if (typeof keys === 'string') return {[keys]:snapshot[keys]};
      return Object.fromEntries(keys.map(key=>[key,snapshot[key]]));
    },
    async set(value) {
      const snapshot = structuredClone(value);
      if (options.beforeSet) await options.beforeSet(area, snapshot);
      Object.assign(data[area], snapshot);
    }
  }]));
  const chrome = {
    storage,
    runtime:{onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message')},
    alarms:{onAlarm:event('alarm'),create(){}},
    webNavigation:{onBeforeNavigate:event('navigate')},
    tabs:{onRemoved:event('removed'),async query(){return [{id:1,url:'https://example.com/'}];}}
  };
  const context = vm.createContext({
    chrome, URL, AbortController,
    console:{log(){},warn(){}},
    setTimeout: options.setTimeout || setTimeout, clearTimeout,
    fetch: options.fetch || (async()=>{throw new Error('offline');}),
    importScripts(file) { vm.runInContext(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),context); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../background.js'),'utf8'),context);
  return {
    data, context, listeners,
    run: expression=>vm.runInContext(expression,context),
    message: (msg,sender={})=>new Promise((resolve,reject)=>{
      try {
        const pending=listeners.message(msg,sender,resolve);
        if(pending !== true) resolve(undefined);
      } catch(error) { reject(error); }
    })
  };
}

module.exports = { backgroundContext, deferred };
