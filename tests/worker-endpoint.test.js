const test = require('node:test'); const assert = require('node:assert/strict');
const handler = require('../api/process-email-outbox');
function response(){return {code:0,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};}
test('worker rejects unauthenticated requests before loading Firebase',async()=>{
  const r=response();await handler({method:'POST',headers:{}},r);assert.equal(r.code,401);
});
test('worker accepts no GET requests',async()=>{const r=response();await handler({method:'GET',headers:{}},r);assert.equal(r.code,405);});
test('authorized disabled worker does not initialize external services',async()=>{
  process.env.EMAIL_WORKER_SECRET='x'.repeat(32);process.env.EMAIL_OUTBOX_ENABLED='false';
  try{const r=response();await handler({method:'POST',headers:{authorization:'Bearer '+'x'.repeat(32)}},r);assert.equal(r.code,200);assert.deepEqual(r.body,{disabled:true});}
  finally{delete process.env.EMAIL_WORKER_SECRET;delete process.env.EMAIL_OUTBOX_ENABLED;}
});
