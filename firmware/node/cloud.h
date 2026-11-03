// 참값 노드 — WiFi · Supabase 연결 (요구사항지시서 v2.0 FW-09~FW-14)
//
// 네트워크는 코어 0의 별도 작업(cloudTask)에서만 한다. 본 루프(센서·펌프·명령)는 네트워크가 느리거나 끊겨도 막히지 않는다.
//  - 본 루프 → cloudPost(): 보낼 것을 줄(outQ)에 넣기만 한다
//  - cloudTask → 줄에서 하나씩 꺼내 HTTPS로 올린다. WiFi가 끊긴 동안의 측정값은 버린다 (FW-09)
//  - 명령: Realtime(WebSocket)으로 "새 명령" 알림을 받으면 rpc/claim_command 로 하나씩 가져와 inQ에 넣는다.
//          알림을 놓쳐도 30초마다 한 번, Realtime이 안 되면 2초마다 가져온다 (FW-10)
//  - 시리얼 출력은 serialLine() 하나로만 한다 (두 작업의 줄이 섞이지 않게)
#pragma once

#include <Arduino.h>
#include <time.h>
#include "config.h"

// 시리얼 한 줄 (두 작업이 함께 쓰므로 잠금)
SemaphoreHandle_t serialMutex = nullptr;

void serialLine(const String& line) {
  if (serialMutex) xSemaphoreTake(serialMutex, portMAX_DELAY);
  Serial.println(line);
  if (serialMutex) xSemaphoreGive(serialMutex);
}

// 보낼 것의 종류
enum CloudKind : uint8_t { CK_READING, CK_EVENT, CK_NODE, CK_FINISH };

// 받은 명령
struct CloudCmd {
  long id;
  char cmd[64];
};

// 연결 상태 숫자 (원격 진단용)
struct CloudStats {
  uint32_t wifiDrops;  // 부팅 후 WiFi가 끊긴 횟수
  int dropReason;      // 마지막으로 끊긴 이유 번호 (wifi_err_reason_t)
  uint32_t netFails;   // HTTPS 요청이 연결 오류로 실패한 횟수
  bool realtime;       // Realtime 명령 알림이 연결돼 있는지
};

#if USE_CLOUD

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "secrets.h 가 없습니다. secrets.example.h 를 복사해 secrets.h 로 저장하고 WiFi·Supabase 값을 채우세요."
#endif

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

struct CloudOut {
  CloudKind kind;
  String* body;  // new 로 만들고 cloudTask 가 delete
};

static QueueHandle_t outQ = nullptr;
static QueueHandle_t inQ = nullptr;
static char cloudNode[17] = "";
static volatile bool wifiUp = false;
static volatile bool rtJoined = false;
static volatile bool justConnected = false;
static volatile int rssiNow = 0;
static volatile int wifiReason = 0;
static volatile bool sending = false;

static WiFiClientSecure tls;
static HTTPClient http;
static WebSocketsClient rt;  // rtTask 에서만 쓴다
static bool rtStarted = false;
static volatile bool rtWake = false;
static unsigned long rtLastBeat = 0, lastClaim = 0, lastFailLog = 0, lastRssi = 0;
static long rtRef = 1;

// 스스로 고치기와 원격 진단용 (info 에 실려 Supabase로 간다)
static volatile unsigned long lastReachAt = 0;  // 마지막으로 Supabase가 응답한 시각
static unsigned long lastHealAt = 0;
static volatile bool needRestart = false;
static volatile uint32_t wifiDrops = 0, netFails = 0;
static volatile int lastDropReason = 0;

static void cloudLog(const String& msg) { serialLine("# " + msg); }

// WiFi가 끊긴 이유를 사람 말로 (esp_wifi_types.h 의 wifi_err_reason_t)
static String wifiReasonText(int r) {
  switch (r) {
    case WIFI_REASON_NO_AP_FOUND:
    case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
    case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD:
    case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD:
      return "와이파이가 사라졌어요 — 공유기 전원, 2.4GHz 인지 확인";
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
      return "비밀번호가 틀린 것 같아요 — secrets.h 의 그 와이파이 비밀번호 확인";
    case WIFI_REASON_BEACON_TIMEOUT:
      return "신호가 약하거나 공유기가 꺼졌어요";
    default:
      return "연결 실패 (이유 번호 " + String(r) + ")";
  }
}

static void onWifiEvent(WiFiEvent_t e, WiFiEventInfo_t info) {
  if (e == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) wifiReason = info.wifi_sta_disconnected.reason;
}

// 등록한 WiFi (secrets.h 의 ①②③). 예시 값("…와이파이_…")이나 빈 칸은 뺀다
struct WifiCred {
  const char* ssid;
  const char* pass;
};
static WifiCred wifiList[3];
static int wifiCount = 0;
static int wifiTrying = -1;  // 지금 붙으려는 것 (-1: 없음)

static void addWifi(const char* ssid, const char* pass) {
  if (!ssid || !*ssid || strstr(ssid, "와이파이_") || wifiCount >= 3) return;
  wifiList[wifiCount++] = {ssid, pass};
}

static String wifiNames() {
  String s;
  for (int k = 0; k < wifiCount; k++) s += String(k ? ", " : "") + wifiList[k].ssid;
  return s;
}

// 주변을 훑어 등록한 WiFi 중 가장 센 곳에 붙기 시작한다 (결과는 cloudTask 가 지켜본다).
// 하나도 안 보이면, 지금 보이는 WiFi 이름을 알려 준다 (secrets.h 에 그대로 옮겨 적으면 된다)
static void wifiConnect() {
  WiFi.disconnect();
  int n = WiFi.scanNetworks();
  int best = -1, bestRssi = -1000;
  String seen;
  int seenCount = 0;
  for (int i = 0; i < n; i++) {
    String s = WiFi.SSID(i);
    for (int k = 0; k < wifiCount; k++) {
      if (s == wifiList[k].ssid && WiFi.RSSI(i) > bestRssi) {
        best = k;
        bestRssi = WiFi.RSSI(i);
      }
    }
    if (s.length() && seenCount < 8 && seen.indexOf("\"" + s + "\"") < 0) {
      seen += String(seenCount++ ? ", " : "") + "\"" + s + "\"";
    }
  }
  WiFi.scanDelete();
  wifiTrying = best;
  wifiReason = 0;
  if (best < 0) {
    cloudLog("등록한 WiFi(" + wifiNames() + ")가 안 보여요. 지금 보이는 2.4GHz WiFi: " + (seenCount ? seen : String("없음")));
    return;
  }
  cloudLog(String("WiFi 연결 중: ") + wifiList[best].ssid + " (세기 " + bestRssi + "dBm)");
  WiFi.begin(wifiList[best].ssid, wifiList[best].pass);
}

// ------------------------------------------------------------ REST (HTTPS)

static int rest(const char* path, const String& body, const char* prefer, String* resp) {
  String url = String(SUPABASE_URL) + "/rest/v1/" + path;
  if (!http.begin(tls, url)) return -1;
  http.addHeader("apikey", SUPABASE_KEY);
  // 새 공개 키(sb_)는 JWT가 아니라 apikey 헤더에만. 옛 anon 키는 Authorization 에도
  if (strncmp(SUPABASE_KEY, "sb_", 3) != 0) http.addHeader("Authorization", "Bearer " SUPABASE_KEY);
  http.addHeader("x-device-key", DEVICE_KEY);
  http.addHeader("Content-Type", "application/json");
  if (prefer) http.addHeader("Prefer", prefer);
  int code = http.POST(body);
  if (resp) *resp = code > 0 ? http.getString() : String();
  http.end();
  if (code > 0) {
    lastReachAt = millis();  // 오류 응답이어도 인터넷 길은 살아 있다
  } else {
    netFails = netFails + 1;
    tls.stop();  // 연결이 깨졌으면 다음에 새로 연다
  }
  return code;
}

// 실패를 알려 준다 (같은 말이 쏟아지지 않게 10초에 한 번)
static void cloudFail(const char* what, int code, const String& body) {
  if (millis() - lastFailLog < 10000) return;
  lastFailLog = millis();
  String hint;
  if (code < 0) hint = "인터넷 연결 확인 (" + HTTPClient::errorToString(code) + ")";
  else if (body.indexOf("Invalid API key") >= 0) hint = "secrets.h 의 SUPABASE_KEY(공개 키) 확인";
  else if (body.indexOf("42501") >= 0) hint = "secrets.h 의 DEVICE_KEY(기기 키) 확인";
  else if (code == 404) hint = "supabase/schema.sql 을 SQL Editor에서 다시 실행하세요 (새 함수·표가 없음)";
  else hint = body.substring(0, 160);
  cloudLog(String("Supabase 실패: ") + what + " HTTP " + code + " — " + hint);
}

static const char* pathOf(CloudKind k) {
  switch (k) {
    case CK_READING: return "readings";
    case CK_EVENT: return "events";
    case CK_NODE: return "nodes?on_conflict=node";
    default: return "rpc/finish_command";
  }
}

static void sendOne(const CloudOut& o) {
  const char* prefer = o.kind == CK_NODE ? "resolution=merge-duplicates,return=minimal" : "return=minimal";
  String resp;
  int code = -1;
  // 연결 오류(code < 0)면 새 연결로 한 번 더
  for (int k = 0; k < 2; k++) {
    code = rest(pathOf(o.kind), *o.body, prefer, &resp);
    if (code > 0) break;
  }
  if (code < 200 || code >= 300) cloudFail(pathOf(o.kind), code, resp);
}

// ------------------------------------------------------------ 명령 가져오기

static bool claimOne() {
  String resp;
  int code = rest("rpc/claim_command", String("{\"p_node\":\"") + cloudNode + "\"}", nullptr, &resp);
  if (code != 200) {
    cloudFail("claim_command", code, resp);
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return false;
  JsonArray rows = doc.as<JsonArray>();
  if (rows.size() == 0) return false;
  CloudCmd c;
  c.id = rows[0]["id"] | 0L;
  strlcpy(c.cmd, rows[0]["cmd"] | "", sizeof c.cmd);
  if (c.id <= 0) return false;
  if (xQueueSend(inQ, &c, pdMS_TO_TICKS(2000)) != pdTRUE) {
    String r = String("{\"p_id\":") + c.id + ",\"p_ok\":false,\"p_result\":{\"ok\":0,\"msg\":\"busy\"}}";
    rest("rpc/finish_command", r, "return=minimal", nullptr);
  }
  return true;
}

// ------------------------------------------------------------ Realtime (Phoenix 프로토콜)

static void rtSend(const String& msg) {
  String m = msg;
  rt.sendTXT(m);
}

static void rtJoin() {
  String topic = String("realtime:node-") + cloudNode;
  rtSend(String("{\"topic\":\"") + topic +
         "\",\"event\":\"phx_join\",\"payload\":{\"config\":{\"broadcast\":{\"self\":false},\"presence\":{\"key\":\"\"},"
         "\"postgres_changes\":[{\"event\":\"INSERT\",\"schema\":\"public\",\"table\":\"commands\",\"filter\":\"node=eq." +
         cloudNode + "\"}]}},\"ref\":\"" + String(rtRef++) + "\",\"join_ref\":\"1\"}");
}

static void onRt(WStype_t type, uint8_t* payload, size_t len) {
  if (type == WStype_CONNECTED) {
    rtJoin();
    rtLastBeat = millis();
  } else if (type == WStype_DISCONNECTED) {
    if (rtJoined) cloudLog("Supabase 실시간 연결 끊김 — 2초마다 명령 확인으로 바꿈, 다시 연결하는 중");
    rtJoined = false;
  } else if (type == WStype_TEXT) {
    JsonDocument filter;
    filter["event"] = true;
    filter["payload"]["status"] = true;
    filter["payload"]["message"] = true;
    filter["payload"]["response"]["reason"] = true;
    JsonDocument doc;
    if (deserializeJson(doc, (const char*)payload, len, DeserializationOption::Filter(filter))) return;
    const char* ev = doc["event"] | "";
    const char* st = doc["payload"]["status"] | "";
    if (!strcmp(ev, "postgres_changes")) {
      rtWake = true;
    } else if (!strcmp(ev, "system") && !strcmp(st, "ok")) {
      if (!rtJoined) cloudLog("Supabase 실시간 명령 연결됨");
      rtJoined = true;
      rtWake = true;  // 연결 전에 들어온 명령도 바로 확인
    } else if ((!strcmp(ev, "phx_reply") || !strcmp(ev, "system")) && !strcmp(st, "error")) {
      String why = doc["payload"]["response"]["reason"] | (doc["payload"]["message"] | "");
      cloudLog("Supabase 실시간 오류: " + why);
      rtJoined = false;
    } else if (!strcmp(ev, "phx_error") || !strcmp(ev, "phx_close")) {
      rtJoined = false;
      rt.disconnect();  // 다시 연결하면서 다시 가입
    }
  }
}

static void rtStart() {
  String host = SUPABASE_URL;
  host.replace("https://", "");
  host.replace("/", "");
  String path = String("/realtime/v1/websocket?apikey=") + SUPABASE_KEY + "&vsn=1.0.0";
  rt.beginSSL(host.c_str(), 443, path.c_str(), "", "");  // 인증서 확인 없이 (FW-14, 나중에 고정 권장)
  rt.onEvent(onRt);
  rt.setReconnectInterval(5000);
  rt.enableHeartbeat(15000, 5000, 2);  // 응답 없는 연결을 빨리 알아챈다
  rtStarted = true;
}

// Realtime은 따로 돈다: 라이브러리 안의 보안 연결은 응답을 최대 120초 기다려서,
// 같은 작업에 두면 그동안 측정값 올리기까지 멈췄다
static void rtTask(void*) {
  for (;;) {
    if (!wifiUp) {
      rtJoined = false;
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }
    if (!rtStarted) rtStart();
    rt.loop();
    if (rtJoined && millis() - rtLastBeat > 25000) {  // Phoenix 심장박동 (없으면 서버가 끊는다)
      rtLastBeat = millis();
      rtSend(String("{\"topic\":\"phoenix\",\"event\":\"heartbeat\",\"payload\":{},\"ref\":\"") + String(rtRef++) + "\"}");
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ------------------------------------------------------------ 작업 본체 (코어 0)

static void cloudTask(void*) {
  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);         // 절전을 끈다: 일부 공유기에서 몇 분마다 끊기는 원인
  WiFi.setAutoReconnect(true);  // 붙었던 곳이 잠깐 끊기면 스스로 다시 붙는다
  wifiConnect();
  tls.setInsecure();            // FW-14: 처음에는 인증서 확인 없이
  tls.setHandshakeTimeout(10);  // 기본 120초 → 네트워크가 불안할 때 2분씩 멈추지 않게
  http.setReuse(true);
  http.setTimeout(6000);
  http.setConnectTimeout(6000);
  xTaskCreatePinnedToCore(rtTask, "realtime", 12288, nullptr, 1, nullptr, 0);

  bool timeSet = false;
  unsigned long lastTry = millis();
  lastReachAt = millis();
  for (;;) {
    bool up = WiFi.status() == WL_CONNECTED;
    if (up && !wifiUp) {
      wifiUp = true;
      rssiNow = WiFi.RSSI();
      cloudLog("WiFi 연결됨: " + WiFi.SSID() + " · IP " + WiFi.localIP().toString() + " · 세기 " + String(WiFi.RSSI()) + "dBm");
      if (!timeSet) {
        configTzTime("KST-9", "pool.ntp.org", "time.google.com", "kr.pool.ntp.org");  // FW-12 한국 시간
        timeSet = true;
      }
      justConnected = true;
      lastClaim = 0;
      lastReachAt = lastHealAt = millis();  // 붙은 뒤 3분은 기다려 본다
    } else if (!up && wifiUp) {
      wifiUp = false;
      rtJoined = false;
      wifiDrops = wifiDrops + 1;
      lastDropReason = wifiReason;
      tls.stop();
      cloudLog("WiFi 끊김 (" + wifiReasonText(wifiReason) + ") — 다시 연결하는 중 (측정·펌프 안전은 계속 동작)");
      lastTry = millis();
    }

    // 스스로 고치기: WiFi는 붙어 있는데 3분 넘게 Supabase에 못 닿으면 WiFi를 다시 연결,
    // 10분이 넘으면 본 루프에 재시작을 부탁한다 (펌프가 꺼져 있을 때만 재시작한다)
    if (up) {
      unsigned long sinceReach = millis() - lastReachAt;
      if (sinceReach > 600000UL) needRestart = true;
      else if (sinceReach > 180000UL && millis() - lastHealAt > 180000UL) {
        lastHealAt = millis();
        cloudLog("3분 넘게 Supabase에 못 닿았어요 — WiFi를 다시 연결합니다");
        WiFi.disconnect();
        continue;
      }
    }

    if (!up) {
      if (millis() - lastTry > 15000) {  // 15초마다 다시 훑어서 붙는다 (장소를 옮겨도 된다)
        lastTry = millis();
        if (wifiTrying >= 0) cloudLog(String("WiFi ") + wifiList[wifiTrying].ssid + " 연결 실패: " + wifiReasonText(wifiReason));
        wifiConnect();
      }
      // 끊긴 동안에도 줄은 비운다: 측정값은 버리고, 사건·결과는 연결되면 보내려고 남긴다
      CloudOut o;
      while (uxQueueMessagesWaiting(outQ) > 0 && xQueuePeek(outQ, &o, 0) == pdTRUE && o.kind == CK_READING) {
        xQueueReceive(outQ, &o, 0);
        delete o.body;
      }
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }

    if (millis() - lastRssi > 2000) {
      lastRssi = millis();
      rssiNow = WiFi.RSSI();
    }

    CloudOut o;
    if (xQueueReceive(outQ, &o, 0) == pdTRUE) {
      sending = true;
      sendOne(o);
      delete o.body;
      sending = false;
    }

    unsigned long every = rtJoined ? 30000UL : 2000UL;
    if (rtWake || lastClaim == 0 || millis() - lastClaim >= every) {
      rtWake = false;
      lastClaim = millis();
      for (int k = 0; k < 5 && claimOne(); k++) {
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ------------------------------------------------------------ 본 루프에서 쓰는 것

bool cloudReady() {
  return wifiCount > 0 && strncmp(DEVICE_KEY, "여기에", 9) != 0 && strstr(SUPABASE_URL, "xxxxxxxx") == nullptr;
}

void cloudBegin(const String& node) {
  strlcpy(cloudNode, node.c_str(), sizeof cloudNode);
  addWifi(WIFI_SSID, WIFI_PASSWORD);
#ifdef WIFI_SSID2
  addWifi(WIFI_SSID2, WIFI_PASSWORD2);
#endif
#ifdef WIFI_SSID3
  addWifi(WIFI_SSID3, WIFI_PASSWORD3);
#endif
  if (!cloudReady()) {
    serialLine("# secrets.h 를 아직 안 채워서 WiFi·Supabase 없이 시작합니다 (USB로만 동작)");
    return;
  }
  outQ = xQueueCreate(24, sizeof(CloudOut));
  inQ = xQueueCreate(4, sizeof(CloudCmd));
  xTaskCreatePinnedToCore(cloudTask, "cloud", 16384, nullptr, 1, nullptr, 0);
}

// 보낼 것을 줄에 넣는다. 측정값은 WiFi가 없으면 버린다 (FW-09). 줄이 가득 차면 버린다
void cloudPost(CloudKind kind, const String& body) {
  if (!outQ) return;
  if (kind == CK_READING && !wifiUp) return;
  CloudOut o{kind, new String(body)};
  if (xQueueSend(outQ, &o, 0) != pdTRUE) delete o.body;
}

bool cloudNextCommand(CloudCmd& c) { return inQ && xQueueReceive(inQ, &c, 0) == pdTRUE; }

// WiFi에 막 붙었는지 (한 번만 true)
bool cloudTakeJustConnected() {
  if (!justConnected) return false;
  justConnected = false;
  return true;
}

bool cloudWifiUp() { return wifiUp; }
int cloudRssi() { return rssiNow; }

// 원격 진단용 숫자 (info 에 실어 보낸다)
CloudStats cloudStats() { return {wifiDrops, lastDropReason, netFails, rtJoined}; }

// 오래 Supabase에 못 닿아 재시작이 필요한지 (본 루프가 펌프가 꺼져 있을 때 재시작한다)
bool cloudNeedsRestart() { return needRestart; }

// 재시작 전에 남은 것을 보낸다 (최대 ms)
void cloudFlush(unsigned long ms) {
  unsigned long t = millis();
  while (outQ && wifiUp && (uxQueueMessagesWaiting(outQ) > 0 || sending) && millis() - t < ms) delay(20);
}

#else  // USE_CLOUD 0: USB 시리얼로만 동작

void cloudBegin(const String&) {}
void cloudPost(CloudKind, const String&) {}
bool cloudNextCommand(CloudCmd&) { return false; }
bool cloudTakeJustConnected() { return false; }
bool cloudWifiUp() { return false; }
int cloudRssi() { return 0; }
CloudStats cloudStats() { return {0, 0, 0, false}; }
bool cloudNeedsRestart() { return false; }
void cloudFlush(unsigned long) {}

#endif
