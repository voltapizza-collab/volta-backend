import test from 'node:test';
import assert from 'node:assert/strict';
import { posUiScope } from '../routes/posUi.js';
async function check(path, method='GET', query={}, db={}) {
  const req={path,method,query,posSession:{storeId:1,partnerId:2}};
  let status=200, passed=false;
  const res={status(v){status=v;return this;},json(){return this;}};
  await posUiScope(db)(req,res,()=>{passed=true;});
  return {status,passed,query:req.query};
}
test('POS forces store scope even when client omits it',async()=>{
  assert.deepEqual(await check('/api/myorders/pending'),{status:200,passed:true,query:{storeId:'1',partnerId:'2'}});
});
test('POS rejects foreign stores, partners and non-operational routes',async()=>{
  for(const [path,method,query] of [
    ['/api/myorders/pending','GET',{storeId:3}],['/api/myorders/summary','GET',{partnerId:4}],
    ['/api/stores/3/active','PATCH',{}],['/api/reservations/today/3','GET',{}],
    ['/api/presence/stores/3/status','GET',{}],['/api/stores/1/pos-credentials','GET',{}],
    ['/api/myorders/boosts/activate','POST',{}],['/admin','GET',{}],
  ]) assert.equal((await check(path,method,query)).status,403);
});
test('POS checks order ownership before read, print authorization or mutations',async()=>{
  for(const [method,suffix] of [['GET','messages'],['PATCH','ready'],['POST','messages'],['PATCH','messages/read']]) {
    let where;
    const db={sale:{findFirst:async args=>{where=args.where;return null;}}};
    assert.equal((await check('/api/myorders/8/'+suffix,method,{},db)).status,403);
    assert.deepEqual(where,{id:8,storeId:1,partnerId:2});
  }
});
test('POS allows owned operational resources and denies foreign reservations',async()=>{
  assert.equal((await check('/api/myorders/8/ready','PATCH',{}, {sale:{findFirst:async()=>({id:8})}})).passed,true);
  assert.equal((await check('/api/reservations/8/complete','PATCH',{}, {reservation:{findFirst:async()=>null}})).status,403);
  for(const [path,method] of [['/api/stores/1/active','PATCH'],['/stores/1/ingredients/5','PATCH'],['/api/stores/1/ingredients','GET']])
    assert.equal((await check(path,method)).passed,true);
});
