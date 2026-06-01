/*
 * QR Code Generator — Self-contained, no external library needed.
 * Supports QR versions 1–20, all 4 ECC levels, byte-mode encoding.
 * Drop this file + qrcode_gen.cpp into your Arduino sketch folder.
 *
 * API is compatible with ricmoo/qrcode so existing code needs
 * only an #include swap.
 */

#ifndef QRCODE_GEN_H
#define QRCODE_GEN_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Error-correction levels */
#define ECC_LOW      0
#define ECC_MEDIUM   1
#define ECC_QUARTILE 2
#define ECC_HIGH     3

/* QR code handle – populated by qrcode_initText */
typedef struct {
    uint8_t  version;   /* 1-20                        */
    uint8_t  size;      /* modules per side = 4V + 17  */
    uint8_t  ecc;       /* ECC_LOW … ECC_HIGH          */
    uint8_t *modules;   /* bit-packed module bitmap     */
} QRCode;

/*
 * Returns the minimum buffer size (bytes) needed for the given version.
 * Caller must allocate at least this many bytes and pass to initText.
 */
uint16_t qrcode_getBufferSize(uint8_t version);

/*
 * Encode `data` (NUL-terminated UTF-8/ASCII string) into a QR code.
 *   qrcode     – output handle
 *   dataBuffer – caller-allocated buffer of >= qrcode_getBufferSize(version) bytes
 *   version    – QR version 1-20
 *   ecc        – error-correction level (ECC_LOW … ECC_HIGH)
 *   data       – text to encode
 * Returns 0 on success, negative on error.
 */
int8_t qrcode_initText(QRCode *qrcode, uint8_t *dataBuffer,
                        uint8_t version, uint8_t ecc, const char *data);

/*
 * Read a single module.  Returns true = dark, false = light.
 */
bool qrcode_getModule(const QRCode *qrcode, uint8_t x, uint8_t y);

#ifdef __cplusplus
}
#endif

#endif /* QRCODE_GEN_H */
