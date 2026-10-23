// 참값(CHAMGAP) 노드 펌웨어 — USB 시리얼 버전 (node-2.0-usb)
//
// 하는 일
//  - DEFAULT_SAMPLE_MS(5초)마다 센서 값을 한 줄 JSON(data)으로 시리얼에 보낸다 → 노트북 서버가 받아 웹앱에 보여 준다
//  - 시리얼로 받은 명령(info, tare, cal 500, soilcal a air, water 10, stop ...)을 실행하고 ack를 보낸다
//  - 펌프 안전은 여기서 최종 판단한다 (부팅 시 끔, 최대 15초, 쉬는 시간 3초, 1회 50mL, 하루 300mL)
//
// 통신 규약: docs/01_requirements.md 4장. 설정은 config.h.
// 다음 단계(P2)에서 WiFi로 Supabase에 올리는 부분을 더한다. 시리얼 출력은 그때도 그대로 둔다.

#include <Arduino.h>
#include <Preferences.h>
#include <math.h>
#include "config.h"

#if USE_DHT11_A
#include <DHT.h>
#endif
#if USE_SHT31_A || USE_SHT31_B
#include <Wire.h>
#include <Adafruit_SHT31.h>
#endif
#if USE_HX711
#include <HX711.h>
#endif

#define FW_VERSION "node-2.0-usb"

// ------------------------------------------------------------ 상태

Preferences prefs;
String nodeId = DEFAULT_NODE_ID;
unsigned long sampleMs = DEFAULT_SAMPLE_MS;
unsigned long seq = 0;
unsigned long lastSample = 0;

// 보정값 (NVS 이름공간 "chamgap", 요구사항 3.1)
int soilAir[2] = {SOIL_DEFAULT_AIR_MV, SOIL_DEFAULT_AIR_MV};
int soilWet[2] = {SOIL_DEFAULT_WET_MV, SOIL_DEFAULT_WET_MV};
bool soilCal[2] = {false, false};
long lcOffset = 0;
bool lcHasOffset = false;
float lcScale = 0;  // raw / g. 0이면 보정 전
float pumpMlps = 0;  // 초당 mL. 0이면 유량 보정 전

#if USE_DHT11_A
DHT dht(DHT_PIN, DHT11);
#endif
#if USE_SHT31_A
Adafruit_SHT31 shtA;
bool shtAFound = false;
#endif
#if USE_SHT31_B
Adafruit_SHT31 shtB;
bool shtBFound = false;
#endif

// 로드셀: 막히지 않게 하나씩 읽어 최근 10개(약 1초)를 모은다 (FW-04)
#if USE_HX711
HX711 scale;
#endif
const int HX_N = 10;
long hxBuf[HX_N];
int hxCount = 0, hxHead = 0;
unsigned long hxLastRead = 0;

// 시간이 걸리는 보정 작업 (tare 약 2초, cal)
enum HxOp { HX_NONE, HX_TARE, HX_CAL };
HxOp hxOp = HX_NONE;
double hxOpSum = 0;
int hxOpN = 0;
float hxOpGram = 0;
unsigned long hxOpStart = 0;

// 펌프
bool pumpOn = false;
unsigned long pumpStart = 0, pumpDur = 0, pumpOffAt = 0;
bool pumpEverOff = false;
float pumpMl = NAN;  // water로 켰을 때 mL, 아니면 NAN
float dayMl = 0;     // 오늘 급수량 (WiFi·시각이 없는 지금은 부팅 후 누적)

// 시리얼 명령 한 줄
String lineBuf;

// ------------------------------------------------------------ JSON 만들기

struct Json {
  String s;
  Json(const char* t) {
    s.reserve(512);
    s = "{\"t\":\"";
    s += t;
    s += "\",\"node\":\"";
    s += nodeId;
    s += "\",\"ms\":";
    s += String(millis());
  }
  Json& raw(const char* k, const String& v) {
    s += ",\"";
    s += k;
    s += "\":";
    s += v;
    return *this;
  }
  Json& null(const char* k) { return raw(k, "null"); }
  Json& num(const char* k, double v, int digits) {
    if (isnan(v) || isinf(v)) return null(k);
    return raw(k, String(v, digits));
  }
  Json& i(const char* k, long v) { return raw(k, String(v)); }
  Json& b(const char* k, bool v) { return raw(k, v ? "1" : "0"); }
  Json& str(const char* k, const String& v) {
    String e = v;
    e.replace("\\", "\\\\");
    e.replace("\"", "\\\"");
    return raw(k, "\"" + e + "\"");
  }
  void send() {
    s += "}";
    Serial.println(s);
  }
};

void ack(const String& cmd, bool ok, const String& msg = "") {
  Json("ack").str("cmd", cmd).b("ok", ok).str("msg", msg).send();
}

// ------------------------------------------------------------ 저장 (NVS)

void loadPrefs() {
  prefs.begin("chamgap", true);
  nodeId = prefs.getString("node_id", DEFAULT_NODE_ID);
  sampleMs = prefs.getULong("sample_ms", DEFAULT_SAMPLE_MS);
  soilCal[0] = prefs.isKey("soilA_air") && prefs.isKey("soilA_wet");
  soilCal[1] = prefs.isKey("soilB_air") && prefs.isKey("soilB_wet");
  soilAir[0] = prefs.getInt("soilA_air", SOIL_DEFAULT_AIR_MV);
  soilWet[0] = prefs.getInt("soilA_wet", SOIL_DEFAULT_WET_MV);
  soilAir[1] = prefs.getInt("soilB_air", SOIL_DEFAULT_AIR_MV);
  soilWet[1] = prefs.getInt("soilB_wet", SOIL_DEFAULT_WET_MV);
  lcHasOffset = prefs.isKey("lc_off");
  lcOffset = prefs.getLong("lc_off", 0);
  lcScale = prefs.getFloat("lc_scale", 0);
  pumpMlps = prefs.getFloat("pump_mlps", 0);
  prefs.end();
  nodeId.toUpperCase();
  if (sampleMs < 2000 || sampleMs > 600000) sampleMs = DEFAULT_SAMPLE_MS;
}

// ------------------------------------------------------------ 센서 읽기

int readMilliVolts(int pin) {
  long sum = 0;
  for (int k = 0; k < 16; k++) sum += analogReadMilliVolts(pin);
  return (int)(sum / 16);
}

// 토양 0~1 (0=공기, 1=물). 선 빠짐·단락 의심이면 NAN
float soilValue(int ch, int mv) {
  if (mv < 150 || mv > 3050) return NAN;
  int air = soilAir[ch], wet = soilWet[ch];
  if (air - wet < 100) return NAN;
  float v = (float)(air - mv) / (float)(air - wet);
  return constrain(v, -0.2f, 1.2f);
}

void hxPoll() {
#if USE_HX711
  if (!scale.is_ready()) return;
  long v = scale.read();
  hxBuf[hxHead] = v;
  hxHead = (hxHead + 1) % HX_N;
  if (hxCount < HX_N) hxCount++;
  hxLastRead = millis();
  if (hxOp != HX_NONE) {
    hxOpSum += v;
    hxOpN++;
  }
#endif
}

bool hxOk() { return USE_HX711 && hxCount > 0 && millis() - hxLastRead < 1000; }

void hxStats(double& avg, double& sd) {
  avg = 0;
  sd = 0;
  if (hxCount == 0) return;
  for (int k = 0; k < hxCount; k++) avg += hxBuf[k];
  avg /= hxCount;
  for (int k = 0; k < hxCount; k++) sd += (hxBuf[k] - avg) * (hxBuf[k] - avg);
  sd = sqrt(sd / hxCount);
}

bool lcCalibrated() { return lcHasOffset && fabs(lcScale) > 1e-6; }

float readV12() {
#if USE_V12_SENSE
  return readMilliVolts(V12_PIN) * (47.0f + 10.0f) / 10.0f / 1000.0f;
#else
  return NAN;
#endif
}

bool leakNow() {
#if USE_LEAK
  return digitalRead(LEAK_PIN) == LOW;  // 풀업: 물이 닿으면 LOW
#else
  return false;
#endif
}

// ------------------------------------------------------------ 메시지

void sendData() {
  seq++;
  Json j("data");
  j.i("seq", seq);

  // 온습도 A (지금은 DHT11)
#if USE_DHT11_A
  float ta = dht.readTemperature(), ha = dht.readHumidity();
  bool okA = !isnan(ta) && !isnan(ha);
  j.b("sht_a_ok", okA).num("temp_a", okA ? ta : NAN, 2).num("rh_a", okA ? ha : NAN, 2);
#elif USE_SHT31_A
  float ta = shtAFound ? shtA.readTemperature() : NAN, ha = shtAFound ? shtA.readHumidity() : NAN;
  bool okA = !isnan(ta) && !isnan(ha);
  j.b("sht_a_ok", okA).num("temp_a", okA ? ta : NAN, 2).num("rh_a", okA ? ha : NAN, 2);
#else
  j.null("sht_a_ok").null("temp_a").null("rh_a");
#endif

  // 온습도 B (아직 없음 → null: 고장이 아니라 '연결 안 함')
#if USE_SHT31_B
  float tb = shtBFound ? shtB.readTemperature() : NAN, hb = shtBFound ? shtB.readHumidity() : NAN;
  bool okB = !isnan(tb) && !isnan(hb);
  j.b("sht_b_ok", okB).num("temp_b", okB ? tb : NAN, 2).num("rh_b", okB ? hb : NAN, 2);
#else
  j.null("sht_b_ok").null("temp_b").null("rh_b");
#endif

  // 토양 A·B
#if USE_SOIL_A
  int mvA = readMilliVolts(SOIL_A_PIN);
  j.i("soil_a_mv", mvA).num("soil_a", soilValue(0, mvA), 3);
#else
  j.null("soil_a_mv").null("soil_a");
#endif
#if USE_SOIL_B
  int mvB = readMilliVolts(SOIL_B_PIN);
  j.i("soil_b_mv", mvB).num("soil_b", soilValue(1, mvB), 3);
#else
  j.null("soil_b_mv").null("soil_b");
#endif

  // 무게
#if USE_HX711
  bool ok = hxOk();
  double avg, sd;
  hxStats(avg, sd);
  j.b("hx_ok", ok);
  if (ok && lcCalibrated()) {
    j.num("weight_g", (avg - lcOffset) / lcScale, 1).num("weight_sd", sd / fabs(lcScale), 2);
  } else {
    j.null("weight_g").null("weight_sd");
  }
  if (ok) j.i("weight_raw", lround(avg));  // 보정 전에도 값이 들어오는지 보이게 (규약 밖 추가 키)
  else j.null("weight_raw");
#else
  j.null("hx_ok").null("weight_g").null("weight_sd");
#endif

  j.num("v12", readV12(), 2);
#if USE_LEAK
  j.b("leak", leakNow());
#else
  j.null("leak");
#endif
  j.b("pump", pumpOn).null("rssi");
  j.send();
}

void sendInfo() {
  Json j("info");
  j.str("fw", FW_VERSION).i("sample_ms", sampleMs);
  j.b("soil_a_cal", soilCal[0]).b("soil_b_cal", soilCal[1]);
  j.b("soil_cal", soilCal[0] && soilCal[1]);
  j.i("soil_a_air", soilAir[0]).i("soil_a_wet", soilWet[0]).i("soil_b_air", soilAir[1]).i("soil_b_wet", soilWet[1]);
  j.b("lc_cal", lcCalibrated()).i("lc_offset", lcOffset).num("lc_scale", lcScale, 4);
  j.num("pump_mlps", pumpMlps, 3);
  j.b("v12_sense", USE_V12_SENSE).b("leak_sensor", USE_LEAK).b("mqtt", false);
  j.num("day_ml", dayMl, 1).i("day_limit_ml", MAX_ML_PER_DAY).i("max_ml", MAX_ML_PER_SHOT);
  // 어떤 센서를 달았는지 (웹이 '고장'과 '연결 안 함'을 구분하게)
  j.str("sensor_a", USE_DHT11_A ? "DHT11" : (USE_SHT31_A ? "SHT31" : "none"));
  j.b("sht_a_present", USE_DHT11_A || USE_SHT31_A).b("sht_b_present", USE_SHT31_B);
  j.b("soil_a_present", USE_SOIL_A).b("soil_b_present", USE_SOIL_B);
  j.b("hx_present", USE_HX711).b("pump_present", USE_PUMP);
  j.send();
}

void sendBoot() {
  Json j("evt");
  j.str("ev", "boot").str("fw", FW_VERSION).i("reset", (long)esp_reset_reason());
#if USE_SHT31_A
  j.b("sht_a", shtAFound);
#else
  j.b("sht_a", USE_DHT11_A);
#endif
#if USE_SHT31_B
  j.b("sht_b", shtBFound);
#else
  j.null("sht_b");
#endif
  j.send();
}

// ------------------------------------------------------------ 펌프 (안전: 요구사항 7장)

void pumpStop(const char* reason) {
  if (!pumpOn) return;
  digitalWrite(PUMP_PIN, LOW);
  unsigned long ran = millis() - pumpStart;
  if (ran > pumpDur) ran = pumpDur;
  float given = isnan(pumpMl) ? NAN : pumpMl * (float)ran / (float)pumpDur;
  if (!isnan(pumpMl)) dayMl -= pumpMl - given;  // 켤 때 전부 더했으니 덜 준 만큼 뺀다
  pumpOn = false;
  pumpOffAt = millis();
  pumpEverOff = true;
  Json("evt").str("ev", "pump_off").str("reason", reason).i("dur", pumpDur).i("ran", ran).num("ml", given, 1).send();
  pumpMl = NAN;
}

void refuse(const String& cmd, const char* reason, long ms, float ml) {
  Json("evt").str("ev", "refused").str("reason", reason).i("dur", ms).num("ml", ml, 1).send();
  ack(cmd, false, reason);
}

// water·pump 공통 검사. 통과하면 켠다
void pumpRequest(const String& cmd, long ms, float ml) {
  if (!USE_PUMP) return ack(cmd, false, "no_pump");
  if (pumpOn) return refuse(cmd, "already_on", ms, ml);
  if (pumpEverOff && millis() - pumpOffAt < PUMP_COOLDOWN_MS) return refuse(cmd, "cooldown", ms, ml);
  if (!isnan(ml)) {
    if (ml < 1 || ml > MAX_ML_PER_SHOT) return refuse(cmd, "bad_ml", ms, ml);
    if (dayMl + ml > MAX_ML_PER_DAY) return refuse(cmd, "daily_limit", ms, ml);
    if (pumpMlps <= 0) return refuse(cmd, "flow_uncal", ms, ml);
    ms = lround(ml / pumpMlps * 1000.0);
  }
  if (ms < PUMP_MS_MIN || ms > PUMP_MS_MAX) return refuse(cmd, "bad_ms", ms, ml);
  if (USE_V12_SENSE && readV12() < V12_MIN_VOLT) return refuse(cmd, "no_12v", ms, ml);
  if (leakNow()) return refuse(cmd, "leak", ms, ml);
  if (!isnan(ml) && USE_HX711 && !hxOk()) return refuse(cmd, "scale_dead", ms, ml);

  pumpOn = true;
  pumpStart = millis();
  pumpDur = ms;
  pumpMl = ml;
  if (!isnan(ml)) dayMl += ml;  // 안전 쪽으로: 켤 때 전부 더한다
  digitalWrite(PUMP_PIN, HIGH);
  Json("evt").str("ev", "pump_on").i("dur", ms).num("ml", ml, 1).send();
  ack(cmd, true);
}

void pumpPoll() {
  if (!pumpOn) return;
  if (millis() - pumpStart >= pumpDur) return pumpStop("done");
  if (USE_V12_SENSE && readV12() < V12_MIN_VOLT) return pumpStop("no_12v");
  if (leakNow()) return pumpStop("leak");
}

// ------------------------------------------------------------ 로드셀 보정 (막히지 않게)

void hxOpStartNow(HxOp op, float gram) {
  hxOp = op;
  hxOpSum = 0;
  hxOpN = 0;
  hxOpGram = gram;
  hxOpStart = millis();
}

void hxOpPoll() {
  if (hxOp == HX_NONE) return;
  const char* cmd = hxOp == HX_TARE ? "tare" : "cal";
  if (hxOpN >= 20 || millis() - hxOpStart > 4000) {
    HxOp op = hxOp;
    hxOp = HX_NONE;
    if (hxOpN < 5) return ack(cmd, false, "hx711 no response");
    double avg = hxOpSum / hxOpN;
    prefs.begin("chamgap", false);
    if (op == HX_TARE) {
      lcOffset = lround(avg);
      lcHasOffset = true;
      prefs.putLong("lc_off", lcOffset);
      prefs.end();
      ack(cmd, true, "offset=" + String(lcOffset));
    } else {
      float s = (float)((avg - lcOffset) / hxOpGram);
      if (fabs(s) < 1e-3) {
        prefs.end();
        return ack(cmd, false, "no change - put the weight on");
      }
      lcScale = s;
      prefs.putFloat("lc_scale", lcScale);
      prefs.end();
      ack(cmd, true, "scale=" + String(lcScale, 4));
    }
    sendInfo();
  }
}

// ------------------------------------------------------------ 명령 (요구사항 4.3)

void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) return;
  String args[4];
  int n = 0, start = 0;
  for (int k = 0; k <= (int)line.length() && n < 4; k++) {
    if (k == (int)line.length() || line[k] == ' ') {
      if (k > start) args[n++] = line.substring(start, k);
      start = k + 1;
    }
  }
  String cmd = args[0];
  cmd.toLowerCase();

  if (cmd == "help") {
    ack(cmd, true, "help status info water stop tare cal soilcal flow interval id reboot pump");
  } else if (cmd == "status") {
    sendData();
    ack(cmd, true);
  } else if (cmd == "info") {
    sendInfo();
    ack(cmd, true);
  } else if (cmd == "stop") {
    bool was = pumpOn;
    pumpStop("stop");
    ack(cmd, true, was ? "" : "not running");
  } else if (cmd == "water") {
    if (n < 2) return ack(cmd, false, "usage: water <mL>");
    pumpRequest(cmd, 0, args[1].toFloat());
  } else if (cmd == "pump") {
    if (n < 2) return ack(cmd, false, "usage: pump <ms>");
    pumpRequest(cmd, args[1].toInt(), NAN);
  } else if (cmd == "tare") {
    if (!USE_HX711 || !hxOk()) return ack(cmd, false, "hx711 no response");
    if (hxOp != HX_NONE) return ack(cmd, false, "busy");
    hxOpStartNow(HX_TARE, 0);
  } else if (cmd == "cal") {
    float g = n >= 2 ? args[1].toFloat() : 0;
    if (g <= 0) return ack(cmd, false, "usage: cal <g>");
    if (!lcHasOffset) return ack(cmd, false, "tare first");
    if (!USE_HX711 || !hxOk()) return ack(cmd, false, "hx711 no response");
    if (hxOp != HX_NONE) return ack(cmd, false, "busy");
    hxOpStartNow(HX_CAL, g);
  } else if (cmd == "soilcal") {
    String ch = args[1], kind = args[2];
    ch.toLowerCase();
    kind.toLowerCase();
    int c = ch == "a" ? 0 : (ch == "b" ? 1 : -1);
    int pin = c == 0 ? SOIL_A_PIN : SOIL_B_PIN;
    bool present = c == 0 ? USE_SOIL_A : USE_SOIL_B;
    if (c < 0 || (kind != "air" && kind != "wet")) return ack(cmd, false, "usage: soilcal a|b air|wet");
    if (!present) return ack(cmd, false, "no sensor");
    int mv = readMilliVolts(pin);
    if (mv < 150 || mv > 3050) return ack(cmd, false, "bad reading " + String(mv) + "mV");
    prefs.begin("chamgap", false);
    String key = String(c == 0 ? "soilA_" : "soilB_") + kind;
    prefs.putInt(key.c_str(), mv);
    if (kind == "air") soilAir[c] = mv;
    else soilWet[c] = mv;
    soilCal[c] = prefs.isKey(c == 0 ? "soilA_air" : "soilB_air") && prefs.isKey(c == 0 ? "soilA_wet" : "soilB_wet");
    prefs.end();
    ack(cmd, true, key + "=" + String(mv));
    sendInfo();
  } else if (cmd == "flow") {
    long ms = args[1].toInt();
    float g = args[2].toFloat();
    if (ms <= 0 || g <= 0) return ack(cmd, false, "usage: flow <ms> <g>");
    pumpMlps = g / (ms / 1000.0f);
    prefs.begin("chamgap", false);
    prefs.putFloat("pump_mlps", pumpMlps);
    prefs.end();
    ack(cmd, true, "mlps=" + String(pumpMlps, 3));
    sendInfo();
  } else if (cmd == "interval") {
    long ms = args[1].toInt();
    if (ms < 2000 || ms > 600000) return ack(cmd, false, "range 2000-600000");
    sampleMs = ms;
    prefs.begin("chamgap", false);
    prefs.putULong("sample_ms", sampleMs);
    prefs.end();
    ack(cmd, true);
    sendInfo();
  } else if (cmd == "id") {
    if (n < 2) return ack(cmd, false, "usage: id z2");
    String id = args[1];
    id.toUpperCase();
    prefs.begin("chamgap", false);
    prefs.putString("node_id", id);
    prefs.end();
    ack(cmd, true, "reboot to apply");
  } else if (cmd == "reboot") {
    pumpStop("reboot");
    ack(cmd, true);
    delay(200);
    ESP.restart();
  } else if (cmd == "flowcal") {
    ack(cmd, false, "not_supported_yet");  // P2에서 (펌프 + 전후 무게)
  } else {
    ack(cmd, false, "unknown command");
  }
}

void serialPoll() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      handleCommand(lineBuf);
      lineBuf = "";
    } else if (c != '\r' && lineBuf.length() < 120) {
      lineBuf += c;
    }
  }
}

// ------------------------------------------------------------ 시작·반복

void setup() {
  // FW-01: 가장 먼저 펌프를 끈다
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);

  Serial.begin(115200);
  delay(300);
  loadPrefs();
  analogReadResolution(12);

#if USE_DHT11_A
  dht.begin();
#endif
#if USE_SHT31_A || USE_SHT31_B
  Wire.begin(21, 22);
#endif
#if USE_SHT31_A
  shtAFound = shtA.begin(0x44);
#endif
#if USE_SHT31_B
  shtBFound = shtB.begin(0x45);
#endif
#if USE_HX711
  scale.begin(HX_DOUT_PIN, HX_SCK_PIN);
#endif
#if USE_LEAK
  pinMode(LEAK_PIN, INPUT_PULLUP);
#endif

  Serial.println("# 참값 노드 시작 " FW_VERSION " · 구역 " + nodeId);
  sendBoot();
  sendInfo();
  lastSample = millis() - sampleMs + 1500;  // 첫 측정은 1.5초 뒤 (DHT11 준비 시간)
}

void loop() {
  hxPoll();
  hxOpPoll();
  serialPoll();
  pumpPoll();
  if (millis() - lastSample >= sampleMs) {
    lastSample = millis();
    sendData();
  }
}
