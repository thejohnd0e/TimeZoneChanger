const { pageContext } = require('./page-context.cjs');
const expression = process.argv[2];
const run = process.argv[3] ? pageContext(process.argv[3]) : expression=>eval(expression);
try { console.log(JSON.stringify({value:run(expression)})); }
catch (error) { console.log(JSON.stringify({error:error.name})); }
