const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function uiContext(file='popup.js') {
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{
      value:'',textContent:'',style:{},disabled:false,children:[],listeners:{},
      addEventListener(name,fn){this.listeners[name]=fn;},
      appendChild(child){this.children.push(child);},
      setAttribute(){}
    });
    return elements.get(id);
  };
  const status={hostname:'example.com',mode:'disable',timezone:'UTC',source:'tabOverride',
    siteRule:{mode:'fixed',timezone:'Asia/Tokyo'},tabOverride:{mode:'disable',timezone:''}};
  const calls=[],reloads=[];
  let fail=false,transportError=false;
  const chrome={
    runtime:{
      sendMessage(msg,cb){
        calls.push(msg);
        queueMicrotask(()=>{
          if(transportError){chrome.runtime.lastError={message:'worker unavailable'};cb();delete chrome.runtime.lastError;return;}
          cb(msg.action==='tzc:get-settings'?{settings:{excludedDomains:[],whitelistDomains:[],siteRules:{}},runtime:{timezone:'Europe/Berlin'}}:
            msg.action==='tzc:get-tab-status'?status:fail?{ok:false,error:'invalid-timezone'}:{ok:true,success:true});
        });
      }, openOptionsPage(){}
    },
    tabs:{async query(){return [{id:1,url:'https://example.com'}];},async reload(id){reloads.push(id);}}
  };
  const context=vm.createContext({document:{getElementById:element,createElement:()=>element(Symbol())},chrome,console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),context);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();
  return {element,status,calls,reloads,flush,fail:()=>{fail=true;},transportError:()=>{transportError=true;}};
}
module.exports={uiContext};
