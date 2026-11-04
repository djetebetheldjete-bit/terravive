/**
 * Terravive — Génère le programme (sketch .ino) de la station ESP32, pré-rempli
 * avec l'adresse du serveur, la clé de la station et, si une parcelle a été analysée,
 * le seuil d'arrosage et la profondeur conseillée du capteur.
 *
 * String.raw : les antislashs du code C (ex. \" dans une chaîne) restent tels quels.
 */
"use strict";

function cleanUrl(u) { return String(u || "").replace(/[^A-Za-z0-9:/._\-]/g, "").replace(/\/$/, ""); }
function cleanKey(k) { return String(k || "").replace(/[^A-Za-z0-9_]/g, ""); }

/**
 * opts = { origin, key, threshold (0-100 ou null), sensorDepth (cm ou null), parcelName }
 */
function esp32Sketch(opts) {
  const o = opts || {};
  const origin = cleanUrl(o.origin) || "https://VOTRE-SERVEUR";
  const https = /^https:/i.test(origin) ? 1 : 0;
  const key = cleanKey(o.key) || "VOTRE_CLE";
  const thr = Number.isFinite(Number(o.threshold)) && o.threshold != null ? Math.max(5, Math.min(95, Math.round(Number(o.threshold)))) : 50;
  const thrFrom = o.threshold != null ? "calcule par Terravive pour " + String(o.parcelName || "votre parcelle").replace(/[^\w\s\-'àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŸŒ]/g, "").slice(0, 60) : "valeur de depart a ajuster";
  const depthLine = o.sensorDepth ? "Enterrez la sonde d'humidite a environ " + Math.round(o.sensorDepth) + " cm (zone des racines actives)." : "Enterrez la sonde dans la zone des racines (souvent 15 a 30 cm).";

  return String.raw`/* =======================================================================
   TERRAVIVE - Station connectee (ESP32)
   Envoie a Terravive : humidite du sol, temperature et humidite de l'air,
   niveau de la cuve d'eau. Chaque capteur est FACULTATIF (voir REGLAGES).

   A FAIRE AVANT DE TELEVERSER :
     1) Logiciel Arduino : Outils > Type de carte > Gestionnaire de cartes,
        installez "esp32 by Espressif Systems", puis choisissez "ESP32 Dev Module".
     2) Remplissez votre Wi-Fi ci-dessous. La CLE de votre station est deja
        remplie : ne la partagez pas (elle permet d'ecrire dans votre compte).
     3) Si vous activez le capteur DHT22 : Outils > Gerer les bibliotheques,
        installez "DHT sensor library" (Adafruit), qui installe aussi
        "Adafruit Unified Sensor".

   CABLAGE (ESP32 = logique 3,3 V !)
     - Sonde d'humidite CAPACITIVE : VCC -> 3V3, GND -> GND, AOUT -> GPIO 34.
       ${depthLine}
     - DHT22 (air) : + -> 3V3, - -> GND, DATA -> GPIO 4 (+ resistance 10 kOhm
       entre DATA et 3V3 si votre module n'en a pas). A l'ombre, sous abri aere.
     - Cuve, capteur a ultrasons ETANCHE JSN-SR04T : VCC -> 5V (VIN), GND -> GND,
       TRIG -> GPIO 5, ECHO -> GPIO 18 A TRAVERS UN PONT DIVISEUR
       (ECHO -> 1 kOhm -> GPIO 18 -> 2 kOhm -> GND), car ECHO sort du 5 V et
       l'ESP32 n'accepte que 3,3 V. Fixez la sonde au couvercle, face a l'eau.
     - LED temoin d'arrosage : la LED integree (GPIO 2) s'allume quand le sol
       est plus sec que le seuil.
     - Jamais de pompe ni d'electrovanne directement sur une broche : toujours
       un relais et une alimentation separee.

   CALIBRAGE DE LA SONDE DE SOL (important, a faire sur VOTRE parcelle)
     Mettez MODE_CALIBRAGE a 1, televersez, ouvrez le Moniteur serie (115200).
       - VAL_SEC     : valeur lue dans la terre SECHE de la parcelle.
       - VAL_MOUILLE : valeur lue 1 a 2 jours apres un arrosage abondant
                       (sol "ressuye" = a sa capacite au champ).
     Reportez ces 2 valeurs ci-dessous et remettez MODE_CALIBRAGE a 0.
     (Demarrage rapide possible : sonde a l'air = sec, dans un verre d'eau =
      mouille, mais c'est moins juste.)
   ======================================================================= */
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ---------------- REGLAGES ----------------
#define MODE_CALIBRAGE 0     // 1 = affiche les valeurs brutes, n'envoie rien
#define AVEC_DHT       0     // 1 = capteur DHT22 branche (temperature/humidite air)
#define AVEC_CUVE      0     // 1 = capteur de niveau de cuve branche (JSN-SR04T)
#define USE_HTTPS      ${https}     // 1 si l'adresse du serveur commence par https

// ---------- A REMPLIR : votre Wi-Fi ----------
const char* WIFI_SSID = "VOTRE_WIFI";
const char* WIFI_PASS = "VOTRE_MOT_DE_PASSE";

// ---------- Deja rempli : votre station Terravive ----------
const char* SERVER_URL = "${origin}/api/ingest";
const char* DEVICE_KEY = "${key}";

// ---------- Sonde d'humidite du sol ----------
const int PIN_SOL      = 34;      // entree analogique (ADC1, compatible Wi-Fi)
int VAL_SEC            = 3200;    // a calibrer (voir en haut)
int VAL_MOUILLE        = 1200;    // a calibrer
const int SEUIL_ARROSAGE = ${thr};   // % : ${thrFrom}
const int PIN_LED      = 2;

// ---------- Cuve (si AVEC_CUVE = 1) ----------
const int PIN_TRIG = 5;
const int PIN_ECHO = 18;
const float HAUTEUR_UTILE_CM = 100.0;  // hauteur d'eau quand la cuve est PLEINE
const float DISTANCE_PLEINE_CM = 25.0; // distance capteur -> eau quand la cuve est pleine
                                       // (le JSN-SR04T ne mesure pas sous ~25 cm)

// ---------- Envoi ----------
const unsigned long INTERVALLE_MS = 10UL * 60UL * 1000UL; // toutes les 10 minutes
const int ESSAIS = 3;                    // nouvelles tentatives si le serveur dort

#if AVEC_DHT
  #include <DHT.h>
  const int PIN_DHT = 4;
  DHT dht(PIN_DHT, DHT22);
#endif

// --------------------------------------------------------------------------
int lireSolBrut() {
  long s = 0;
  for (int i = 0; i < 10; i++) { s += analogRead(PIN_SOL); delay(20); }  // moyenne de 10 lectures
  return (int)(s / 10);
}

int solEnPourcent(int brut) {
  int pct = map(brut, VAL_SEC, VAL_MOUILLE, 0, 100);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

#if AVEC_CUVE
float mesurerDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);  delayMicroseconds(5);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(20);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL);   // 30 ms max (~5 m)
  if (us == 0) return -1;
  return us * 0.0343 / 2.0;                              // vitesse du son ~343 m/s
}

// Mediane de 5 mesures : elimine les echos parasites.
int niveauCuvePourcent() {
  float m[5]; int n = 0;
  for (int i = 0; i < 5; i++) { float d = mesurerDistanceCm(); if (d > 0) m[n++] = d; delay(60); }
  if (n == 0) return -1;
  for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) if (m[j] < m[i]) { float t = m[i]; m[i] = m[j]; m[j] = t; }
  float d = m[n / 2];
  float eau = HAUTEUR_UTILE_CM - (d - DISTANCE_PLEINE_CM);
  int pct = (int)(eau * 100.0 / HAUTEUR_UTILE_CM + 0.5);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}
#endif

bool connecterWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connexion au Wi-Fi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000UL) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connecte." : " echec (nouvel essai au prochain cycle).");
  return WiFi.status() == WL_CONNECTED;
}

int envoyerUneFois(const String& body) {
#if USE_HTTPS
  WiFiClientSecure client;
  client.setInsecure();   // chiffre, sans verifier le certificat (simple ; voir guide)
#else
  WiFiClient client;
#endif
  HTTPClient http;
  http.setConnectTimeout(20000);
  http.setTimeout(20000);  // le serveur gratuit peut mettre du temps a se reveiller
  if (!http.begin(client, SERVER_URL)) return -100;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  return code;
}

void envoyer(int soil, float temp, float hum, int level) {
  if (!connecterWifi()) return;
  String body = String("{\"key\":\"") + DEVICE_KEY + "\"";
  if (soil >= 0)    body += String(",\"soil\":") + soil;
  if (!isnan(temp)) body += String(",\"temp\":") + String(temp, 1);
  if (!isnan(hum))  body += String(",\"hum\":") + String(hum, 0);
  if (level >= 0)   body += String(",\"level\":") + level;
  body += "}";
  for (int essai = 1; essai <= ESSAIS; essai++) {
    int code = envoyerUneFois(body);
    Serial.print("Envoi "); Serial.print(body); Serial.print(" -> HTTP "); Serial.println(code);
    if (code == 200) return;
    if (code == 401) { Serial.println("Cle refusee : retelechargez le programme depuis votre tableau de bord."); return; }
    if (code == 429) return;               // trop d'envois : on attend le prochain cycle
    delay(20000);                          // serveur endormi ou reseau faible : on reessaie
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  analogReadResolution(12);               // 0 a 4095
#if AVEC_DHT
  dht.begin();
#endif
#if AVEC_CUVE
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
#endif
#if !MODE_CALIBRAGE
  WiFi.mode(WIFI_STA);
  connecterWifi();
#endif
}

void loop() {
  int brut = lireSolBrut();
#if MODE_CALIBRAGE
  Serial.print("Valeur brute sonde de sol : "); Serial.println(brut);
  #if AVEC_CUVE
    Serial.print("Distance cuve (cm) : "); Serial.println(mesurerDistanceCm());
  #endif
  delay(1000);
  return;
#endif
  int soil = solEnPourcent(brut);
  digitalWrite(PIN_LED, soil < SEUIL_ARROSAGE ? HIGH : LOW);

  float temp = NAN, hum = NAN;
#if AVEC_DHT
  temp = dht.readTemperature();
  hum  = dht.readHumidity();
#endif
  int level = -1;
#if AVEC_CUVE
  level = niveauCuvePourcent();
#endif

  envoyer(soil, temp, hum, level);
  delay(INTERVALLE_MS);
}
`;
}

module.exports = { esp32Sketch };
