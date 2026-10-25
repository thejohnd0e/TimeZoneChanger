const test = require('node:test');
const assert = require('node:assert/strict');
const { pageContext } = require('./helpers/page-context.cjs');

test('milliseconds do not leak into timezone offset or GMT string', () => {
  const run = pageContext();
  assert.equal(run('new Date("2026-01-15T12:00:00.123Z").getTimezoneOffset()'), 300);
  assert.match(run('new Date("2026-01-15T12:00:00.123Z").toString()'), /GMT-0500 /);
});

test('invalid Date offset is NaN, not an exception', () => {
  assert.ok(Number.isNaN(pageContext()('new Date(NaN).getTimezoneOffset()')));
});

for (const [zone, stamp, expected] of [
  ['UTC', '2026-01-15T12:00:00.999Z', 0],
  ['Asia/Kolkata', '2026-01-15T12:00:00.123Z', -330],
  ['Asia/Kathmandu', '2026-01-15T12:00:00.123Z', -345],
  ['America/New_York', '2026-07-15T12:00:00.123Z', 240],
  ['America/New_York', '1969-12-31T23:59:59.999Z', 300]
]) test(`offset for ${zone} at ${stamp}`, () => {
  assert.equal(pageContext(zone)(`new Date(${JSON.stringify(stamp)}).getTimezoneOffset()`), expected);
});

test('Intl preserves inherited explicit timezone and format properties', () => {
  const run = pageContext();
  assert.equal(run('new Intl.DateTimeFormat("en-US", Object.create({timeZone:"Asia/Tokyo"})).resolvedOptions().timeZone'), 'Asia/Tokyo');
  assert.equal(run('new Intl.DateTimeFormat("en-US", Object.create({year:"2-digit"})).resolvedOptions().year'), '2-digit');
  assert.equal(run('new Date("2026-01-15T12:00:00Z").toLocaleTimeString("en-US", Object.create({timeZone:"Asia/Tokyo", hour12:false}))'), '21:00:00');
});

test('Intl preserves native invalid-option errors and explicit timezone', () => {
  const run = pageContext();
  assert.throws(() => run('new Intl.DateTimeFormat("en", {timeZone:"Not/AZone"})'), {name:'RangeError'});
  assert.throws(() => run('new Intl.DateTimeFormat("en", null)'), {name:'TypeError'});
  assert.equal(run('Intl.DateTimeFormat("en", {timeZone:"UTC"}).resolvedOptions().timeZone'), 'UTC');
});

test('pre-existing formatter does not lie about its explicit timezone', () => {
  const run=pageContext('America/New_York','oldFormat = new Intl.DateTimeFormat("en", {timeZone:"Asia/Tokyo"})');
  assert.equal(run('oldFormat.resolvedOptions().timeZone'),'Asia/Tokyo');
});
