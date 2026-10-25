const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const probe=path.join(__dirname,'helpers/date-probe.cjs');
function evaluate(expression,zone,spoof=false) {
  return JSON.parse(execFileSync(process.execPath,[probe,expression,...spoof?[zone]:[]],{
    env:{...process.env,TZ:spoof?'Europe/Moscow':zone},encoding:'utf8'
  }));
}

const cases=[
  ['local getters', '(()=>{const d=new Date("2026-01-15T12:34:56.789Z");return [d.getFullYear(),d.getMonth(),d.getDate(),d.getDay(),d.getHours(),d.getMinutes(),d.getSeconds(),d.getMilliseconds(),d.getYear()];})()'],
  ['constructor fields', '[new Date(2026,0,15,7,30,5,123).getTime(),new Date(26,0,1).getTime(),new Date(2026,12,0,25).getTime()]'],
  ['ISO local parsing', '[new Date("2026-01-15T12:30:45.123").getTime(), Date.parse("2026-01-15T12:30"), new Date("2026-01-15").getTime()]'],
  ['lowercase ISO local separator', '[Date.parse("2026-01-15t12:00:00"),new Date("2026-01-15t12:00:00").getTime()]'],
  ['whitespace date-only strings keep native local interpretation', '[Date.parse("2026-01-15 "),new Date(" 2026-01-15").getTime()]'],
  ['legacy local parsing', '[new Date("Jan 15 2026 12:30:00").getTime(), Date.parse("01/15/2026 12:30:00")]'],
  ['explicit offset remains absolute', '[new Date("2026-01-15T12:30:00+09:00").getTime(), Date.parse("2026-01-15T12:30:00Z"),new Date(123).getTime()]'],
  ['local setters', '(()=>{return ["setFullYear","setMonth","setDate","setHours","setMinutes","setSeconds","setMilliseconds","setYear"].map((m,i)=>{const d=new Date("2026-01-15T12:34:56.789Z");return [d[m](...[2027,5,20,4,15,10,456,26].slice(i,i+1)),d.getTime()];});})()'],
  ['setter extra arguments and overflow', '(()=>{const d=new Date("2026-01-31T12:34:56.789Z");return [d.setMonth(1,31),d.setHours(25,61,61,1001),d.setFullYear(2027,12,32)];})()'],
  ['invalid dates and recovery', '(()=>{const d=new Date(NaN); const a=[d.getHours(),d.getFullYear(),d.setHours(3)];a.push(d.setFullYear(2026,0,1),d.getTime()); const y=new Date(NaN);a.push(y.setYear(26));return a;})()'],
  ['DST gap and overlap constructors', '[new Date(2026,2,8,2,30).getTime(),new Date(2026,10,1,1,30).getTime()]'],
  ['DST gap and overlap parsing', '[Date.parse("2026-03-08T02:30:00"),Date.parse("2026-11-01T01:30:00")]'],
  ['DST local setters', '(()=>{const a=new Date("2026-03-08T05:30:00Z"),b=new Date("2026-11-01T04:30:00Z");return [a.setHours(2,30),b.setHours(1,30)];})()'],
  ['UTC and serialization unchanged', '(()=>{const d=new Date("2026-01-15T12:34:56.789Z");return [d.getUTCHours(),d.setUTCDate(20),d.toISOString(),d.toJSON(),Date.UTC(2026,0,1),+new Date(d)];})()'],
  ['prototype and subclass', '(()=>{class Custom extends Date {};const d=new Custom(2026,0,15,7);return [d instanceof Date,d instanceof Custom,d.constructor===Custom,Object.prototype.toString.call(d),d.getTime(),Date.prototype.constructor===Date];})()'],
  ['coercion semantics', '[+new Date({[Symbol.toPrimitive](){return "2026-01-15T12:00";}}),new Date(null).getTime(),new Date(undefined).getTime(),new Date(true).getTime()]'],
  ['historical years', '(()=>{const d=new Date("0050-01-15T12:00:00Z");return [d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds(),d.getTimezoneOffset()];})()']
  ,['BC dates', '(()=>{const d=new Date("-000001-01-15T12:00:00Z");return [d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getSeconds(),d.getTimezoneOffset()];})()']
  ,['Date range boundaries', '[8640000000000000,-8640000000000000].map(t=>{const d=new Date(t);return [d.getFullYear(),d.getMonth(),d.getDate(),d.getDay(),d.getHours(),d.getMinutes(),d.getSeconds(),d.getMilliseconds(),d.getTimezoneOffset()];})']
  ,['setter truncates before year remapping', '[new Date(99.9,0,1).getTime(),new Date(-0.9,0,1).getTime()]']
  ,['Date copy bypasses primitive conversion', '(()=>{const d=new Date(123);d[Symbol.toPrimitive]=()=>{throw new Error("wrong coercion");};return new Date(d).getTime();})()']
  ,['upper TimeClip local construction follows native clipping', 'new Date(275760,8,13).getTime()']
  ,['upper TimeClip valid local construction stays representable', 'new Date(275760,8,13,1).getTime()']
  ,['lower TimeClip local construction follows native clipping', 'new Date(-271821,3,20).getTime()']
];

for(const zone of ['America/New_York','Asia/Kathmandu','Australia/Lord_Howe','UTC']) {
  for(const [name,expression] of cases) test(`${zone}: ${name}`,()=>{
    assert.deepEqual(evaluate(expression,zone,true),evaluate(expression,zone));
  });
}

test('Date() call uses spoofed time representation, even when given arguments',()=>{
  const {pageContext}=require('./helpers/page-context.cjs');
  const run=pageContext('Asia/Kathmandu');
  assert.match(run('Date()'),/GMT\+0545 /);
  assert.match(run('Date(0)'),/GMT\+0545 /);
});
