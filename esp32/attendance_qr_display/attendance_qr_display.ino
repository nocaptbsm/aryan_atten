/*
 * ============================================================
 * Attendance System — ESP32 QR Code Display
 * Hardware: ESP32 DevKit V1 + ST7789 240x320 TFT
 * ============================================================
 *
 * WIRING (ESP32 DevKit V1 → ST7789):
 *   VCC  → 3.3V
 *   GND  → GND
 *   SCL  → GPIO 18  (SPI CLK)
 *   SDA  → GPIO 23  (SPI MOSI)
 *   RES  → GPIO 4   (Reset)
 *   DC   → GPIO 2   (Data/Command)
 *   CS   → GPIO 15  (Chip Select)
 *   BLK  → 3.3V     (Backlight, always on)
 *
 * REQUIRED LIBRARIES (install via Arduino Library Manager):
 *   1. TFT_eSPI       by Bodmer
 *   2. ArduinoJson     by Benoit Blanchon (v7+)
 *   3. QRCode          by Richard Moore (ricmoo)
 *
 * IMPORTANT — TFT_eSPI SETUP:
 *   After installing TFT_eSPI, you MUST edit the config file:
 *   Arduino/libraries/TFT_eSPI/User_Setup.h
 *   See the "TFT_eSPI Configuration" section at the bottom
 *   of this file for exact settings.
 *
 * ============================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <qrcode.h>

// ============================================================
// CONFIGURATION — EDIT THESE VALUES
// ============================================================

// WiFi credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Backend URL (your Render deployment)
const char* API_BASE_URL  = "https://aryan-atten.onrender.com";

// How often to refresh the QR code (milliseconds)
const unsigned long QR_REFRESH_INTERVAL = 15000;  // 15 seconds

// Display dimensions
const int SCREEN_WIDTH  = 240;
const int SCREEN_HEIGHT = 320;

// QR code display settings
const int QR_VERSION       = 14;     // Handles URLs up to ~367 chars
const int QR_ERROR_CORRECT = 0;      // ECC_LOW = max data capacity
const int QR_TOP_MARGIN    = 50;     // Pixels from top for QR

// Colors (RGB565)
const uint16_t COLOR_BG         = 0x0000;  // Black
const uint16_t COLOR_QR_FG      = 0xFFFF;  // White (QR modules)
const uint16_t COLOR_QR_BG      = 0xFFFF;  // White (QR background)
const uint16_t COLOR_QR_MODULE  = 0x0000;  // Black (QR dark modules)
const uint16_t COLOR_TITLE      = 0x07FF;  // Cyan
const uint16_t COLOR_STATUS     = 0x07E0;  // Green
const uint16_t COLOR_COUNTDOWN  = 0xFBE0;  // Amber
const uint16_t COLOR_ERROR      = 0xF800;  // Red
const uint16_t COLOR_SUBTLE     = 0x7BEF;  // Gray

// ============================================================
// GLOBALS
// ============================================================

TFT_eSPI tft = TFT_eSPI();

unsigned long lastRefreshTime   = 0;
unsigned long tokenFetchedAt    = 0;
int lastCountdown               = -1;
bool hasValidQR                 = false;
String currentQrUrl             = "";

// Retry backoff for cold starts
int retryCount                  = 0;
const int MAX_RETRIES           = 5;
const int RETRY_DELAYS[]        = {1000, 2000, 4000, 8000, 15000};

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Attendance QR Display ===");

  // Initialize display
  tft.init();
  tft.setRotation(0);  // Portrait: 240 wide x 320 tall
  tft.fillScreen(COLOR_BG);

  // Show startup screen
  drawStartupScreen();

  // Connect to WiFi
  connectToWiFi();

  // Fetch first QR code
  fetchAndDisplayQR();
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {
  unsigned long now = millis();

  // Refresh QR code every QR_REFRESH_INTERVAL
  if (now - lastRefreshTime >= QR_REFRESH_INTERVAL) {
    fetchAndDisplayQR();
  }

  // Update countdown timer every second (without redrawing QR)
  if (hasValidQR) {
    int elapsed = (now - tokenFetchedAt) / 1000;
    int remaining = (QR_REFRESH_INTERVAL / 1000) - elapsed;
    if (remaining < 0) remaining = 0;

    if (remaining != lastCountdown) {
      lastCountdown = remaining;
      drawCountdown(remaining);
    }
  }

  delay(100);  // Small delay to avoid busy-looping
}

// ============================================================
// WIFI
// ============================================================

void connectToWiFi() {
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_TITLE, COLOR_BG);
  tft.setTextDatum(TC_DATUM);
  tft.setTextSize(2);
  tft.drawString("Connecting...", SCREEN_WIDTH / 2, 120);

  tft.setTextColor(COLOR_SUBTLE, COLOR_BG);
  tft.setTextSize(1);
  tft.drawString(WIFI_SSID, SCREEN_WIDTH / 2, 155);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    attempts++;

    // Show progress dots
    int dotX = 60 + (attempts % 12) * 10;
    tft.fillCircle(dotX, 190, 3, COLOR_TITLE);

    if (attempts > 40) {  // 20 second timeout
      Serial.println("\nWiFi connection failed!");
      drawErrorScreen("WiFi Failed", "Check credentials", "and restart");
      delay(5000);
      ESP.restart();
    }
  }

  Serial.println("\nWiFi connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  // Brief success flash
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_STATUS, COLOR_BG);
  tft.setTextDatum(TC_DATUM);
  tft.setTextSize(2);
  tft.drawString("WiFi Connected!", SCREEN_WIDTH / 2, 140);
  tft.setTextColor(COLOR_SUBTLE, COLOR_BG);
  tft.setTextSize(1);
  tft.drawString(WiFi.localIP().toString(), SCREEN_WIDTH / 2, 170);
  delay(1500);
}

// ============================================================
// FETCH TOKEN & DISPLAY QR
// ============================================================

void fetchAndDisplayQR() {
  // Check WiFi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, reconnecting...");
    drawStatusBar("Reconnecting WiFi...", COLOR_ERROR);
    connectToWiFi();
  }

  Serial.println("Fetching session token...");

  if (hasValidQR) {
    // Just update the status bar, don't clear the whole screen
    drawStatusBar("Refreshing...", COLOR_COUNTDOWN);
  } else {
    tft.fillScreen(COLOR_BG);
    drawHeader();
    drawStatusBar("Fetching QR code...", COLOR_COUNTDOWN);
  }

  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/session/token";
  http.begin(url);
  http.setTimeout(10000);  // 10 second timeout

  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    http.end();

    // Parse JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
      Serial.print("JSON parse error: ");
      Serial.println(error.c_str());
      handleFetchError("JSON Parse Error");
      return;
    }

    const char* qrUrl = doc["qrUrl"];
    if (!qrUrl) {
      handleFetchError("No QR URL");
      return;
    }

    currentQrUrl = String(qrUrl);
    Serial.print("QR URL: ");
    Serial.println(currentQrUrl);

    // Success — reset retry counter
    retryCount = 0;
    lastRefreshTime = millis();
    tokenFetchedAt = millis();
    hasValidQR = true;

    // Draw the full QR screen
    tft.fillScreen(COLOR_BG);
    drawHeader();
    drawQRCode(currentQrUrl);
    drawStatusBar("Scan to mark attendance", COLOR_STATUS);
    lastCountdown = -1;  // Force countdown redraw

  } else {
    http.end();
    String errMsg = "HTTP " + String(httpCode);
    Serial.print("Fetch error: ");
    Serial.println(errMsg);
    handleFetchError(errMsg);
  }
}

void handleFetchError(String reason) {
  Serial.print("Error: ");
  Serial.println(reason);

  if (retryCount < MAX_RETRIES) {
    int delayMs = RETRY_DELAYS[retryCount];
    retryCount++;

    String msg = "Retry " + String(retryCount) + "/" + String(MAX_RETRIES) + "...";
    drawStatusBar(msg, COLOR_ERROR);

    // If this looks like a cold start (first attempt, server returned error)
    if (retryCount == 1) {
      drawColdStartMessage();
    }

    Serial.print("Retrying in ");
    Serial.print(delayMs);
    Serial.println("ms");

    delay(delayMs);
    fetchAndDisplayQR();  // Recursive retry
  } else {
    // Max retries exhausted
    retryCount = 0;
    hasValidQR = false;
    drawErrorScreen("Server Unreachable", reason, "Will retry in 15s");
    lastRefreshTime = millis();  // Will retry on next interval
  }
}

// ============================================================
// QR CODE RENDERING
// ============================================================

void drawQRCode(String data) {
  // Create QR code
  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(QR_VERSION)];

  int result = qrcode_initText(&qrcode, qrcodeData, QR_VERSION,
                                QR_ERROR_CORRECT, data.c_str());

  if (result != 0) {
    Serial.println("QR generation failed!");
    drawStatusBar("QR generation failed", COLOR_ERROR);
    return;
  }

  int moduleCount = qrcode.size;
  Serial.print("QR modules: ");
  Serial.println(moduleCount);

  // Calculate pixel size to fit the display width with padding
  int maxQRWidth = SCREEN_WIDTH - 20;  // 10px padding each side
  int pixelSize = maxQRWidth / moduleCount;
  if (pixelSize < 2) pixelSize = 2;

  int qrPixelWidth = moduleCount * pixelSize;
  int qrPixelHeight = moduleCount * pixelSize;

  // Center the QR code
  int offsetX = (SCREEN_WIDTH - qrPixelWidth) / 2;
  int offsetY = QR_TOP_MARGIN + ((SCREEN_HEIGHT - QR_TOP_MARGIN - 60 - qrPixelHeight) / 2);

  // Draw white background (quiet zone)
  int padding = pixelSize * 2;
  tft.fillRect(offsetX - padding, offsetY - padding,
               qrPixelWidth + padding * 2, qrPixelHeight + padding * 2,
               COLOR_QR_BG);

  // Draw QR modules
  for (int y = 0; y < moduleCount; y++) {
    for (int x = 0; x < moduleCount; x++) {
      if (qrcode_getModule(&qrcode, x, y)) {
        tft.fillRect(offsetX + x * pixelSize,
                     offsetY + y * pixelSize,
                     pixelSize, pixelSize,
                     COLOR_QR_MODULE);
      }
    }
  }

  Serial.println("QR code rendered.");
}

// ============================================================
// UI DRAWING HELPERS
// ============================================================

void drawStartupScreen() {
  tft.fillScreen(COLOR_BG);
  tft.setTextDatum(TC_DATUM);

  tft.setTextColor(COLOR_TITLE, COLOR_BG);
  tft.setTextSize(2);
  tft.drawString("ATTENDANCE", SCREEN_WIDTH / 2, 100);
  tft.drawString("SYSTEM", SCREEN_WIDTH / 2, 125);

  tft.setTextColor(COLOR_SUBTLE, COLOR_BG);
  tft.setTextSize(1);
  tft.drawString("QR Code Display v1.0", SCREEN_WIDTH / 2, 170);
  tft.drawString("ESP32 + ST7789", SCREEN_WIDTH / 2, 190);

  delay(2000);
}

void drawHeader() {
  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(COLOR_TITLE, COLOR_BG);
  tft.setTextSize(2);
  tft.drawString("SCAN TO MARK", SCREEN_WIDTH / 2, 10);

  // Thin separator line
  tft.drawLine(20, 35, SCREEN_WIDTH - 20, 35, COLOR_SUBTLE);
}

void drawStatusBar(String message, uint16_t color) {
  // Clear status area at the bottom
  int statusY = SCREEN_HEIGHT - 50;
  tft.fillRect(0, statusY, SCREEN_WIDTH, 50, COLOR_BG);

  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(color, COLOR_BG);
  tft.setTextSize(1);
  tft.drawString(message, SCREEN_WIDTH / 2, statusY + 8);
}

void drawCountdown(int seconds) {
  // Draw countdown at the very bottom without clearing the QR
  int countdownY = SCREEN_HEIGHT - 22;
  tft.fillRect(0, countdownY, SCREEN_WIDTH, 22, COLOR_BG);

  tft.setTextDatum(TC_DATUM);

  if (seconds <= 3) {
    tft.setTextColor(COLOR_ERROR, COLOR_BG);
  } else {
    tft.setTextColor(COLOR_COUNTDOWN, COLOR_BG);
  }

  tft.setTextSize(1);
  String countdownText = "Refreshing in " + String(seconds) + "s";
  tft.drawString(countdownText, SCREEN_WIDTH / 2, countdownY + 4);
}

void drawColdStartMessage() {
  // Show a friendly message when the server is likely cold-starting
  tft.fillScreen(COLOR_BG);
  drawHeader();

  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(COLOR_COUNTDOWN, COLOR_BG);
  tft.setTextSize(2);
  tft.drawString("Warming up", SCREEN_WIDTH / 2, 120);
  tft.drawString("server...", SCREEN_WIDTH / 2, 145);

  tft.setTextColor(COLOR_SUBTLE, COLOR_BG);
  tft.setTextSize(1);
  tft.drawString("Free tier servers sleep", SCREEN_WIDTH / 2, 190);
  tft.drawString("when idle. Please wait.", SCREEN_WIDTH / 2, 210);
}

void drawErrorScreen(String title, String line1, String line2) {
  tft.fillScreen(COLOR_BG);
  drawHeader();

  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(COLOR_ERROR, COLOR_BG);
  tft.setTextSize(2);
  tft.drawString(title, SCREEN_WIDTH / 2, 120);

  tft.setTextColor(COLOR_SUBTLE, COLOR_BG);
  tft.setTextSize(1);
  tft.drawString(line1, SCREEN_WIDTH / 2, 165);
  tft.drawString(line2, SCREEN_WIDTH / 2, 185);
}

// ============================================================
// END OF CODE
// ============================================================

/*
 * ============================================================
 * TFT_eSPI CONFIGURATION
 * ============================================================
 *
 * After installing the TFT_eSPI library, you MUST edit:
 *   Arduino/libraries/TFT_eSPI/User_Setup.h
 *
 * Comment out ALL existing driver definitions, then add/uncomment:
 *
 *   #define ST7789_DRIVER
 *   #define TFT_WIDTH  240
 *   #define TFT_HEIGHT 320
 *
 *   #define TFT_MOSI   23
 *   #define TFT_SCLK   18
 *   #define TFT_CS     15
 *   #define TFT_DC      2
 *   #define TFT_RST     4
 *
 *   #define SPI_FREQUENCY  40000000
 *   #define SPI_READ_FREQUENCY  20000000
 *   #define SPI_TOUCH_FREQUENCY  2500000
 *
 * WIRING DIAGRAM:
 *
 *   ST7789 Pin    ESP32 Pin
 *   ─────────────────────────
 *   VCC        →  3.3V
 *   GND        →  GND
 *   SCL (SCK)  →  GPIO 18
 *   SDA (MOSI) →  GPIO 23
 *   RES (RST)  →  GPIO 4
 *   DC         →  GPIO 2
 *   CS         →  GPIO 15
 *   BLK        →  3.3V (always on)
 *
 * ============================================================
 */
