"use strict";
/**
 * test-http.js — tests automatiques « bout en bout » de Terravive.
 *
 *   npm test            (ou : node test/test-http.js)
 *
 * Démarre le vrai serveur dans un dossier de données jetable et vérifie, par de
 * vraies requêtes : les pages, la sécurité, les comptes, les rôles (cultivateur,
 * client, administrateur avec code) et les limites anti-abus.
 * Zéro dépendance. Aucun accès à la base de production ni à l'IA.
 * Code de sortie : 0 si tout passe, 1 sinon (utilisable en intégration continue).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startServer, cookieOf, createRunner, checkHtml } = require("./harness");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const ADMIN = "admin@test.ci";
const ADMIN_CODE = "code-admin-de-test";

async function main() {
  const t = createRunner("Terravive — tests automatiques (serveur réel, données jetables)");
  const srv = await startServer(ROOT, { ADMIN_EMAILS: ADMIN, ADMIN_CODE });
  const { req } = srv;

  const register = (email, password, ip, extra) => req("POST", "/api/auth/register", { json: Object.assign({ email, password, name: "Test" }, extra || {}), ip });
  const login = (email, password, ip, extra) => req("POST", "/api/auth/login", { json: Object.assign({ email, password }, extra || {}), ip });
  const closed = (r) => r.status === 401 || r.status === 403;

  try {
    // ---------------------------------------------------------------- Pages
    t.section("Pages");
    await t.test("le serveur de test utilise des données locales (jamais la base de production)", async () => {
      const r = await req("GET", "/api/health");
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.ok, true);
      assert.strictEqual(r.json.db, "local", "ATTENTION : le serveur de test est branché sur une vraie base");
    });
    for (const url of ["/", "/app", "/tableau", "/planteur", "/conseiller", "/cooperative", "/diagnostic", "/stock", "/boutique", "/quality", "/arduino", "/comprendre"]) {
      await t.test("la page " + url + " s'affiche", async () => {
        const r = await req("GET", url);
        assert.strictEqual(r.status, 200, "statut " + r.status);
        assert.ok(/text\/html/.test(r.headers["content-type"] || ""), "type de contenu : " + r.headers["content-type"]);
        assert.ok(r.text.includes("Terravive"));
      });
    }
    await t.test("une page inconnue renvoie 404", async () => {
      assert.strictEqual((await req("GET", "/cette-page-n-existe-pas.html")).status, 404);
    });
    for (const f of fs.readdirSync(PUBLIC).filter((x) => x.endsWith(".html"))) {
      await t.test("public/" + f + " : structure et JavaScript valides", async () => {
        const problems = checkHtml(path.join(PUBLIC, f));
        assert.deepStrictEqual(problems, [], problems.join(" ; "));
      });
    }
    for (const f of fs.readdirSync(PUBLIC).filter((x) => x.endsWith(".js"))) {
      await t.test("public/" + f + " : JavaScript valide", async () => {
        const vm = require("vm");
        new vm.Script(fs.readFileSync(path.join(PUBLIC, f), "utf8"), { filename: f });
      });
    }
    await t.test("les ressources de l'application installable sont servies", async () => {
      for (const u of ["/manifest.webmanifest", "/sw.js", "/logo.png", "/mobile.css"]) assert.strictEqual((await req("GET", u)).status, 200, u);
      JSON.parse((await req("GET", "/manifest.webmanifest")).text);
    });
    await t.test("la vue planteur est branchée sur les vraies données (aucune donnée inventée)", async () => {
      const html = (await req("GET", "/planteur")).text;
      for (const api of ["/api/auth/me", "/api/parcels", "/api/today", "/api/fieldlog"]) assert.ok(html.includes(api), "la vue planteur doit appeler " + api);
      assert.ok(html.includes('kind:"observation"') || html.includes("kind:'observation'"), "« C'est fait » doit noter une observation réelle");
      assert.ok(!/messages?\s+animateur|données?\s+fictives|lorem/i.test(html), "la vue planteur ne doit pas afficher de contenu fictif");
    });

    // ------------------------------------------------------------- Sécurité
    t.section("Sécurité de base");
    await t.test("les en-têtes de sécurité sont envoyés", async () => {
      const r = await req("GET", "/");
      assert.strictEqual(r.headers["x-content-type-options"], "nosniff");
      assert.strictEqual(r.headers["x-frame-options"], "SAMEORIGIN");
      assert.ok(r.headers["referrer-policy"], "Referrer-Policy absent");
    });
    for (const bad of ["/%", "/%E0%A4%A", "/api/%zz"]) {
      await t.test("une adresse mal formée (" + bad + ") ne fait pas tomber le serveur", async () => {
        const r = await req("GET", bad);
        assert.ok(r.status === 400 || r.status === 404, "statut " + r.status);
        assert.ok(srv.alive(), "le serveur s'est arrêté");
        assert.strictEqual((await req("GET", "/api/health")).status, 200, "le serveur ne répond plus");
      });
    }
    await t.test("un cookie mal formé est ignoré sans erreur", async () => {
      const r = await req("GET", "/api/auth/me", { cookie: "x=%E0%A4%A; trv_session=%" });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.user, null);
      assert.ok(srv.alive());
    });
    await t.test("un corps JSON invalide est refusé proprement (400)", async () => {
      const r = await req("POST", "/api/auth/login", { body: "{pas du json", headers: { "content-type": "application/json" } });
      assert.strictEqual(r.status, 400);
    });
    for (const p of ["/../server.js", "/..%2f..%2fserver.js", "/%2e%2e/%2e%2e/package.json", "/..%5c..%5cserver.js", "/data/store.json", "/..%2fdata%2fstore.json", "/.env", "/..%2f.env"]) {
      await t.test("fichier interne inaccessible : " + p, async () => {
        const r = await req("GET", p);
        assert.notStrictEqual(r.status, 200, "le fichier a été servi !");
        assert.ok(!/require\(|SUPABASE_KEY|"scripts"|"emails"/.test(r.text), "contenu interne exposé");
      });
    }

    // --------------------------------------------------------------- Comptes
    t.section("Comptes");
    await t.test("sans connexion, /api/auth/me renvoie user = null", async () => {
      const r = await req("GET", "/api/auth/me");
      assert.strictEqual(r.status, 200); assert.strictEqual(r.json.user, null);
    });
    await t.test("inscription refusée avec un e-mail invalide ou un mot de passe trop court", async () => {
      assert.strictEqual((await register("pas-un-email", "secret123", "10.0.0.1")).status, 400);
      assert.strictEqual((await register("court@test.ci", "123", "10.0.0.1")).status, 400);
    });
    let farmerCookie = "";
    await t.test("inscription d'un cultivateur : compte créé et session ouverte", async () => {
      const r = await register("Cultivateur@Test.ci", "secret123", "10.0.0.1", { region: "Korhogo" });
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.user.email, "cultivateur@test.ci", "l'e-mail doit être normalisé en minuscules");
      assert.strictEqual(r.json.user.profile, "cultivateur");
      assert.strictEqual(r.json.user.isAdmin, false);
      assert.ok(!("pass" in r.json.user), "le mot de passe ne doit jamais être renvoyé");
      const sc = (r.headers["set-cookie"] || []).join(";");
      assert.ok(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), "cookie de session mal protégé : " + sc);
      farmerCookie = cookieOf(r);
      assert.ok(farmerCookie, "pas de cookie de session");
    });
    await t.test("les mots de passe ne sont jamais stockés en clair", async () => {
      const f = path.join(srv.dataDir, "store.json");
      assert.ok(fs.existsSync(f), "store.json absent du dossier de test");
      const raw = fs.readFileSync(f, "utf8");
      assert.ok(raw.includes("cultivateur@test.ci"));
      assert.ok(!raw.includes("secret123"), "mot de passe stocké en clair !");
    });
    await t.test("un e-mail déjà utilisé est refusé (409)", async () => {
      assert.strictEqual((await register("cultivateur@test.ci", "autre-secret", "10.0.0.1")).status, 409);
    });
    await t.test("un mauvais mot de passe est refusé (401), sans dire si le compte existe", async () => {
      const a = await login("cultivateur@test.ci", "mauvais", "10.0.0.2");
      const b = await login("inconnu@test.ci", "mauvais", "10.0.0.2");
      assert.strictEqual(a.status, 401); assert.strictEqual(b.status, 401);
      assert.strictEqual(a.json.error, b.json.error, "le message ne doit pas révéler l'existence du compte");
    });
    await t.test("connexion, puis déconnexion : l'ancienne session ne fonctionne plus", async () => {
      const r1 = await login("CULTIVATEUR@test.ci", "secret123", "10.0.0.2");
      assert.strictEqual(r1.status, 200);
      const c = cookieOf(r1);
      assert.strictEqual((await req("GET", "/api/auth/me", { cookie: c })).json.user.email, "cultivateur@test.ci");
      assert.strictEqual((await req("POST", "/api/auth/logout", { cookie: c })).status, 200);
      assert.strictEqual((await req("GET", "/api/auth/me", { cookie: c })).json.user, null);
    });
    await t.test("un cookie de session inventé ne donne aucun accès", async () => {
      const name = farmerCookie.split("=")[0];
      assert.strictEqual((await req("GET", "/api/auth/me", { cookie: name + "=" + "a".repeat(48) })).json.user, null);
    });

    // ----------------------------------------------------------------- Rôles
    t.section("Rôles et accès réservés");
    const privateGets = ["/api/plans", "/api/dashboard", "/api/parcels", "/api/coop/me", "/api/devices"];
    const adminGets = ["/api/admin/users", "/api/admin/questions", "/api/admin/animator-requests", "/api/admin/certify-requests"];
    const staffGets = ["/api/quality/overview", "/api/quality/logs", "/api/stock/overview", "/api/stock/products", "/api/stock/sales", "/api/stock/logs"];
    const staffPosts = ["/api/admin/animator", "/api/admin/animator-requests/decide", "/api/admin/certify-requests/decide", "/api/quality/audit",
      "/api/stock/products", "/api/stock/products/delete", "/api/stock/sales", "/api/stock/payments"];
    await t.test("visiteur non connecté : données personnelles et espaces réservés fermés", async () => {
      for (const u of privateGets.concat(adminGets, staffGets)) { const r = await req("GET", u); assert.ok(closed(r), u + " → " + r.status); }
      for (const u of staffPosts) { const r = await req("POST", u, { json: {} }); assert.ok(closed(r), u + " → " + r.status); }
    });
    await t.test("cultivateur connecté : accède à ses données, pas aux espaces admin / qualité / stock", async () => {
      const mine = await req("GET", "/api/plans", { cookie: farmerCookie });
      assert.strictEqual(mine.status, 200); assert.ok(Array.isArray(mine.json.plans));
      for (const u of adminGets.concat(staffGets)) { const r = await req("GET", u, { cookie: farmerCookie }); assert.ok(closed(r), u + " → " + r.status); }
      for (const u of staffPosts) { const r = await req("POST", u, { json: {}, cookie: farmerCookie }); assert.ok(closed(r), u + " → " + r.status); }
    });
    await t.test("sans connexion, les générations par l'IA sont refusées", async () => {
      for (const u of ["/api/plan", "/api/chat", "/api/arduino", "/api/diagnostic"]) {
        const r = await req("POST", u, { json: { crop: "tomate", message: "bonjour" } });
        assert.notStrictEqual(r.status, 200, u + " a répondu 200 sans connexion");
      }
    });
    let clientCookie = "";
    await t.test("compte « client » : redirigé vers la boutique, API techniques refusées", async () => {
      const r = await register("client@test.ci", "secret123", "10.0.0.3", { profile: "client" });
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.user.profile, "client");
      clientCookie = cookieOf(r);
      for (const page of ["/tableau", "/planteur", "/conseiller", "/stock", "/quality", "/arduino", "/cooperative", "/diagnostic", "/comprendre"]) {
        const p = await req("GET", page, { cookie: clientCookie });
        assert.strictEqual(p.status, 302, page + " → " + p.status);
        assert.strictEqual(p.headers.location, "/boutique", page);
      }
      assert.strictEqual((await req("GET", "/boutique", { cookie: clientCookie })).status, 200);
      for (const u of privateGets) { const a = await req("GET", u, { cookie: clientCookie }); assert.strictEqual(a.status, 403, u + " → " + a.status); }
      assert.notStrictEqual((await req("GET", "/api/shop/products", { cookie: clientCookie })).status, 403, "la boutique doit rester ouverte au client");
      assert.strictEqual((await req("GET", "/api/auth/me", { cookie: clientCookie })).json.user.email, "client@test.ci");
    });
    await t.test("administrateur : sans le code, l'e-mail seul ne donne pas les droits", async () => {
      const r = await register(ADMIN, "admin-secret", "10.0.0.4");
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.user.isAdmin, false, "droits admin accordés sans le code");
      assert.ok(closed(await req("GET", "/api/admin/users", { cookie: cookieOf(r) })));
      const plain = await login(ADMIN, "admin-secret", "10.0.0.4");
      assert.strictEqual(plain.json.user.isAdmin, false, "connexion simple : pas de droits admin");
    });
    await t.test("administrateur : mauvais code refusé, bon code accepté", async () => {
      assert.strictEqual((await login(ADMIN, "admin-secret", "10.0.0.4", { as: "admin", code: "mauvais-code" })).status, 401);
      assert.strictEqual((await login(ADMIN, "admin-secret", "10.0.0.4", { as: "admin" })).status, 401);
      const ok = await login(ADMIN, "admin-secret", "10.0.0.4", { as: "admin", code: ADMIN_CODE });
      assert.strictEqual(ok.status, 200, ok.text);
      assert.strictEqual(ok.json.user.isAdmin, true);
      const list = await req("GET", "/api/admin/users", { cookie: cookieOf(ok) });
      assert.strictEqual(list.status, 200);
      assert.ok(list.text.includes("cultivateur@test.ci"), "le cultivateur doit apparaître dans la liste");
      assert.ok(!/"pass"\s*:/.test(list.text), "les mots de passe (même chiffrés) ne doivent pas sortir de l'API");
    });
    await t.test("un compte ordinaire ne peut pas se connecter « en administrateur », même avec le code", async () => {
      const r = await login("cultivateur@test.ci", "secret123", "10.0.0.5", { as: "admin", code: ADMIN_CODE });
      assert.strictEqual(r.status, 403);
    });

    // ------------------------------------- Résidus valorisés et germination
    t.section("Carnet de champ : résidus valorisés et test de germination");
    let parcelId = "";
    const log = (body, cookie) => req("POST", "/api/fieldlog", { json: Object.assign({ parcel_id: parcelId, date: "2026-04-10" }, body), cookie: cookie === undefined ? farmerCookie : cookie });
    await t.test("le guide des résidus est servi au navigateur et la page du tableau de bord l'utilise", async () => {
      const js = await req("GET", "/residus.js");
      assert.strictEqual(js.status, 200); assert.ok(/javascript/.test(js.headers["content-type"] || ""), js.headers["content-type"]);
      const html = fs.readFileSync(path.join(PUBLIC, "tableau.html"), "utf8");
      for (const id of ["resCard", "resPick", "resPanel", "logResidue", "logRoute", "logGermWrap", "gSown", "gRefUp"]) assert.ok(html.includes('id="' + id + '"'), "élément absent : " + id);
      assert.ok(html.includes('src="/residus.js"'));
      assert.ok(fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8").includes('"/residus.js"'), "residus.js absent du cache hors ligne");
    });
    await t.test("résidus valorisés : quantité obligatoire, voie reconnue, résidu rappelé dans la note", async () => {
      const p = await req("POST", "/api/parcels", { json: { name: "Champ maïs", zone: { polygon: [[5.36, -3.99], [5.3601, -3.99], [5.3601, -3.98985], [5.36, -3.98985]] } }, cookie: farmerCookie });
      assert.strictEqual(p.status, 200, p.text); parcelId = p.json.parcel.id;
      assert.strictEqual((await log({ kind: "residu", note: "des tiges" })).status, 400, "sans quantité");
      assert.strictEqual((await log({ kind: "residu", qty: 0 })).status, 400, "quantité nulle");
      const a = await log({ kind: "residu", qty: "120", residue: "tiges", route: "compost", note: "6 brouettes de 20 kg" });
      assert.strictEqual(a.status, 200, a.text);
      assert.strictEqual(a.json.entry.unit, "kg"); assert.strictEqual(a.json.entry.qty, 120); assert.strictEqual(a.json.entry.product, "Compost");
      assert.strictEqual(a.json.entry.note, "Résidu : Tiges de maïs, mil, sorgho · 6 brouettes de 20 kg");
      const b = await log({ kind: "residu", qty: "35,5", route: "Paillis" });
      assert.strictEqual(b.json.entry.product, "Paillis"); assert.strictEqual(b.json.entry.qty, 35.5);
      const c = await log({ kind: "residu", qty: 10, route: "<script>", residue: "inconnu" });
      assert.strictEqual(c.status, 200); assert.strictEqual(c.json.entry.product, null, "une voie inconnue ne doit pas être enregistrée telle quelle"); assert.strictEqual(c.json.entry.note, null);
    });
    await t.test("test de germination : le pourcentage est calculé par le serveur, les saisies incohérentes sont refusées", async () => {
      assert.strictEqual((await log({ kind: "germination", qty: 100 })).status, 400, "sans graines comptées");
      assert.strictEqual((await log({ kind: "germination", germ: { sown: 20, up: 25 } })).status, 400);
      assert.strictEqual((await log({ kind: "germination", germ: { sown: 20, up: 10, ref_sown: 20 } })).status, 400);
      const g = await log({ kind: "germination", qty: 100, date: "2026-05-20", germ: { sown: 20, up: 14, ref_sown: 20, ref_up: 19, days: 7 } });
      assert.strictEqual(g.status, 200, g.text);
      assert.strictEqual(g.json.entry.qty, 73.7, "le pourcentage envoyé par le navigateur ne doit pas être pris tel quel");
      assert.strictEqual(g.json.entry.unit, "%");
      assert.strictEqual(g.json.entry.note, "Test de germination : compost 14/20 levées · témoin 19/20 · après 7 jours");
      const solo = await log({ kind: "germination", germ: { sown: 20, up: 18 } });
      assert.strictEqual(solo.status, 200); assert.ok(/sans témoin/.test(solo.json.entry.note));
    });
    await t.test("le bilan d'impact affiche les résidus valorisés (mesurés) et le dernier test de germination", async () => {
      const r = await req("GET", "/api/impact?parcel=" + parcelId, { cookie: farmerCookie });
      assert.strictEqual(r.status, 200, r.text);
      const R = r.json.report;
      assert.strictEqual(R.residues.total.v, 165.5); assert.strictEqual(R.residues.total.nature, "mesure");
      assert.deepStrictEqual(R.residues.routes.map((x) => x.label), ["Compost", "Paillis", "Voie non précisée"]);
      assert.ok(!R.residues.need, "sans fiche sol, aucun besoin n'est affiché");
      assert.strictEqual(R.current.compost_kg, 0, "des résidus mis au compost ne sont pas du compost épandu");
      assert.strictEqual(R.germination.date, "2026-05-20"); assert.strictEqual(R.germination.pct.v, 73.7); assert.strictEqual(R.germination.level, "moyen");
      assert.strictEqual(R.germination.threshold.nature, "repere");
      const csv = await req("GET", "/api/impact/csv?parcel=" + parcelId, { cookie: farmerCookie });
      assert.strictEqual(csv.status, 200); assert.ok(/residus_valorises_kg/.test(csv.text) && /"165,5";"120";"73,7"/.test(csv.text), csv.text.slice(-200));
      const sum = await req("GET", "/api/impact/summary", { cookie: farmerCookie });
      assert.strictEqual(sum.json.residue_kg, 166);
    });
    await t.test("le carnet reste privé : ni visiteur ni autre compte ne peuvent y écrire ou le lire", async () => {
      assert.strictEqual((await log({ kind: "residu", qty: 5 }, "")).status, 401);
      const other = await register("voisin@test.ci", "secret123", "10.0.0.8");
      const oc = cookieOf(other);
      assert.strictEqual((await log({ kind: "residu", qty: 5 }, oc)).status, 404);
      assert.strictEqual((await req("GET", "/api/fieldlog?parcel=" + parcelId, { cookie: oc })).status, 404);
      assert.strictEqual((await req("GET", "/api/impact?parcel=" + parcelId, { cookie: oc })).status, 404);
    });
    await t.test("les autres saisies du carnet fonctionnent toujours (arrosage, compost avec produit)", async () => {
      const a = await log({ kind: "arrosage", qty: 200 }); assert.strictEqual(a.status, 200); assert.strictEqual(a.json.entry.unit, "L");
      const c = await log({ kind: "compost", qty: 50, product: "Fumier de volaille" }); assert.strictEqual(c.json.entry.product, "Fumier de volaille");
      assert.strictEqual((await log({ kind: "inconnu", qty: 1 })).status, 400);
      const list = await req("GET", "/api/fieldlog?parcel=" + parcelId, { cookie: farmerCookie });
      assert.strictEqual(list.json.entries.length, 7);
      assert.strictEqual(list.json.totals.residu.qty, 165.5);
      assert.ok(!list.json.totals.germination.qty, "les pourcentages ne s'additionnent pas");
    });

    // ------------------------------------------- Planteur : téléphone + PIN
    t.section("Planteur : connexion par téléphone et code PIN");
    const plReg = (phone, pin, ip, extra) => req("POST", "/api/auth/register", { json: Object.assign({ as: "planteur", phone, pin, name: "Planteur" }, extra || {}), ip });
    const plLog = (phone, pin, ip) => req("POST", "/api/auth/login", { json: { as: "planteur", phone, pin }, ip });
    await t.test("inscription : numéro et PIN vérifiés, aucun e-mail exposé", async () => {
      assert.strictEqual((await plReg("123", "1234", "10.2.0.1")).status, 400, "numéro trop court");
      assert.strictEqual((await plReg("07 01 02 03 04", "12", "10.2.0.1")).status, 400, "PIN trop court");
      assert.strictEqual((await plReg("07 01 02 03 04", "abcd", "10.2.0.1")).status, 400, "PIN non numérique");
      const r = await plReg("07 01 02 03 04", "4821", "10.2.0.1", { region: "San-Pédro" });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.user.email, null, "l'adresse interne ne doit pas être renvoyée");
      assert.strictEqual(r.json.user.phone, "0701020304");
      assert.strictEqual((await plReg("0701020304", "9999", "10.2.0.1")).status, 409, "numéro déjà inscrit");
    });
    await t.test("connexion : le format du numéro n'importe pas, un mauvais PIN est refusé", async () => {
      assert.strictEqual((await plLog("07-01-02-03-04", "4821", "10.2.0.2")).status, 200);
      assert.strictEqual((await plLog("0701020304", "0000", "10.2.0.2")).status, 401);
      assert.strictEqual((await plLog("", "4821", "10.2.0.2")).status, 400);
    });
    await t.test("le domaine interne des planteurs ne peut pas servir à s'inscrire ou se connecter par e-mail", async () => {
      assert.strictEqual((await register("0799999999@planteur.terravive", "secret123", "10.2.0.3")).status, 400, "squat d'un numéro par e-mail");
      assert.strictEqual((await plReg("0799999999", "1111", "10.2.0.3")).status, 200, "le vrai planteur doit pouvoir s'inscrire");
      assert.strictEqual((await login("0799999999@planteur.terravive", "1111", "10.2.0.3")).status, 401, "contournement des compteurs du numéro");
    });
    await t.test("PIN : les essais répétés bloquent le numéro, même en changeant de connexion", async () => {
      await plReg("0788888888", "2468", "10.2.0.4");
      let blocked = false;
      for (let i = 0; i < 25 && !blocked; i++) {
        const r = await plLog("0788888888", String(1000 + i), "10.2.1." + i);
        if (r.status === 429) blocked = true; else assert.strictEqual(r.status, 401, "essai " + (i + 1) + " → " + r.status);
      }
      assert.ok(blocked, "le numéro devait être bloqué");
    });

    // -------------------------------------------------- Limites anti-abus
    t.section("Limites anti-abus");
    await t.test("après 10 essais de mot de passe sur un compte, la connexion est bloquée (429)", async () => {
      await register("cible@test.ci", "bon-secret", "10.0.0.6");
      for (let i = 0; i < 10; i++) { const r = await login("cible@test.ci", "essai-" + i, "10.0.1." + i); assert.strictEqual(r.status, 401, "essai " + (i + 1) + " → " + r.status); }
      assert.strictEqual((await login("cible@test.ci", "bon-secret", "10.0.1.99")).status, 429, "le 11e essai devait être bloqué");
      assert.strictEqual((await login("client@test.ci", "secret123", "10.0.1.100")).status, 200, "les autres comptes ne doivent pas être bloqués");
    });
    await t.test("après 30 essais depuis une même connexion, celle-ci est bloquée (429)", async () => {
      let last = 0;
      for (let i = 0; i < 31; i++) { last = (await login("personne" + i + "@test.ci", "x", "10.9.9.9")).status; }
      assert.strictEqual(last, 429);
    });
    await t.test("au-delà de 10 créations de compte par heure et par connexion : refus (429)", async () => {
      let ok = 0, last = 0;
      for (let i = 0; i < 11; i++) { last = (await register("serie" + i + "@test.ci", "secret123", "10.7.7.7")).status; if (last === 200) ok++; }
      assert.strictEqual(ok, 10, "10 créations devaient passer, " + ok + " sont passées");
      assert.strictEqual(last, 429);
    });

    // ------------------------------------------------------------- Bilan
    t.section("Santé du serveur en fin de série");
    await t.test("le serveur tourne toujours et n'a journalisé aucune erreur fatale", async () => {
      assert.ok(srv.alive(), "le serveur s'est arrêté pendant les tests");
      assert.strictEqual((await req("GET", "/api/health")).status, 200);
      assert.ok(!/Rejet non géré|Exception non gérée|Requête en erreur/i.test(srv.logs()), "erreur inattendue dans le journal :\n" + srv.logs().slice(-800));
    });
  } finally {
    await srv.stop();
  }
  process.exit(t.summary() ? 1 : 0);
}

main().catch((e) => { console.error("Erreur d'exécution des tests :", e); process.exit(2); });
