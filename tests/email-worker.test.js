const test = require('node:test');
const assert = require('node:assert/strict');
const fakeDb = require('./helpers/firestore');
const { processOutbox, configuration, WINDOW_MS } = require('../lib/emailOutbox');
const env = { EMAIL_OUTBOX_ENABLED:'true', EMAIL_MODE:'test', RESEND_API_KEY:'fake',
  RESEND_FROM_EMAIL:'onboarding@resend.dev', OWNER_EMAIL:'owner@example.com', EMAIL_TEST_RECIPIENT:'owner@example.com' };
function setup() {
  const store = fakeDb({
    'orders/order1': { total:25, paymentId:'pi_1', paymentStatus:'succeeded', stockUpdated:true, email:'customer@example.com' },
    'emailOutbox/customer_paid_order1': { orderId:'order1', kind:'customer_order_paid', recipient:'customer@example.com', state:'pending' },
    'emailOutbox/owner_paid_order1': { orderId:'order1', kind:'owner_new_sale', state:'pending' }
  });
  const intent = { id:'pi_1', status:'succeeded', metadata:{orderId:'order1'}, amount:2500, amount_received:2500, currency:'usd', livemode:false };
  const sent=[]; let time=1000000;
  const args={ db:store.db, env, stripe:{paymentIntents:{retrieve:async()=>intent}}, now:()=>time,
    send:async(m,o)=>{sent.push({m,o});return 'email_'+sent.length;} };
  return {...store,args,intent,sent,advance:n=>time+=n};
}
test('concurrent workers send each kind once, test mode redirects both to owner',async()=>{
  const s=setup(); await Promise.all([processOutbox(s.args),processOutbox(s.args)]);
  await processOutbox(s.args); assert.equal(s.sent.length,2);
  assert.ok(s.sent.every(x=>x.m.to==='owner@example.com' && x.m.subject.startsWith('[PRUEBA')));
  assert.equal(s.data.get('emailOutbox/customer_paid_order1').state,'sent');
});
for(const [name,change] of Object.entries({pending:i=>i.status='processing',amount:i=>i.amount=1,currency:i=>i.currency='eur',partial:i=>i.amount_received=1,metadata:i=>i.metadata.orderId='other',live:i=>i.livemode=true})) {
  test('blocks Stripe mismatch: '+name,async()=>{const s=setup();change(s.intent);await processOutbox(s.args);assert.equal(s.sent.length,0);});
}
test('unpaid order never reaches Stripe or Resend',async()=>{
  const s=setup();s.data.get('orders/order1').paymentStatus='failed';
  s.args.stripe.paymentIntents.retrieve=async()=>{throw Error('must not retrieve');};
  await processOutbox(s.args);assert.equal(s.sent.length,0);
});
test('retry uses frozen payload and same key after uncertain network response',async()=>{
  const s=setup();s.data.delete('emailOutbox/owner_paid_order1');let first;
  s.args.send=async(m,o)=>{first={m,o};throw Error('timeout');};
  await processOutbox(s.args);s.advance(120000);
  s.args.env={...env,RESEND_FROM_EMAIL:'changed@example.com'};
  s.args.send=async(m,o)=>{assert.deepEqual(m,first.m);assert.equal(o.idempotencyKey,first.o.idempotencyKey);return 'recovered';};
  await processOutbox(s.args);assert.equal(s.data.get('emailOutbox/customer_paid_order1').providerId,'recovered');
});
test('expired uncertain send goes to review and is never blindly resent',async()=>{
  const s=setup();s.args.send=async()=>{throw Error('timeout');};await processOutbox(s.args);
  s.advance(WINDOW_MS+1);s.args.send=async()=>{throw Error('must not send');};
  await processOutbox(s.args);assert.equal(s.data.get('emailOutbox/customer_paid_order1').state,'review');
});
test('disabled and preview workers fail closed',async()=>{
  assert.deepEqual(await processOutbox({env:{}}),{disabled:true});
  assert.throws(()=>configuration({...env,VERCEL_ENV:'preview'}));
  assert.throws(()=>configuration({...env,EMAIL_MODE:'live'}));
});
test('provider rejection is held for review without exposing response secrets',async()=>{
  const s=setup();s.args.send=async()=>{const e=Error('sensitive body');e.status=403;throw e;};
  await processOutbox(s.args);assert.equal(s.data.get('emailOutbox/customer_paid_order1').reason,'provider_rejected');
});
test('stale lease recovered; invalid recipient cannot be redirected into a customer job',async()=>{
  const s=setup();const job=s.data.get('emailOutbox/customer_paid_order1');
  job.state='processing';job.leaseUntil=1;job.recipient='attacker@example.com';
  await processOutbox(s.args);assert.equal(s.data.get('emailOutbox/customer_paid_order1').state,'review');assert.equal(s.sent.length,1);
});
