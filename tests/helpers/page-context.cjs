const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function pageContext(timezone = 'America/New_York') {
  const context = vm.createContext({
    document: { documentElement: { dataset: { tzChanger: timezone } }, dispatchEvent() {} },
    CustomEvent: function () {},
    XMLHttpRequest: function () {}
  });
  vm.runInContext('window = globalThis; XMLHttpRequest.prototype.send = function() {};', context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../spoof.js'), 'utf8'), context);
  return (expression) => vm.runInContext(expression, context);
}

module.exports = { pageContext };
