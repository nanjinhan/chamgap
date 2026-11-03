// 비밀값 예시 — 이 파일을 secrets.h 로 복사해서 채운다. secrets.h 는 GitHub에 올라가지 않는다.
#pragma once

// WiFi (ESP32는 2.4GHz만 된다). 켜질 때 아래 중 지금 보이는 가장 센 곳에 붙는다
// ① 첫 번째 장소 (예: 학교)
#define WIFI_SSID "와이파이_이름"
#define WIFI_PASSWORD "와이파이_비밀번호"
// ② 두 번째 장소 (예: 집). 안 쓰면 그대로 둔다
#define WIFI_SSID2 "두번째_와이파이_이름"
#define WIFI_PASSWORD2 "두번째_와이파이_비밀번호"
// ③ 한 곳 더 (필요할 때만)
#define WIFI_SSID3 ""
#define WIFI_PASSWORD3 ""

// Supabase (Project Settings → Data API / API Keys)
#define SUPABASE_URL "https://xxxxxxxx.supabase.co"
#define SUPABASE_KEY "sb_publishable_..."  // 공개 키 (Publishable 또는 anon). secret/service_role 키는 넣지 않는다

// supabase/schema.sql 실행 결과의 device_key (기기만 측정값을 쓸 수 있게 하는 비밀값)
#define DEVICE_KEY "여기에_device_key"
