import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const args=process.argv.slice(2),packageIndex=args.indexOf('--ajv-package');
const require=createRequire(packageIndex<0?new URL('../site-app/package.json',import.meta.url):resolve(args[packageIndex+1])),Ajv=require('ajv/dist/2020').default,addFormats=require('ajv-formats');
const ajv=new Ajv({allErrors:true,strict:false});addFormats(ajv);
const schema=JSON.parse(readFileSync(new URL('./procedure-execution.schema.json',import.meta.url),'utf8'));assert(ajv.validateSchema(schema),JSON.stringify(ajv.errors));const validate=ajv.compile(schema);
const base={id:'EXEC-fixture',revision:1,briefRevision:2,programRevision:3,procedureRevision:1,performed:'Inspected synthetic source records',steps:[{id:'STEP-1',state:'performed',notes:'Source evidence checked'}],sampling:'All synthetic records',results:'Synthetic records reconcile',limitations:'Fixture only',evidenceIds:['EV-fixture'],runIds:['RUN-fixture'],actor:'fixture-author',at:'2026-10-07T12:00:00Z'};
assert(validate(base),JSON.stringify(validate.errors));
const hashed={...base,planHash:'a'.repeat(64)};assert(validate(hashed),JSON.stringify(validate.errors));
const mutations=[v=>{v.briefRevision=0;},v=>{v.performed=' ';},v=>{v.evidenceIds=[];},v=>{v.steps[0]={...v.steps[0],state:'not_performed',notes:''};},v=>{v.at='not-a-date';},v=>{v.runIds=['RUN-fixture','RUN-fixture'];},v=>{v.automaticallyCompliant=true;},v=>{v.planHash='A'.repeat(64);},v=>{v.planHash='a'.repeat(63);}];
for(const mutate of mutations){const v=structuredClone(base);mutate(v);assert.equal(validate(v),false,'Malformed actual execution accepted');}
const fixture=args.find((value,index)=>(packageIndex<0||(index!==packageIndex&&index!==packageIndex+1))&&!value.startsWith('--'));if(fixture){const v=JSON.parse(readFileSync(fixture,'utf8'));assert(validate(v),JSON.stringify(validate.errors));}
console.log('PASS execution contract, explicit omitted-work reasons, positive revisions, plan hashes, accepted-evidence references and malformed-record rejection'+(fixture?'; fresh API execution fixture validated':''));
