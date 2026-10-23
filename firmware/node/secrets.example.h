// 비밀값 예시 — 이 파일을 secrets.h 로 복사해서 채운다. secrets.h 는 GitHub에 올라가지 않는다.
#pragma once

// WiFi (ESP32는 2.4GHz만 된다)
#define WIFI_SSID "와이파이_이름"
#define WIFI_PASSWORD "와이파이_비밀번호"

// Supabase (Project Settings → Data API / API Keys)
#define SUPABASE_URL "https://xxxxxxxx.supabase.co"
#define SUPABASE_KEY "sb_publishable_..."  // 공개 키 (Publishable 또는 anon). secret/service_role 키는 넣지 않는다

// supabase/schema.sql 실행 결과의 device_key (기기만 측정값을 쓸 수 있게 하는 비밀값)
#define DEVICE_KEY "여기에_device_key"
