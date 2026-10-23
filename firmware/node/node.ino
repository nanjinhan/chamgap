// 참값(CHAMGAP) 노드 펌웨어 — WiFi · Supabase 버전 (node-2.1)
//
// 하는 일
//  - sample_ms(기본 5초)마다 센서 값을 Supabase readings 표에 올리고, 시리얼에도 한 줄 JSON(data)으로 보낸다
//  - 웹에서 넣은 명령(commands 표)과 시리얼로 받은 명령(info, tare, cal 500, soilcal a air, water 10, stop ...)을
//    실행하고 ack를 보낸다 (Supabase에서 온 명령은 결과를 commands 표에 적는다)
//  - 펌프 안전은 여기서 최종 판단한다 (부팅 시 끔, 최대 15초, 쉬는 시간 3초, 1회 50mL, 하루 300mL).
//    WiFi·Supabase가 끊겨도 펌프는 정해진 시간에 꺼진다 (네트워크는 cloud.h 의 별도 작업이 맡는다)
//
// 통신 규약: docs/01_requirements.md 4장. 설정은 config.h, 비밀값은 secrets.h, 네트워크는 cloud.h.

#include <Arduino.h>
#include <Preferences.h>
#include <math.h>
#include "config.h"
#include "cloud.h"

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

#define FW_VERSION "node-2.1"

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
const char* lastOffReason = "";

// 오늘 급수량 (FW-12, SAFE-10). 시각(NTP)을 알면 한국 날짜 기준으로 NVS에 저장하고,
// 시각을 모르는 동안은 부팅 후 누적으로 센다
float dayMl = 0;
unsigned long dayKey = 0;  // 오늘 YYYYMMDD. 0 = 아직 시각 모름
unsigned long savedDayKey = 0;
float savedDayMl = 0;

// 유량 측정 (flowcal): 안정 무게 → 펌프 → 안정 무게
enum FcStage { FC_NONE, FC_BEFORE, FC_PUMP, FC_AFTER };
FcStage fcStage = FC_NONE;
unsigned long fcAt = 0;
long fcMs = 0;
float fcBefore = NAN;

// Supabase 명령 id: 지금 처리 중인 명령(0이면 시리얼 명령), 시간이 걸리는 작업이 끝나면 답할 명령
long ackCmdId = 0;
long hxOpCmdId = 0;
long fcCmdId = 0;

// 시리얼 명령 한 줄
String lineBuf;

// ------------------------------------------------------------ JSON 만들기

struct Json {
  String s;
  String type;
  String ev;      // evt 의 종류 → events.ev
  int bodyStart;  // "t"를 뺀 나머지가 시작하는 곳 (readings 행은 t 열이 없다)
  bool okv = true;
  Json(const char* t) : type(t) {
    s.reserve(640);
    s = "{\"t\":\"";
    s += t;
    s += "\",";
    bodyStart = s.length();
    s += "\"node\":\"";
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
  Json& evt(const char* name) {
    ev = name;
    return str("ev", name);
  }
  Json& ok(bool v) {
    okv = v;
    return b("ok", v);
  }
  // 시리얼에 한 줄 쓰고, 종류에 맞는 Supabase 표로 보낸다 (SYS-03)
  String send() {
    s += "}";
    serialLine(s);
    if (type == "data") {
      cloudPost(CK_READING, "{" + s.substring(bodyStart));
    } else if (type == "evt" || type == "info") {
      String e = ev.length() ? "\"" + ev + "\"" : String("null");
      cloudPost(CK_EVENT, "{\"node\":\"" + nodeId + "\",\"t\":\"" + type + "\",\"ev\":" + e + ",\"payload\":" + s + "}");
    } else if (type == "ack" && ackCmdId > 0) {
      cloudPost(CK_FINISH, "{\"p_id\":" + String(ackCmdId) + ",\"p_ok\":" + (okv ? "true" : "false") + ",\"p_result\":" + s + "}");
      ackCmdId = 0;
    }
    return s;
  }
};

void ack(const String& cmd, bool ok, const String& msg = "") {
  Json("ack").str("cmd", cmd).ok(ok).str("msg", msg).send();
}

// 구역 상태(nodes 표): 펌프와 오늘 급수량
void sendPumpState() {
  cloudPost(CK_NODE, "{\"node\":\"" + nodeId + "\",\"pump\":" + (pumpOn ? "1" : "0") + ",\"day_ml\":" + String(dayMl, 1) + "}");
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
  savedDayKey = prefs.getULong("day_key", 0);
  savedDayMl = prefs.getFloat("day_ml", 0);
  prefs.end();
  nodeId.toUpperCase();
  if (sampleMs < 2000 || sampleMs > 600000) sampleMs = DEFAULT_SAMPLE_MS;
}

// 오늘 급수량 저장 (시각을 알 때만: 모르면 어느 날 값인지 몰라 저장된 값을 덮지 않는다)
void saveDay() {
  if (dayKey == 0) return;
  prefs.begin("chamgap", false);
  prefs.putULong("day_key", dayKey);
  prefs.putFloat("day_ml", dayMl);
  prefs.end();
}

// 한국 날짜 YYYYMMDD, 시각을 모르면 0
unsigned long todayKey() {
  struct tm t;
  if (!getLocalTime(&t, 0) || t.tm_year + 1900 < 2025) return 0;
  return (t.tm_year + 1900) * 10000UL + (t.tm_mon + 1) * 100UL + t.tm_mday;
}

// 1초마다: 시각을 처음 알게 되면 같은 날 저장된 급수량을 더하고, 날짜가 바뀌면 0부터 센다
void dayTick() {
  static unsigned long last = 0;
  if (millis() - last < 1000) return;
  last = millis();
  unsigned long k = todayKey();
  if (k == 0 || k == dayKey) return;
  if (dayKey == 0) {
    if (savedDayKey == k) dayMl += savedDayMl;  // 재시작 전에 오늘 준 물 (SAFE-10)
    serialLine("# 시각 맞춤(NTP) 완료 · 오늘 " + String(k) + " · 오늘 급수 " + String(dayMl, 1) + "mL");
  } else {
    dayMl = 0;
  }
  dayKey = k;
  saveDay();
  sendInfo();
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
  j.b("pump", pumpOn);
  if (cloudWifiUp()) j.i("rssi", cloudRssi());
  else j.null("rssi");
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
  j.b("v12_sense", USE_V12_SENSE).b("leak_sensor", USE_LEAK).b("cloud", USE_CLOUD);
  j.num("day_ml", dayMl, 1).i("day_limit_ml", MAX_ML_PER_DAY).i("max_ml", MAX_ML_PER_SHOT);
  // 어떤 센서를 달았는지 (웹이 '고장'과 '연결 안 함'을 구분하게)
  j.str("sensor_a", USE_DHT11_A ? "DHT11" : (USE_SHT31_A ? "SHT31" : "none"));
  j.b("sht_a_present", USE_DHT11_A || USE_SHT31_A).b("sht_b_present", USE_SHT31_B);
  j.b("soil_a_present", USE_SOIL_A).b("soil_b_present", USE_SOIL_B);
  j.b("hx_present", USE_HX711).b("pump_present", USE_PUMP);
  String line = j.send();
  cloudPost(CK_NODE, "{\"node\":\"" + nodeId + "\",\"fw\":\"" FW_VERSION "\",\"info\":" + line +
                         ",\"pump\":" + (pumpOn ? "1" : "0") + ",\"day_ml\":" + String(dayMl, 1) + "}");
}

void sendBoot() {
  Json j("evt");
  j.evt("boot").str("fw", FW_VERSION).i("reset", (long)esp_reset_reason());
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
  lastOffReason = reason;
  Json("evt").evt("pump_off").str("reason", reason).i("dur", pumpDur).i("ran", ran).num("ml", given, 1).send();
  if (!isnan(pumpMl)) saveDay();
  pumpMl = NAN;
  sendPumpState();
}

void refuse(const String& cmd, const char* reason, long ms, float ml) {
  Json("evt").evt("refused").str("reason", reason).i("dur", ms).num("ml", ml, 1).send();
  ack(cmd, false, reason);
}

// water·pump·flowcal 공통 검사 (SAFE-03 순서). 통과하면 nullptr, 아니면 거부 이유. water면 ms를 계산해 넣는다
const char* pumpCheck(long& ms, float ml) {
  if (pumpOn) return "already_on";
  if (pumpEverOff && millis() - pumpOffAt < PUMP_COOLDOWN_MS) return "cooldown";
  if (!isnan(ml)) {
    if (ml < 1 || ml > MAX_ML_PER_SHOT) return "bad_ml";
    if (dayMl + ml > MAX_ML_PER_DAY) return "daily_limit";
    if (pumpMlps <= 0) return "flow_uncal";
    ms = lround(ml / pumpMlps * 1000.0);
  }
  if (ms < PUMP_MS_MIN || ms > PUMP_MS_MAX) return "bad_ms";
  if (USE_V12_SENSE && readV12() < V12_MIN_VOLT) return "no_12v";
  if (leakNow()) return "leak";
  if (!isnan(ml) && USE_HX711 && !hxOk()) return "scale_dead";
  return nullptr;
}

void pumpRun(long ms, float ml) {
  pumpOn = true;
  pumpStart = millis();
  pumpDur = ms;
  pumpMl = ml;
  digitalWrite(PUMP_PIN, HIGH);
  if (!isnan(ml)) {
    dayMl += ml;  // 안전 쪽으로: 켤 때 전부 더한다
    saveDay();
  }
  Json("evt").evt("pump_on").i("dur", ms).num("ml", ml, 1).send();
  sendPumpState();
}

void pumpRequest(const String& cmd, long ms, float ml) {
  if (!USE_PUMP) return ack(cmd, false, "no_pump");
  const char* why = pumpCheck(ms, ml);
  if (why) return refuse(cmd, why, ms, ml);
  pumpRun(ms, ml);
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
  hxOpCmdId = ackCmdId;  // 끝날 때 이 명령에 답한다
  ackCmdId = 0;
}

void hxOpPoll() {
  if (hxOp == HX_NONE) return;
  const char* cmd = hxOp == HX_TARE ? "tare" : "cal";
  if (hxOpN >= 20 || millis() - hxOpStart > 4000) {
    HxOp op = hxOp;
    hxOp = HX_NONE;
    ackCmdId = hxOpCmdId;
    hxOpCmdId = 0;
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

// ------------------------------------------------------------ 유량 측정 flowcal (요구사항 4.3, 저장은 안 함)
// 안정 무게 → ms 동안 펌프 → 물이 떨어질 때까지 기다린 뒤 안정 무게 → 증가량을 ack로 (before_g, after_g, delta_g)

bool weightNow(float& g, bool& stable) {
  if (!hxOk() || !lcCalibrated() || hxCount < HX_N) return false;
  double avg, sd;
  hxStats(avg, sd);
  g = (avg - lcOffset) / lcScale;
  stable = sd / fabs(lcScale) <= FLOWCAL_STABLE_SD_G;
  return true;
}

void fcFinish(bool ok, const char* msg, float after) {
  fcStage = FC_NONE;
  ackCmdId = fcCmdId;
  fcCmdId = 0;
  float delta = isnan(fcBefore) || isnan(after) ? NAN : after - fcBefore;
  Json("ack").str("cmd", "flowcal").ok(ok).str("msg", msg).i("dur", fcMs)
      .num("before_g", fcBefore, 1).num("after_g", after, 1).num("delta_g", delta, 1).send();
}

void fcPoll() {
  if (fcStage == FC_NONE) return;
  unsigned long el = millis() - fcAt;
  float g = NAN;
  bool stable = false;
  bool have = weightNow(g, stable);

  if (fcStage == FC_BEFORE) {
    if (have && stable) {
      fcBefore = g;
      long ms = fcMs;
      const char* why = pumpCheck(ms, NAN);
      if (why) {
        Json("evt").evt("refused").str("reason", why).i("dur", ms).null("ml").send();
        return fcFinish(false, why, NAN);
      }
      pumpRun(ms, NAN);
      fcStage = FC_PUMP;
      fcAt = millis();
    } else if (el > FLOWCAL_BEFORE_MS) {
      fcFinish(false, have ? "unstable" : "scale_dead", NAN);
    }
  } else if (fcStage == FC_PUMP) {
    if (pumpOn) return;
    if (strcmp(lastOffReason, "done") != 0) return fcFinish(false, lastOffReason, NAN);  // stop·누수·12V 등으로 멈춤
    fcStage = FC_AFTER;
    fcAt = millis();
  } else if (fcStage == FC_AFTER) {
    if (el < FLOWCAL_SETTLE_MS) return;
    if (!(have && stable) && el < FLOWCAL_SETTLE_MS + FLOWCAL_AFTER_MS) return;
    if (!have) return fcFinish(false, "scale_dead", NAN);
    float delta = g - fcBefore;
    if (delta > 0) {  // 실제로 준 물도 오늘 급수량에 센다
      dayMl += delta;
      saveDay();
      sendPumpState();
    }
    fcFinish(stable, stable ? "" : "unstable", g);
  }
}

// ------------------------------------------------------------ 명령 (요구사항 4.3)

// 보정·펌프 작업이 진행 중인지 (그동안 다른 보정·펌프 명령은 busy)
bool busy() { return hxOp != HX_NONE || fcStage != FC_NONE; }

void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) return;
  bool fromCloud = ackCmdId > 0;
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

  if (cmd == "help" || cmd == "pump") {
    if (fromCloud) return ack(cmd, false, "serial_only");  // 웹에서는 water·flowcal만 (COM-13)
  }

  if (cmd == "help") {
    ack(cmd, true, "help status info water stop tare cal soilcal flow flowcal interval id reboot pump");
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
    if (busy()) return ack(cmd, false, "busy");
    pumpRequest(cmd, 0, args[1].toFloat());
  } else if (cmd == "pump") {
    if (n < 2) return ack(cmd, false, "usage: pump <ms>");
    if (busy()) return ack(cmd, false, "busy");
    pumpRequest(cmd, args[1].toInt(), NAN);
  } else if (cmd == "tare") {
    if (!USE_HX711 || !hxOk()) return ack(cmd, false, "hx711 no response");
    if (busy()) return ack(cmd, false, "busy");
    hxOpStartNow(HX_TARE, 0);
  } else if (cmd == "cal") {
    float g = n >= 2 ? args[1].toFloat() : 0;
    if (g <= 0) return ack(cmd, false, "usage: cal <g>");
    if (!lcHasOffset) return ack(cmd, false, "tare first");
    if (!USE_HX711 || !hxOk()) return ack(cmd, false, "hx711 no response");
    if (busy()) return ack(cmd, false, "busy");
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
  } else if (cmd == "flowcal") {
    long ms = args[1].toInt();
    if (!USE_PUMP) return ack(cmd, false, "no_pump");
    if (ms < PUMP_MS_MIN || ms > PUMP_MS_MAX) return ack(cmd, false, "bad_ms");
    if (!USE_HX711 || !hxOk()) return ack(cmd, false, "scale_dead");
    if (!lcCalibrated()) return ack(cmd, false, "lc_uncal");  // 로드셀 보정(tare·cal)이 먼저
    if (dayMl >= MAX_ML_PER_DAY) return ack(cmd, false, "daily_limit");
    if (busy()) return ack(cmd, false, "busy");
    fcStage = FC_BEFORE;
    fcAt = millis();
    fcMs = ms;
    fcBefore = NAN;
    fcCmdId = ackCmdId;  // 끝날 때(최대 약 90초 뒤) 이 명령에 답한다
    ackCmdId = 0;
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
    cloudFlush(3000);  // 결과를 Supabase에 보낸 뒤 재시작
    delay(200);
    ESP.restart();
  } else {
    ack(cmd, false, "unknown command");
  }
}

// 명령 하나 실행. id > 0 이면 Supabase에서 온 명령이라 ack가 그 명령의 결과로 올라간다
void runCommand(const String& line, long id) {
  if (id > 0) serialLine("# 웹 명령 #" + String(id) + ": " + line);
  ackCmdId = id;
  handleCommand(line);
  ackCmdId = 0;
}

void serialPoll() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      runCommand(lineBuf, 0);
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

  serialMutex = xSemaphoreCreateMutex();
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

  serialLine("# 참값 노드 시작 " FW_VERSION " · 구역 " + nodeId);
#if USE_SHT31_A
  serialLine(shtAFound ? "# 온습도 A (SHT31, 0x44) 찾음" : "# 온습도 A (SHT31, 0x44) 못 찾음 — SDA 21·SCL 22·3.3V·GND 선, A의 ADR 핀이 GND인지 확인");
#endif
#if USE_SHT31_B
  serialLine(shtBFound ? "# 온습도 B (SHT31, 0x45) 찾음" : "# 온습도 B (SHT31, 0x45) 못 찾음 — B의 ADR 핀을 VIN(3.3V)에 연결해야 0x45가 된다");
#endif
  cloudBegin(nodeId);  // WiFi·Supabase는 코어 0에서 따로 (이 함수는 바로 돌아온다)
  sendBoot();
  sendInfo();
  lastSample = millis() - sampleMs + 1500;  // 첫 측정은 1.5초 뒤 (DHT11 준비 시간)
}

void loop() {
  hxPoll();
  hxOpPoll();
  serialPoll();
  CloudCmd c;
  if (cloudNextCommand(c)) runCommand(c.cmd, c.id);
  pumpPoll();
  fcPoll();
  dayTick();
  if (cloudTakeJustConnected()) sendInfo();  // WiFi에 붙을 때마다 nodes 표를 최신으로
  if (millis() - lastSample >= sampleMs) {
    lastSample = millis();
    sendData();
  }
}
