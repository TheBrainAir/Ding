// Ding table button: mini ESP32 board + 16x2 character LCD, USB serial and Bluetooth LE.
//
// The board is only the button and the display; audio goes through the laptop. The same
// newline-terminated text protocol runs over USB serial and over BLE (Nordic UART Service)
// at the same time, so one firmware works on the cable and on the battery.
//
//   board -> host   PRESS | RELEASE           button edges (debounced, 25 ms)
//                   READY                     after boot, and when a BLE host connects
//   host -> board   STATE:idle|listening|thinking|speaking     LCD line 1
//                   INFO:<text>               LCD line 2 (ASCII, up to 60 chars; longer than
//                                             16 scrolls as a marquee)
//
// Unknown lines are ignored. See docs/HARDWARE.md for wiring, flashing and troubleshooting.
// Needs: the "esp32" board package (Espressif) and the "LiquidCrystal" library.

#include <Arduino.h>
#include <LiquidCrystal.h>

// ------------------------------------------------------------------ pins
// Pins are named by the board's silkscreen labels (D0..D8). If your board package does not
// define D0..D8 ("'D0' was not declared in this scope"), set DING_USE_RAW_GPIO to 1 and put
// the GPIO numbers from your board's pinout below. Example, Seeed XIAO ESP32-C3:
// D0=2 D1=3 D2=4 D3=5 D4=6 D5=7 D7=20 D8=8. Seeed XIAO ESP32-S3: D0=1 D1=2 D2=3 D3=4 D4=5 D5=6 D7=44 D8=7.
// Seeed XIAO ESP32-C6 (the demo box): D0=0 D1=1 D2=2 D3=21 D4=22 D5=23 D7=17 D8=19.
#ifndef DING_USE_RAW_GPIO
#define DING_USE_RAW_GPIO 0
#endif

#if DING_USE_RAW_GPIO
const uint8_t PIN_LCD_RS = 2;
const uint8_t PIN_LCD_E = 3;
const uint8_t PIN_LCD_D4 = 4;
const uint8_t PIN_LCD_D5 = 5;
const uint8_t PIN_LCD_D6 = 6;
const uint8_t PIN_LCD_D7 = 7;
const uint8_t PIN_BUTTON = 8;
const uint8_t PIN_BUTTON_ALT = 20;
#else
const uint8_t PIN_LCD_RS = D0;
const uint8_t PIN_LCD_E = D1;
const uint8_t PIN_LCD_D4 = D2;
const uint8_t PIN_LCD_D5 = D3;
const uint8_t PIN_LCD_D6 = D4;
const uint8_t PIN_LCD_D7 = D5;
const uint8_t PIN_BUTTON = D8;      // to GND, internal pull-up (measured on the demo box)
const uint8_t PIN_BUTTON_ALT = D7;  // also read, so the button works on either pin
#endif

// ------------------------------------------------------------------ Bluetooth
// BLE is compiled in when the chip has it (ESP32, -C3, -S3, -C6, -H2; not -S2). Set
// DING_ENABLE_BLE to 0 to build a USB-only firmware anyway.
#if __has_include("soc/soc_caps.h")
#include "soc/soc_caps.h"
#endif
#ifndef DING_ENABLE_BLE
#if defined(SOC_BLE_SUPPORTED) && SOC_BLE_SUPPORTED
#define DING_ENABLE_BLE 1
#else
#define DING_ENABLE_BLE 0
#endif
#endif

#if DING_ENABLE_BLE
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#if defined(CONFIG_BLUEDROID_ENABLED)
#include <BLE2902.h>  // NimBLE (the default on -C3/-S3 in core 3.x) adds this descriptor itself
#endif

// Nordic UART Service: the host writes to RX, the board notifies on TX.
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_TX_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
#endif

const unsigned long BAUD = 115200;
const unsigned long DEBOUNCE_MS = 25;
const unsigned long BLE_READY_DELAY_MS = 1200;  // give the host time to subscribe first
const unsigned long BLE_READVERTISE_MS = 300;
const unsigned long THINKING_FRAME_MS = 400;

// Line 2 marquee for INFO text longer than the display: hold at the start, shift one character
// per step, hold at the end, start over. One pass of an N-character text takes
// MARQUEE_HOLD_START_MS + (N - 16) * MARQUEE_STEP_MS + MARQUEE_HOLD_END_MS.
// The guest screen uses the same numbers to decide how long to show each line
// (web/src/lib/voice/buttonLink.ts: MARQUEE_HOLD_START_MS, MARQUEE_STEP_MS, MARQUEE_HOLD_END_MS).
const unsigned long MARQUEE_HOLD_START_MS = 1200;
const unsigned long MARQUEE_STEP_MS = 280;
const unsigned long MARQUEE_HOLD_END_MS = 1200;

const uint8_t LCD_COLS = 16;
const uint8_t INFO_MAX = 60;  // longest INFO text kept; the rest is dropped
LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_E, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);

enum State { IDLE, LISTENING, THINKING, SPEAKING };
enum Source { SRC_NONE, SRC_USB, SRC_BLE };

State state = IDLE;
bool hostSeen = false;            // a STATE line arrived since boot / since the BLE host left
Source stateSource = SRC_NONE;
char deviceName[16] = "Ding";
char infoText[INFO_MAX + 1] = "";  // LCD line 2 (scrolls when longer than LCD_COLS)
uint8_t infoLen = 0;
unsigned long infoSince = 0;       // when the current INFO arrived: the marquee starts there
char shown[2][LCD_COLS + 1];       // what the LCD shows now, to redraw only changes

bool stablePressed = false;
bool lastReading = false;
unsigned long lastChangeMs = 0;

// ------------------------------------------------------------------ line parsing

struct LineBuffer {
  char buf[96];  // "INFO:" + 60 characters fits with room to spare
  uint8_t len = 0;
  bool overflow = false;
};
LineBuffer usbLine;

void handleLine(const char *line, Source source);

void feed(LineBuffer &lb, char c, Source source) {
  if (c == '\r') return;
  if (c == '\n') {
    if (!lb.overflow) {
      lb.buf[lb.len] = '\0';
      handleLine(lb.buf, source);
    }
    lb.len = 0;
    lb.overflow = false;
    return;
  }
  if (lb.len < sizeof(lb.buf) - 1) {
    lb.buf[lb.len++] = c;
  } else {
    lb.overflow = true;  // drop the whole overlong line
  }
}

// ASCII only: the LCD's character ROM has no Cyrillic or Armenian. Each UTF-8 character
// that is not plain ASCII becomes a single '?'. Every new INFO restarts the marquee.
void setInfo(const char *text) {
  uint8_t n = 0;
  for (const unsigned char *p = (const unsigned char *)text; *p && n < INFO_MAX; p++) {
    unsigned char c = *p;
    if (c >= 0x80 && c < 0xC0) continue;  // UTF-8 continuation byte
    infoText[n++] = (c >= 0x20 && c < 0x7F) ? (char)c : '?';
  }
  while (n > 0 && infoText[n - 1] == ' ') n--;  // trailing spaces would only add scroll steps
  infoText[n] = '\0';
  infoLen = n;
  infoSince = millis();
}

// Which character of a long INFO text is in the first column right now.
uint8_t marqueeOffset(unsigned long now) {
  if (infoLen <= LCD_COLS || (long)(now - infoSince) < 0) return 0;  // INFO newer than `now`
  const unsigned long steps = infoLen - LCD_COLS;
  const unsigned long pass = MARQUEE_HOLD_START_MS + steps * MARQUEE_STEP_MS + MARQUEE_HOLD_END_MS;
  const unsigned long t = (now - infoSince) % pass;
  if (t < MARQUEE_HOLD_START_MS) return 0;
  const unsigned long shifted = 1 + (t - MARQUEE_HOLD_START_MS) / MARQUEE_STEP_MS;
  return (uint8_t)(shifted < steps ? shifted : steps);  // then hold at the end
}

// ------------------------------------------------------------------ output to the host

#if DING_ENABLE_BLE
BLEServer *bleServer = nullptr;
BLECharacteristic *bleTx = nullptr;
volatile bool bleConnected = false;
volatile bool bleConnectEvent = false;
volatile bool bleDisconnectEvent = false;
QueueHandle_t bleRx = nullptr;  // bytes written by the host, filled in the BLE task
LineBuffer bleLine;
unsigned long bleReadyAt = 0;
unsigned long bleReadvertiseAt = 0;
#endif

void sendLine(const char *text, bool usb, bool ble) {
  if (usb) {
    Serial.print(text);
    Serial.print('\n');
  }
#if DING_ENABLE_BLE
  if (ble && bleConnected && bleTx != nullptr) {
    char out[24];
    int n = snprintf(out, sizeof(out), "%s\n", text);
    bleTx->setValue((uint8_t *)out, (size_t)n);
    bleTx->notify();
  }
#else
  (void)ble;
#endif
}

void broadcast(const char *text) { sendLine(text, true, true); }

// ------------------------------------------------------------------ protocol

void handleLine(const char *line, Source source) {
  if (strncmp(line, "STATE:", 6) == 0) {
    const char *name = line + 6;
    if (strcmp(name, "idle") == 0) state = IDLE;
    else if (strcmp(name, "listening") == 0) state = LISTENING;
    else if (strcmp(name, "thinking") == 0) state = THINKING;
    else if (strcmp(name, "speaking") == 0) state = SPEAKING;
    else return;
    hostSeen = true;
    stateSource = source;
  } else if (strncmp(line, "INFO:", 5) == 0) {
    setInfo(line + 5);
  }
}

// ------------------------------------------------------------------ Bluetooth LE

#if DING_ENABLE_BLE
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    bleConnected = true;
    bleConnectEvent = true;
  }
  void onDisconnect(BLEServer *) override {
    bleConnected = false;
    bleDisconnectEvent = true;
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String value = characteristic->getValue();
    for (size_t i = 0; i < value.length(); i++) {
      char c = value[i];
      xQueueSend(bleRx, &c, 0);  // runs in the BLE task: hand bytes to loop()
    }
  }
};

void setupBle() {
  uint64_t mac = ESP.getEfuseMac();
  snprintf(deviceName, sizeof(deviceName), "Ding-%02X%02X", (unsigned)((mac >> 32) & 0xFF),
           (unsigned)((mac >> 40) & 0xFF));
  bleRx = xQueueCreate(256, sizeof(char));

  BLEDevice::init(deviceName);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());
  BLEService *service = bleServer->createService(NUS_SERVICE_UUID);
  bleTx = service->createCharacteristic(NUS_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  bleTx->addDescriptor(new BLE2902());
#endif
  BLECharacteristic *rx = service->createCharacteristic(
      NUS_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(NUS_SERVICE_UUID);
  advertising->setScanResponse(true);  // the name goes in the scan response
  BLEDevice::startAdvertising();
}

void pollBle(unsigned long now) {
  char c;
  while (xQueueReceive(bleRx, &c, 0) == pdTRUE) feed(bleLine, c, SRC_BLE);

  if (bleConnectEvent) {
    bleConnectEvent = false;
    BLEDevice::stopAdvertising();  // one host at a time; advertising restarts when it leaves
    bleLine.len = 0;
    bleReadyAt = now + BLE_READY_DELAY_MS;
    setInfo("BT connected");
  }
  if (bleReadyAt != 0 && (long)(now - bleReadyAt) >= 0) {
    bleReadyAt = 0;
    sendLine("READY", false, true);  // the host answers with its current STATE / INFO
  }
  if (bleDisconnectEvent) {
    bleDisconnectEvent = false;
    bleReadyAt = 0;
    bleReadvertiseAt = now + BLE_READVERTISE_MS;
    setInfo("BT link lost");
    if (stateSource == SRC_BLE) {
      hostSeen = false;  // the state on screen came from the host that just left
      state = IDLE;
    }
  }
  if (bleReadvertiseAt != 0 && (long)(now - bleReadvertiseAt) >= 0) {
    bleReadvertiseAt = 0;
    BLEDevice::startAdvertising();
  }
}
#endif

// ------------------------------------------------------------------ display

void drawLine(uint8_t row, const char *text) {
  char want[LCD_COLS + 1];
  snprintf(want, sizeof(want), "%-16s", text);
  for (uint8_t col = 0; col < LCD_COLS; col++) {
    if (shown[row][col] == want[col]) continue;
    uint8_t end = col;  // redraw the changed run in one go
    while (end < LCD_COLS && shown[row][end] != want[end]) end++;
    lcd.setCursor(col, row);
    for (uint8_t i = col; i < end; i++) {
      lcd.write((uint8_t)want[i]);
      shown[row][i] = want[i];
    }
    col = end;
  }
}

void render(unsigned long now) {
  char line1[LCD_COLS + 1];
  if (!hostSeen) {
    strcpy(line1, "Waiting for host");
  } else {
    switch (state) {
      case LISTENING:
        strcpy(line1, "Listening...");
        break;
      case THINKING: {
        static const char *frames[] = {"Thinking", "Thinking.", "Thinking..", "Thinking..."};
        strcpy(line1, frames[(now / THINKING_FRAME_MS) % 4]);
        break;
      }
      case SPEAKING:
        strcpy(line1, "Speaking...");
        break;
      case IDLE:
      default:
        strcpy(line1, "Hold to talk");
        break;
    }
  }
  drawLine(0, line1);
  if (infoLen == 0) {
    drawLine(1, deviceName);
  } else {
    char window[LCD_COLS + 1];
    strncpy(window, infoText + marqueeOffset(now), LCD_COLS);
    window[LCD_COLS] = '\0';
    drawLine(1, window);
  }
}

// ------------------------------------------------------------------ button

void pollButton(unsigned long now) {
  // pressed pulls the pin to GND
  bool reading = digitalRead(PIN_BUTTON) == LOW || digitalRead(PIN_BUTTON_ALT) == LOW;
  if (reading != lastReading) {
    lastReading = reading;
    lastChangeMs = now;
  }
  if (reading != stablePressed && now - lastChangeMs >= DEBOUNCE_MS) {
    stablePressed = reading;
    broadcast(stablePressed ? "PRESS" : "RELEASE");
  }
}

// ------------------------------------------------------------------ main

void setup() {
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUTTON_ALT, INPUT_PULLUP);
  Serial.begin(BAUD);
#if ARDUINO_USB_CDC_ON_BOOT
  // Native USB: never stall loop() writing to a cable that is not there (battery mode).
  Serial.setTxTimeoutMs(0);
#endif

  lcd.begin(LCD_COLS, 2);
  lcd.clear();
  memset(shown, ' ', sizeof(shown));
  shown[0][LCD_COLS] = shown[1][LCD_COLS] = '\0';

#if DING_ENABLE_BLE
  setupBle();
#endif
  render(millis());
  broadcast("READY");
}

void loop() {
  unsigned long now = millis();
  pollButton(now);
  while (Serial.available() > 0) feed(usbLine, (char)Serial.read(), SRC_USB);
#if DING_ENABLE_BLE
  pollBle(now);
#endif
  render(now);
}
