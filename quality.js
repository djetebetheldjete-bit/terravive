'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function deterministicAudit(plan) {
  const content = String(plan && plan.content || '');
  const issues = [];
  const sectionMatches = [...content.matchAll(/^##\s*(\d{1,2})\b/gm)].map(m => Number(m[1]));
  const missing = Array.from({length:18}, (_,i)=>i+1).filter(n=>!sectionMatches.includes(n));
  if (!content.trim()) issues.push({severity:'blocker',code:'EMPTY_CONTENT',title:'Contenu absent',detail:'L’itinéraire ne contient aucun texte à contrôler.'});
  if (missing.length) issues.push({severity:'major',code:'MISSING_SECTIONS',title:'Sections manquantes',detail:`Sections numérotées non détectées : ${missing.join(', ')}. Vérifier le format réel de cet itinéraire.`});
  if (/pH.{0,80}(?:inconnu|non précisé|non mesuré)/i.test(content) && /(?:dose|apport).{0,50}(?:chaux|chaulage)\s*[:=]?\s*\d/i.test(content)) issues.push({severity:'major',code:'PH_LIME_DOSE',title:'Dose de chaux potentiellement non justifiée',detail:'Le texte semble associer un pH inconnu à une dose chiffrée de chaux. Vérification humaine requise.'});
  if (/(?:prix unitaire|coût total).{0,35}\b(?:FCFA|XOF)\s*\d/i.test(content) && !/prix.{0,40}(?:fourni|communiqué|indiqué par le producteur)/i.test(content)) issues.push({severity:'warning',code:'PRICE_ASSERTION',title:'Prix chiffré à vérifier',detail:'Un prix peut être présent sans source clairement indiquée. Vérifier son origine.'});
  if (/(?:sans danger|inoffensif|garanti efficace|élimine tous les ravageurs)/i.test(content)) issues.push({severity:'warning',code:'OVERCONFIDENT_CLAIM',title:'Formulation trop catégorique',detail:'Une formulation absolue sur l’efficacité ou la sécurité mérite une vérification.'});
  if (/(?:toutes les?\s+\d+\s*(?:heures|jours)|tous les jours).{0,70}(?:arroser|arrosage)/i.test(content)) issues.push({severity:'warning',code:'WATERING_RULE',title:'Fréquence d’arrosage à contextualiser',detail:'Vérifier que la fréquence d’arrosage tient compte du sol, du stade, de la météo et de l’eau disponible.'});
  if (!issues.length) issues.push({severity:'info',code:'NO_RULE_TRIGGERED',title:'Aucune anomalie détectée par les règles simples',detail:'Cela ne garantit pas la validité agronomique de l’itinéraire.'});
  const blocker = issues.some(x=>x.severity==='blocker');
  const major = issues.some(x=>x.severity==='major');
  const status = blocker ? 'BLOQUÉ' : major ? 'À CORRIGER' : issues.some(x=>x.severity==='warning') ? 'AVERTISSEMENT' : 'CONTRÔLES TECHNIQUES RÉUSSIS';
  const score = Math.max(0, Math.min(100, 100 - issues.reduce((n,x)=>n+({blocker:60,major:25,warning:10,info:0}[x.severity]||0),0)));
  return {status, score, issues, sectionCount: new Set(sectionMatches).size, sectionNumbers: [...new Set(sectionMatches)].sort((a,b)=>a-b), disclaimer:'Contrôle automatique indicatif : il ne remplace pas une validation agronomique humaine.'};
}
function runExistingTests(root) {
  const r = spawnSync(process.execPath, [path.join(root,'test','run.js')], {cwd:root, encoding:'utf8', timeout:120000, maxBuffer:2*1024*1024});
  return {executed:true, exitCode:typeof r.status==='number'?r.status:null, passed:r.status===0, output:(r.stdout||'')+(r.stderr||''), error:r.error?String(r.error.message):null};
}
async function aiAudit(plan, apiKey, model) {
  if (!apiKey) return {executed:false, status:'NON EXÉCUTÉ', error:'ANTHROPIC_API_KEY absente.'};
  const body = {
    model: model || 'claude-sonnet-5', max_tokens: 2200, temperature: 0,
    system: `Tu es un auditeur prudent d'itinéraires agricoles pour la Côte d'Ivoire. Tu ne réécris pas l'itinéraire et ne poses pas de diagnostic terrain certain. Recherche seulement les défauts étayés par le texte : contradictions, recommandations dangereuses, doses sans données, calculs/quantités incohérents, adaptation aux contraintes, données locales présentées comme vérifiées sans preuve, et incertitudes insuffisamment signalées. Ne traite pas un simple doute comme une erreur certaine. Réponds en JSON strict : {"status":"CONTRÔLES RÉUSSIS|AVERTISSEMENT|À CORRIGER|BLOQUÉ","summary":"...","issues":[{"severity":"blocker|major|warning|info","section":"...","title":"...","evidence":"citation courte du texte ou description précise","reason":"...","recommendation":"..."}]}. Si une information manque, signale l'incertitude au lieu d'inventer. Audit indicatif, validation humaine nécessaire.`,
    messages:[{role:'user',content:`Audite cet itinéraire. Métadonnées : culture=${plan.crop||'non précisée'}; région=${plan.region||'non précisée'}; surface=${plan.area||'non précisée'}; sol=${plan.soil||'non précisé'}; créé=${plan.created_at||'inconnu'}.\n\nCONTENU :\n${String(plan.content||'').slice(0,42000)}`}]
  };
  const res = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)});
  const raw = await res.text();
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${raw.slice(0,300)}`);
  const payload=JSON.parse(raw); const text=(payload.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').trim();
  let parsed; try { parsed=JSON.parse(text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); } catch(e) { return {executed:true, parsed:false, status:'À EXAMINER', raw:text, model:payload.model||model}; }
  return {executed:true, parsed:true, ...parsed, model:payload.model||model};
}
module.exports={deterministicAudit,runExistingTests,aiAudit};
