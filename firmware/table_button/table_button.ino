// Ding table button: reference sketch for Arduino Uno R3.
//
// LEGACY: the current box is firmware/table_button_esp32 (ESP32 + LCD, USB + Bluetooth).
// This sketch speaks the same protocol and simply ignores INFO: lines.
//
// The board is only the button and the light. Sound goes through the laptop the
// board is plugged into: the browser on the table screen talks to the board over
// Web Serial (USB, 115200 baud, newline-terminated lines).
//
//   board -> browser   PRESS        button went down
//                      RELEASE      button went up
//                      READY        sent once after reset
//   browser -> board   STATE:idle | STATE:listening | STATE:thinking | STATE:speaking
//
// Wiring
//   D2  - momentary push button to GND (internal pull-up, no resistor needed)
//   D9  - LED anode through a 220 ohm resistor, LED cathode to GND (PWM pin)
//   D13 - on-board LED mirrors "listening" (handy when no LED is wired yet)
//
// The browser decides what a press means (hold to talk, or tap to start/stop);
// the board just reports edges, debounced.

const uint8_t BUTTON_PIN = 2;
const uint8_t LED_PIN = 9;
const uint8_t BOARD_LED_PIN = 13;

const unsigned long DEBOUNCE_MS = 25;
const unsigned long BAUD = 115200;

enum State { IDLE, LISTENING, THINKING, SPEAKING };
State state = IDLE;

bool stablePressed = false;
bool lastReading = false;
unsigned long lastChangeMs = 0;

char lineBuf[32];
uint8_t lineLen = 0;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BOARD_LED_PIN, OUTPUT);
  Serial.begin(BAUD);
  Serial.println("READY");
}

void loop() {
  readButton();
  readSerial();
  renderLight(millis());
}

// ---------------------------------------------------------------- button

void readButton() {
  bool reading = digitalRead(BUTTON_PIN) == LOW;  // pressed pulls the pin to GND
  unsigned long now = millis();
  if (reading != lastReading) {
    lastReading = reading;
    lastChangeMs = now;
  }
  if (reading != stablePressed && now - lastChangeMs >= DEBOUNCE_MS) {
    stablePressed = reading;
    Serial.println(stablePressed ? "PRESS" : "RELEASE");
  }
}

// ---------------------------------------------------------------- serial

void readSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      lineBuf[lineLen] = '\0';
      handleLine(lineBuf);
      lineLen = 0;
    } else if (lineLen < sizeof(lineBuf) - 1) {
      lineBuf[lineLen++] = c;
    } else {
      lineLen = 0;  // overlong garbage: drop it
    }
  }
}

void handleLine(const char *line) {
  if (strncmp(line, "STATE:", 6) != 0) return;
  const char *name = line + 6;
  if (strcmp(name, "idle") == 0) state = IDLE;
  else if (strcmp(name, "listening") == 0) state = LISTENING;
  else if (strcmp(name, "thinking") == 0) state = THINKING;
  else if (strcmp(name, "speaking") == 0) state = SPEAKING;
}

// ---------------------------------------------------------------- light

// Triangle wave 0..255 with the given period.
uint8_t wave(unsigned long now, unsigned long periodMs) {
  unsigned long t = now % periodMs;
  unsigned long half = periodMs / 2;
  unsigned long v = t < half ? t : periodMs - t;
  return (uint8_t)(v * 255UL / half);
}

void renderLight(unsigned long now) {
  uint8_t level;
  switch (state) {
    case LISTENING:  // solid: "I'm all ears"
      level = 255;
      break;
    case THINKING:   // quick pulse
      level = wave(now, 500);
      break;
    case SPEAKING:   // medium pulse, never fully dark
      level = 60 + wave(now, 900) * 195UL / 255UL;
      break;
    case IDLE:
    default:         // slow, dim breathing
      level = wave(now, 3000) / 6;
      break;
  }
  analogWrite(LED_PIN, level);
  digitalWrite(BOARD_LED_PIN, state == LISTENING ? HIGH : LOW);
}
