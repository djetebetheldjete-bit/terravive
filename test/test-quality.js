'use strict';
const q=require('../quality');
function run(){let total=0,failed=0;const check=(name,ok)=>{total++;if(!ok){failed++;console.error('ÉCHEC Quality Guard:',name)}else console.log('OK Quality Guard:',name)};
let a=q.deterministicAudit({content:Array.from({length:18},(_,i)=>`## ${i+1}. Section\nContenu prudent.`).join('\n')});
check('18 sections reconnues',a.sectionCount===18);
check('pas d’alerte de section sur un plan complet',!a.issues.some(x=>x.code==='MISSING_SECTIONS'));
a=q.deterministicAudit({content:'## 1. Diagnostic\nLe pH est inconnu. Dose de chaux : 2 kg.'});
check('détecte les sections manquantes',a.issues.some(x=>x.code==='MISSING_SECTIONS'));
check('signale une dose de chaux potentiellement non justifiée',a.issues.some(x=>x.code==='PH_LIME_DOSE'));
a=q.deterministicAudit({content:'## 1. Diagnostic\nLa préparation est sans danger et garantit une efficacité.'});
check('signale les formulations absolues',a.issues.some(x=>x.code==='OVERCONFIDENT_CLAIM'));
console.log(`Quality Guard : ${total-failed}/${total} vérifications réussies`);return {total,failed};}
module.exports={run};
if(require.main===module){const r=run();process.exit(r.failed?1:0)}
