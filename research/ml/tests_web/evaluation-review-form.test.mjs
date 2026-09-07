import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM, VirtualConsole} from 'jsdom';

const assets = new URL('../src/ht_tibetan/reviewer_assets/', import.meta.url);
const shell = readFileSync(new URL('evaluation-form.html', assets), 'utf8');
const css = readFileSync(new URL('evaluation-form.css', assets), 'utf8');
const script = readFileSync(new URL('evaluation-form.js', assets), 'utf8');
const exact = '  བོད་ཡིག་ e\u0301\n中文 🥣 </script><img src=x onerror=bad()>  ';
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  return {schema_version:'1.0', kind:'blinded_evaluation_native_review', evidence_kind:'synthetic_test', reviewer_id:'fixture-reader',
    status:'incomplete', independent:false, limitations:['Exact contents are preserved.'],
    items:[0,1].map(i => ({item_id:`item-${i}`,candidate_alias:`candidate-${i}`,source_text:exact,question:`${i} ག་རེ།`,
      messages:[{role:'user',content:exact}],answer:exact,status:'incomplete',ratings:{fidelity:null,comprehension:null,naturalness:null},
      critical_errors:{number_changed:'not_assessed',negation_changed:'not_assessed'},minutes_spent:null,blind_compromised:false,notes:''})),
    candidate_decisions:[0,1].map(i => ({candidate_alias:`candidate-${i}`,recommendation:'pending',rationale:''}))};
}
function open(t, packet=fixture()) {
  const html = shell.replace('__EVALUATION_CSS__',css).replace('__EVALUATION_JS__','').replace('__EVALUATION_CSP__',"default-src 'none'")
    .replace('__EVALUATION_PACKET__',Buffer.from(JSON.stringify(packet)).toString('base64'));
  const errors=[],downloads=[],blobs=new Map(), virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(html,{url:'file:///tmp/review.html',runScripts:'outside-only',virtualConsole});
  const {window}=dom;
  window.TextDecoder=TextDecoder;window.Blob=Blob;
  window.URL.createObjectURL=blob=>{const key=`blob:fixture-${blobs.size}`;blobs.set(key,blob);return key;};
  window.URL.revokeObjectURL=()=>{};
  window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,filename:this.download});};
  window.fetch=()=>{throw new Error('No network');};
  t.after(()=>{dom.window.close();assert.equal(errors.length,0,errors.map(error=>error.message).join('\n'));});
  vm.runInContext(script,dom.getInternalVMContext());
  const byId=id=>window.document.getElementById(id);
  function change(id,value,event='change'){const node=byId(id);node.value=value;node.dispatchEvent(new window.Event(event,{bubbles:true}));}
  function click(id){byId(id).click();}
  async function download(){click('download-review');assert.ok(downloads.length);return JSON.parse(await blobs.get(downloads.at(-1).href).text());}
  return {window,byId,change,click,download,downloads};
}
function finishItem(form,index=0){form.change('item-select',String(index));for(const axis of ['fidelity','comprehension','naturalness'])form.change(`rating-${axis}`,'3');
  form.change('critical-0','absent');form.change('critical-1','present');form.change('minutes-spent','1.5','input');}

test('standalone assets have no remote or executable-HTML surfaces',()=>{
  assert.doesNotMatch(script,/\b(?:innerHTML|outerHTML|eval|fetch|XMLHttpRequest|localStorage|sessionStorage|serviceWorker)\b/);
  assert.doesNotMatch(shell+css+script,/https?:\/\/|@import|url\(/);
  for(const token of ['__EVALUATION_CSS__','__EVALUATION_JS__','__EVALUATION_PACKET__','__EVALUATION_CSP__'])assert.equal(shell.split(token).length-1,1);
});
test('blank form preserves exact Unicode, aliases and every unanswered field',async t=>{
  const packet=fixture(), form=open(t,packet);
  assert.equal(form.byId('source-text').textContent,exact);
  assert.equal(form.byId('answer-text').textContent,exact);
  assert.equal(form.window.document.querySelectorAll('img').length,0);
  assert.equal(form.byId('minutes-spent').value,'');
  assert.equal(form.byId('item-complete').checked,false);
  assert.equal(form.byId('review-complete').disabled,true);
  assert.deepEqual(await form.download(),packet);
});
test('partial ratings persist between answers and language controls without invented time',async t=>{
  const form=open(t);form.change('rating-fidelity','2');form.change('notes','  ཀ་ e\u0301\n','input');
  form.change('item-select','1');form.change('language','zh');form.change('item-select','0');
  assert.equal(form.byId('rating-fidelity').value,'2');assert.equal(form.byId('notes').value,'  ཀ་ e\u0301\n');
  assert.equal(form.byId('download-review').textContent,'下载评审');
  assert.equal(form.byId('source-text').textContent,exact);
  const result=await form.download();assert.equal(result.items[0].minutes_spent,null);assert.equal(result.items[0].status,'incomplete');
  assert.equal(result.items[1].ratings.fidelity,null);assert.equal(result.status,'incomplete');
});
test('filling every item field does not automatically complete that item',async t=>{
  const form=open(t);finishItem(form);
  assert.equal(form.byId('item-complete').disabled,false);assert.equal(form.byId('item-complete').checked,false);
  assert.equal((await form.download()).items[0].status,'incomplete');
  form.click('item-complete');assert.equal((await form.download()).items[0].status,'complete');
  form.change('rating-fidelity','');assert.equal(form.byId('item-complete').checked,false);
  assert.equal((await form.download()).items[0].status,'incomplete');
});
test('whole-review completion requires explicit independence, recommendations and final click',async t=>{
  const packet=fixture(),form=open(t,packet);
  for(const index of [0,1]){finishItem(form,index);form.click('item-complete');form.change('candidate-select',String(index));
    form.change('recommendation','revise');form.change('rationale',`Synthetic test rationale ${index}`,'input');}
  assert.equal(form.byId('review-complete').disabled,true);form.click('independent');
  assert.equal(form.byId('review-complete').disabled,false);assert.equal(form.byId('review-complete').checked,false);
  form.click('review-complete');const returned=await form.download();assert.equal(returned.status,'complete');
  assert.equal(returned.independent,true);assert.equal(returned.items[0].minutes_spent,1.5);
  for(let i=0;i<2;i++){for(const key of ['item_id','candidate_alias','source_text','question','messages','answer'])assert.deepEqual(returned.items[i][key],packet.items[i][key]);}
  form.change('rationale','','input');assert.equal((await form.download()).status,'incomplete');
});
test('candidate decisions preserve opaque identities and blinding disclosure is an explicit change',async t=>{
  const packet=fixture(),form=open(t,packet);form.change('candidate-select','1');form.change('recommendation','reject');
  form.change('rationale','Needs another independent review.','input');form.click('blind-compromised');
  const result=await form.download();assert.equal(result.candidate_decisions[1].candidate_alias,packet.candidate_decisions[1].candidate_alias);
  assert.equal(result.candidate_decisions[1].recommendation,'reject');assert.equal(result.candidate_decisions[0].recommendation,'pending');
  assert.equal(result.items[0].blind_compromised,true);assert.equal(result.items[1].blind_compromised,false);
});
test('invalid minutes and overlong notes block downloading rather than fabricating values',async t=>{
  const form=open(t);form.change('minutes-spent','-1','input');assert.equal(form.byId('download-review').disabled,true);
  assert.match(form.byId('error').textContent,/review time/);form.click('download-review');assert.equal(form.downloads.length,0);
  form.change('minutes-spent','','input');form.change('notes','x'.repeat(8001),'input');assert.equal(form.byId('download-review').disabled,true);
  form.change('notes','','input');const result=await form.download();assert.equal(result.items[0].minutes_spent,null);
});
test('critical flags remain not assessed unless explicitly chosen',async t=>{
  const form=open(t);for(const axis of ['fidelity','comprehension','naturalness'])form.change(`rating-${axis}`,'4');
  form.change('minutes-spent','0','input');assert.equal(form.byId('item-complete').disabled,true);
  const result=await form.download();assert.deepEqual(result.items[0].critical_errors,{number_changed:'not_assessed',negation_changed:'not_assessed'});
  assert.equal(result.items[0].minutes_spent,0);
});
