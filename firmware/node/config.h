// 참값 노드 펌웨어 설정 — 보드마다 여기만 고친다
#pragma once

// ===== 구역 이름 (처음 올릴 때 기본값. 나중에 시리얼로 "id z2" 명령으로도 바꿀 수 있음) =====
#define DEFAULT_NODE_ID "Z1"

// ===== 지금 꽂은 센서 (있으면 1, 없으면 0) =====
// 온습도 A: SHT31 납땜 전이라 임시로 DHT11을 쓴다
#define USE_DHT11_A 1
#define DHT_PIN 4  // ← DHT11 데이터(DATA/S) 선을 꽂은 GPIO 번호로 바꾸세요

// 나중에 SHT31을 납땜하면: USE_DHT11_A 0, USE_SHT31_A 1 (라이브러리 "Adafruit SHT31" 설치 필요)
#define USE_SHT31_A 0  // I2C SDA 21, SCL 22, 주소 0x44
#define USE_SHT31_B 0  // 같은 선, 주소 0x45 (ADR 핀을 VIN에)

// 토양수분 SEN0193 (ADC1 핀만: 32~39)
#define USE_SOIL_A 1
#define SOIL_A_PIN 32
#define USE_SOIL_B 1
#define SOIL_B_PIN 33

// 로드셀 + HX711
#define USE_HX711 1
#define HX_DOUT_PIN 26
#define HX_SCK_PIN 27

// 펌프 (DFR0457). 펌프를 안 달았어도 GPIO25가 켜졌다 꺼질 뿐 안전하다
#define USE_PUMP 1
#define PUMP_PIN 25

// 12V 감지(분압 47k/10k)와 누수 센서 — 아직 안 달았으면 0
#define USE_V12_SENSE 0
#define V12_PIN 34
#define USE_LEAK 0
#define LEAK_PIN 35

// ===== 안전 (요구사항지시서 v2.0 7장) =====
#define PUMP_MS_MIN 50
#define PUMP_MS_MAX 15000     // 한 번 최대 15초, 지나면 스스로 끈다
#define PUMP_COOLDOWN_MS 3000  // 꺼진 뒤 3초는 다시 안 켠다
#define MAX_ML_PER_SHOT 50
#define MAX_ML_PER_DAY 300
#define V12_MIN_VOLT 9.0

// ===== 측정 =====
#define DEFAULT_SAMPLE_MS 5000  // 측정값 보내는 주기
#define SOIL_DEFAULT_AIR_MV 2500  // 토양 보정 전 기본값 (공기 중)
#define SOIL_DEFAULT_WET_MV 1200  // (물 속)
