"use strict";
const http=require("http"),fs=require("fs"),path=require("path"),{spawn}=require("child_process");
const PROJ=__dirname,DATA=path.join(PROJ,"data");fs.mkdirSync(DATA,{recursive:true});
const store={users:{u1:{id:"u1",email:"admin@test.local",name:"Admin"},u2:{id:"u2",email:"op@test.local",name:"Operateur"},u3:{id:"u3",email:"view@test.local",name:"Lecteur"},u9:{id:"u9",email:"no@test.local",name:"No"}},
 emails:{},sessions:{ad:{userId:"u1",at:Date.now()},op:{userId:"u2",at:Date.now()},vi:{userId:"u3",at:Date.now()},no:{userId:"u9",at:Date.now()}},
 plans:{},devices:{},stations:{},readings:{},questions:[],parcels:{},coops:{},coopMembers:[],coopEquip:[],coopResa:[],coopBuy:[],coopBuyJoin:[],animReqs:[]};
fs.writeFileSync(path.join(DATA,"store.json"),JSON.stringify(store,null,2));
const PORT=38130;
const child=spawn("node",["server.js"],{cwd:PROJ,env:Object.assign({},process.env,{PORT:String(PORT),ANTHROPIC_API_KEY:"",SUPABASE_URL:"",SUPABASE_KEY:"",ADMIN_EMAILS:"admin@test.local",STOCK_OPERATORS:"op@test.local",STOCK_VIEWERS:"view@test.local",STOCK_PUBLIC_ENABLED:"false"}),stdio:["ignore","pipe","pipe"]});
let outp="";child.stdout.on("data",d=>outp+=d);child.stderr.on("data",d=>outp+=d);
function raw(method,p,{cookie,body}={}){return new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):null;const r=http.request({host:"127.0.0.1",port:PORT,method,path:p,headers:Object.assign({"content-type":"application/json"},cookie?{Cookie:cookie}:{},data?{"content-length":Buffer.byteLength(data)}:{})},res=>{let b="";res.on("data",c=>b+=c);res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:b}));});r.on("error",reject);if(data)r.write(data);r.end();});}
async function req(m,p,o){const r=await raw(m,p,o);let j=null;try{j=JSON.parse(r.body)}catch{}return{status:r.status,json:j,headers:r.headers,body:r.body};}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const AD="trv_session=ad",OP="trv_session=op",VI="trv_session=vi",NO="trv_session=no";
let pass=0,fail=0;const log=[];
function ck(n,c,x){if(c){pass++;log.push("✓ "+n)}else{fail++;log.push("✗ "+n+(x?" → "+x:""))}}
(async()=>{
 try{
  for(let i=0;i<50;i++){try{const h=await req("GET","/api/health");if(h.status===200)break;}catch(e){}await wait(100);}
  // Accès /stock (page)
  ck("GET /stock sert la page",(await raw("GET","/stock",{cookie:AD})).status===200||(await raw("GET","/stock")).status===200);
  // Rôles
  ck("overview non connecté → 401",(await req("GET","/api/stock/overview")).status===401);
  ck("overview rôle absent → 403",(await req("GET","/api/stock/overview",{cookie:NO})).status===403);
  ck("lecteur : overview 200",(await req("GET","/api/stock/overview",{cookie:VI})).status===200);
  ck("lecteur : créer produit → 403",(await req("POST","/api/stock/products",{cookie:VI,body:{name:"X"}})).status===403);
  ck("opérateur : créer produit → 200",(await req("POST","/api/stock/products",{cookie:OP,body:{name:"Tomate",unit:"kg",min_qty:10,price:500}})).status===200);
  // Produit admin
  let prod=await req("POST","/api/stock/products",{cookie:AD,body:{name:"Maïs",unit:"sac",min_qty:5,price:12000}});
  const pid=prod.json.product.id;
  ck("produit créé",prod.status===200&&pid);
  // Stock initial = 0 (rupture)
  let pg=await req("GET","/api/stock/product?id="+pid,{cookie:AD});
  ck("stock initial 0 = rupture",pg.json.product.on_hand===0&&pg.json.product.status==="rupture");
  // Récolte → entrée en stock
  let h=await req("POST","/api/stock/harvests",{cookie:OP,body:{product_id:pid,qty:20,unit:"sac"}});
  ck("récolte enregistrée",h.status===200);
  pg=await req("GET","/api/stock/product?id="+pid,{cookie:AD});
  ck("stock après récolte = 20",pg.json.product.on_hand===20,"on_hand="+pg.json.product.on_hand);
  ck("un mouvement 'in' créé",pg.json.movements.some(m=>m.type==="in"&&Number(m.qty)===20));
  // Vente brouillon (serveur recalcule total)
  let sale=await req("POST","/api/stock/sales",{cookie:OP,body:{customer_name:"Client A",items:[{product_id:pid,qty:5}]}});
  ck("vente créée brouillon, total recalculé = 60000",sale.status===200&&sale.json.total===60000,"total="+sale.json.total);
  const sid=sale.json.saleId;
  ck("référence de vente générée",/^V-/.test(sale.json.reference));
  // Vente > stock : refus
  let bad=await req("POST","/api/stock/sales",{cookie:OP,body:{items:[{product_id:pid,qty:999}]}});
  const badId=bad.json.saleId;
  let badVal=await req("POST","/api/stock/sales/validate",{cookie:OP,body:{id:badId}});
  ck("validation au-delà du stock → refusée (400)",badVal.status===400,"status="+badVal.status);
  // Stock inchangé après refus
  pg=await req("GET","/api/stock/product?id="+pid,{cookie:AD});
  ck("stock inchangé après refus = 20",pg.json.product.on_hand===20,"on_hand="+pg.json.product.on_hand);
  // Validation normale → décrément
  let val=await req("POST","/api/stock/sales/validate",{cookie:OP,body:{id:sid}});
  ck("validation vente valide → 200",val.status===200&&val.json.ok);
  pg=await req("GET","/api/stock/product?id="+pid,{cookie:AD});
  ck("stock après vente validée = 15",pg.json.product.on_hand===15,"on_hand="+pg.json.product.on_hand);
  // Double validation refusée
  let dbl=await req("POST","/api/stock/sales/validate",{cookie:OP,body:{id:sid}});
  ck("double validation refusée (400)",dbl.status===400);
  // Paiement
  let pay=await req("POST","/api/stock/payments",{cookie:OP,body:{sale_id:sid,amount:20000,method:"mobile_money"}});
  ck("paiement enregistré",pay.status===200);
  let sg=await req("GET","/api/stock/sale?id="+sid,{cookie:AD});
  ck("reste à payer = 40000, règlement partiel",sg.json.sale.remaining===40000&&sg.json.sale.settlement==="partiel","reste="+sg.json.sale.remaining);
  // Perte
  let loss=await req("POST","/api/stock/losses",{cookie:OP,body:{product_id:pid,qty:3,cause:"pourriture"}});
  ck("perte enregistrée",loss.status===200);
  pg=await req("GET","/api/stock/product?id="+pid,{cookie:AD});
  ck("stock après perte = 12",pg.json.product.on_hand===12,"on_hand="+pg.json.product.on_hand);
  // Perte > stock refusée
  ck("perte > stock → 400",(await req("POST","/api/stock/losses",{cookie:OP,body:{product_id:pid,qty:999,cause:"autre"}})).status===400);
  // Annulation vente validée → compensation (stock remonte de 5 → 17)
  let can=await req("POST","/api/stock/sales/cancel",{cookie:AD,body:{id:sid}});
  ck("annulation vente validée → 200",can.status===200);
  pg=await req("GET","/api/stock/product?id="+pid,{cookie:AD});
  ck("stock après annulation (compensation) = 17",pg.json.product.on_hand===17,"on_hand="+pg.json.product.on_hand);
  // Tableau de bord
  let ov=await req("GET","/api/stock/overview",{cookie:AD});
  ck("overview : métriques réelles",ov.json.metrics.products>=2&&typeof ov.json.metrics.stock_value==="number");
  ck("overview : valeur de perte calculée (3×12000=36000)",ov.json.metrics.loss_value===36000,"loss_value="+ov.json.metrics.loss_value);
  // Export CSV
  let ex=await raw("GET","/api/stock/export.csv?type=products",{cookie:VI});
  ck("export CSV produits : 200 + csv + BOM",ex.status===200&&/text\/csv/.test(ex.headers["content-type"])&&ex.body.charCodeAt(0)===0xFEFF);
  // Journal
  let lg=await req("GET","/api/stock/logs",{cookie:AD});
  ck("journal : actions tracées (sale_validate, harvest_create)",lg.json.logs.some(l=>l.action==="sale_validate")&&lg.json.logs.some(l=>l.action==="harvest_create"));
  ck("journal interdit au lecteur (403)",(await req("GET","/api/stock/logs",{cookie:VI})).status===403);
  // Vitrine publique désactivée
  ck("vitrine publique désactivée → 404",(await req("GET","/api/stock/public/products")).status===404);
  ck("commande publique désactivée → 503",(await req("POST","/api/stock/public/orders",{body:{}})).status===503);
  // Persistance disque
  const disk=JSON.parse(fs.readFileSync(path.join(DATA,"store.json"),"utf8"));
  ck("persistance : produits sur disque",Array.isArray(disk.stock_products)&&disk.stock_products.length>=2);
  ck("persistance : mouvements sur disque",disk.stock_movements.length>=3);
  // Validation d'entrée
  ck("produit sans nom → 400",(await req("POST","/api/stock/products",{cookie:OP,body:{name:""}})).status===400);
  ck("récolte qty<=0 → 400",(await req("POST","/api/stock/harvests",{cookie:OP,body:{product_id:pid,qty:0}})).status===400);
 }catch(e){console.log("ERREUR:",e.message,e.stack);}
 finally{child.kill();console.log(log.join("\n"));console.log(`\nINTÉGRATION STOCK (local) : ${pass} réussis, ${fail} échoué(s) sur ${pass+fail}`);if(fail)console.log("--- serveur ---\n"+outp.slice(-800));try{fs.unlinkSync(path.join(DATA,"store.json"));fs.rmdirSync(DATA);}catch(e){}process.exit(fail?1:0);}
})();
