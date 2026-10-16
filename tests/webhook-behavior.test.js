const test=require('node:test'); const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');const fakeDb=require('./helpers/firestore');
function setup(type='payment_intent.succeeded') {
  const store=fakeDb({'orders/order1':{total:25,email:'customer@example.com',paymentId:'pi_1',items:[{id:'p1',quantity:1}],stockUpdated:false},'products/p1':{stock:2}});
  const event={id:'evt_1',type,data:{object:{id:'pi_1',status:'succeeded',metadata:{orderId:'order1'},amount:2500,currency:'usd'}}};
  let signature=true;
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/webhook'),'utf8'),{module,Buffer,console:{error(){}},process:{env:{STRIPE_SECRET_KEY:'fake',STRIPE_WEBHOOK_SECRET:'fake'}},require:name=>name==='stripe'?()=>({webhooks:{constructEvent(){if(!signature)throw Error('bad signature');return event;}}}):{db:store.db,admin:{firestore:{FieldValue:{serverTimestamp:()=>123}}}}});
  const call=async()=>{let status;const req={method:'POST',headers:{'stripe-signature':'fake'},async *[Symbol.asyncIterator](){yield Buffer.from('{}');}};await module.exports(req,{status(n){status=n;return this;},json(){}});return status;};
  return {...store,event,call,badSignature:()=>signature=false};
}
test('successful webhook queues real email and replay does not decrement or replace sent jobs',async()=>{
  const s=setup();assert.equal(await s.call(),200);assert.equal(s.data.get('products/p1').stock,1);
  assert.equal(s.data.get('emailOutbox/customer_paid_order1').recipient,'customer@example.com');
  s.data.get('emailOutbox/customer_paid_order1').state='sent';assert.equal(await s.call(),200);
  assert.equal(s.data.get('products/p1').stock,1);assert.equal(s.data.get('emailOutbox/customer_paid_order1').state,'sent');
});
test('failed payment queues no confirmation',async()=>{const s=setup('payment_intent.payment_failed');assert.equal(await s.call(),200);assert.equal(s.data.size,2);assert.equal(s.data.get('products/p1').stock,2);});
test('invalid signature and wrong amount do not write',async()=>{const s=setup();s.badSignature();assert.equal(await s.call(),400);assert.equal(s.data.size,2);const t=setup();t.event.data.object.amount=1;assert.equal(await t.call(),500);assert.equal(t.data.size,2);});
