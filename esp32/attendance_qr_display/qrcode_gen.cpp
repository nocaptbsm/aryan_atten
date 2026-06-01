/*
 * ============================================================
 * QR Code Generator — Full Implementation
 * ============================================================
 * Self-contained Reed-Solomon + QR encoder.
 * Supports versions 1-20, all ECC levels, byte-mode encoding.
 * ============================================================
 */

#include "qrcode_gen.h"
#include <string.h>
#include <stdlib.h>

/* ============================================================
 * 1. Galois Field GF(2^8)
 *    Primitive polynomial: x^8+x^4+x^3+x^2+1 = 0x11D
 * ============================================================ */

static uint8_t gf_exp[256];
static uint8_t gf_log[256];
static bool    gf_ready = false;

static void gf_init(void) {
    if (gf_ready) return;
    int v = 1;
    for (int i = 0; i < 255; i++) {
        gf_exp[i] = (uint8_t)v;
        gf_log[v] = (uint8_t)i;
        v <<= 1;
        if (v & 0x100) v ^= 0x11D;
    }
    gf_exp[255] = gf_exp[0];
    gf_ready = true;
}

static inline uint8_t gf_mul(uint8_t a, uint8_t b) {
    if (a == 0 || b == 0) return 0;
    return gf_exp[(gf_log[a] + gf_log[b]) % 255];
}

/* ============================================================
 * 2. Bit-packed bitmap helpers
 * ============================================================ */

static inline void bset(uint8_t *arr, int pos, bool val) {
    if (val) arr[pos >> 3] |=  (1 << (pos & 7));
    else     arr[pos >> 3] &= ~(1 << (pos & 7));
}

static inline bool bget(const uint8_t *arr, int pos) {
    return (arr[pos >> 3] >> (pos & 7)) & 1;
}

/* ============================================================
 * 3. Version / ECC parameter tables  (versions 1-20)
 * ============================================================ */

typedef struct {
    uint8_t ecPerBlock;   /* EC codewords per RS block       */
    uint8_t g1Blocks;     /* group-1 block count             */
    uint8_t g1DataCW;     /* data codewords per block in g1  */
    uint8_t g2Blocks;     /* group-2 block count (0 if none) */
    uint8_t g2DataCW;     /* data codewords per block in g2  */
} VersionECC;

/* Indexed [version-1][eccLevel] */
static const VersionECC VER_TBL[20][4] = {
 /* V1  */ {{7,1,19,0,0},{10,1,16,0,0},{13,1,13,0,0},{17,1,9,0,0}},
 /* V2  */ {{10,1,34,0,0},{16,1,28,0,0},{22,1,22,0,0},{28,1,16,0,0}},
 /* V3  */ {{15,1,55,0,0},{26,1,44,0,0},{18,2,17,0,0},{22,2,13,0,0}},
 /* V4  */ {{20,1,80,0,0},{18,2,32,0,0},{26,2,24,0,0},{16,4,9,0,0}},
 /* V5  */ {{26,1,108,0,0},{24,2,43,0,0},{18,2,15,2,16},{22,2,11,2,12}},
 /* V6  */ {{18,2,68,0,0},{16,4,27,0,0},{24,4,19,0,0},{28,4,15,0,0}},
 /* V7  */ {{20,2,78,0,0},{18,4,31,0,0},{18,2,14,4,15},{26,4,13,1,14}},
 /* V8  */ {{24,2,97,0,0},{22,2,38,2,39},{22,4,18,2,19},{26,4,14,2,15}},
 /* V9  */ {{30,2,116,0,0},{22,3,36,2,37},{20,4,16,4,17},{24,4,12,4,13}},
 /* V10 */ {{18,2,68,2,69},{26,4,43,1,44},{24,6,19,2,20},{28,6,15,2,16}},
 /* V11 */ {{20,4,81,0,0},{30,1,50,4,51},{28,4,22,4,23},{24,3,12,8,13}},
 /* V12 */ {{24,2,92,2,93},{22,6,36,2,37},{26,4,20,6,21},{28,7,14,4,15}},
 /* V13 */ {{26,4,107,0,0},{22,8,37,1,38},{24,8,20,4,21},{22,12,11,4,12}},
 /* V14 */ {{30,3,115,1,116},{24,4,40,5,41},{20,11,16,5,17},{24,11,12,5,13}},
 /* V15 */ {{22,5,87,1,88},{24,5,41,5,42},{30,5,24,7,25},{24,11,12,7,13}},
 /* V16 */ {{24,5,98,1,99},{28,7,45,3,46},{24,15,19,2,20},{30,3,15,13,16}},
 /* V17 */ {{28,1,107,5,108},{28,10,46,1,47},{28,1,22,15,23},{28,2,14,17,15}},
 /* V18 */ {{30,5,120,1,121},{26,9,43,4,44},{28,17,22,1,23},{28,2,14,19,15}},
 /* V19 */ {{28,3,113,4,114},{26,3,44,11,45},{26,17,21,4,22},{26,9,13,16,14}},
 /* V20 */ {{28,3,107,5,108},{26,3,41,13,42},{28,15,24,5,25},{28,15,15,10,16}},
};

/* Alignment-pattern centre coordinates.  0-terminated. */
static const uint8_t ALIGN_POS[20][7] = {
    {0},              /* V1  – none */
    {6,18,0},         /* V2  */
    {6,22,0},         /* V3  */
    {6,26,0},         /* V4  */
    {6,30,0},         /* V5  */
    {6,34,0},         /* V6  */
    {6,22,38,0},      /* V7  */
    {6,24,42,0},      /* V8  */
    {6,26,46,0},      /* V9  */
    {6,28,50,0},      /* V10 */
    {6,30,54,0},      /* V11 */
    {6,32,58,0},      /* V12 */
    {6,34,62,0},      /* V13 */
    {6,26,46,66,0},   /* V14 */
    {6,26,48,70,0},   /* V15 */
    {6,26,50,74,0},   /* V16 */
    {6,30,54,78,0},   /* V17 */
    {6,30,56,82,0},   /* V18 */
    {6,30,58,86,0},   /* V19 */
    {6,34,62,90,0},   /* V20 */
};

static uint8_t alignCount(uint8_t ver) {
    if (ver == 1) return 0;
    const uint8_t *p = ALIGN_POS[ver - 1];
    uint8_t n = 0;
    while (n < 7 && p[n]) n++;
    return n;
}

/* ============================================================
 * 4. Reed-Solomon encoder
 * ============================================================ */

/*
 * Build the generator polynomial of degree `deg`.
 * gen[i] = coefficient of x^i,  gen[deg] = 1 (monic).
 * Caller provides array of (deg + 1) bytes.
 */
static void rs_buildGen(uint8_t *gen, int deg) {
    memset(gen, 0, deg + 1);
    gen[0] = 1;
    for (int i = 0; i < deg; i++) {
        for (int j = deg; j > 0; j--)
            gen[j] = gen[j - 1] ^ gf_mul(gen[j], gf_exp[i]);
        gen[0] = gf_mul(gen[0], gf_exp[i]);
    }
}

/*
 * Divide data polynomial by generator, store remainder in `ecc`.
 * ecc[0] = constant term … ecc[eccLen-1] = highest-degree term.
 */
static void rs_encode(const uint8_t *data, int dataLen,
                      uint8_t *ecc, int eccLen,
                      const uint8_t *gen) {
    memset(ecc, 0, eccLen);
    for (int i = 0; i < dataLen; i++) {
        uint8_t fb = data[i] ^ ecc[eccLen - 1];
        for (int j = eccLen - 1; j > 0; j--)
            ecc[j] = ecc[j - 1] ^ gf_mul(fb, gen[j]);
        ecc[0] = gf_mul(fb, gen[0]);
    }
}

/* Reverse array in-place (convert coefficient order → spec order). */
static void reverseBytes(uint8_t *arr, int len) {
    for (int i = 0; i < len / 2; i++) {
        uint8_t t = arr[i];
        arr[i] = arr[len - 1 - i];
        arr[len - 1 - i] = t;
    }
}

/* ============================================================
 * 5. Data encoding  (byte mode only)
 * ============================================================ */

static int encodeData(const char *text, uint8_t *cw, int totalCW, int ver) {
    int tlen = (int)strlen(text);
    int ccBits = (ver <= 9) ? 8 : 16;

    /* Quick capacity check */
    int bitsNeeded = 4 + ccBits + tlen * 8;
    if (bitsNeeded > totalCW * 8) return -1;

    memset(cw, 0, totalCW);
    int bitPos = 0;

    /* Helper: append `n` bits of `val` (MSB first) */
    #define PUSH(val, n) do { \
        uint32_t _v = (val); \
        for (int _i = (n) - 1; _i >= 0; _i--) { \
            if (_v & (1U << _i)) \
                cw[bitPos >> 3] |= (1 << (7 - (bitPos & 7))); \
            bitPos++; \
        } \
    } while (0)

    PUSH(0x4, 4);              /* byte-mode indicator */
    PUSH(tlen, ccBits);        /* character count     */
    for (int i = 0; i < tlen; i++)
        PUSH((uint8_t)text[i], 8);

    /* Terminator (up to 4 zero bits) */
    int termBits = totalCW * 8 - bitPos;
    if (termBits > 4) termBits = 4;
    PUSH(0, termBits);

    /* Pad to byte boundary */
    if (bitPos & 7)
        PUSH(0, 8 - (bitPos & 7));

    /* Pad with alternating 0xEC / 0x11 */
    int bytesFilled = bitPos >> 3;
    for (int i = bytesFilled; i < totalCW; i++)
        cw[i] = (((i - bytesFilled) & 1) == 0) ? 0xEC : 0x11;

    #undef PUSH
    return 0;
}

/* ============================================================
 * 6. Function-pattern placement
 * ============================================================ */

/* ---- 6a. Finder pattern (7×7) ---- */
static void drawFinder(uint8_t *mod, uint8_t *fn, int sz, int cRow, int cCol) {
    for (int dr = -3; dr <= 3; dr++) {
        for (int dc = -3; dc <= 3; dc++) {
            int r = cRow + dr, c = cCol + dc;
            if (r < 0 || r >= sz || c < 0 || c >= sz) continue;
            int mx = (dr < 0 ? -dr : dr);
            int my = (dc < 0 ? -dc : dc);
            int m  = (mx > my) ? mx : my;      /* max(|dr|,|dc|) */
            bool dark = (m != 2);               /* outer + inner dark, ring light */
            int pos = r * sz + c;
            bset(mod, pos, dark);
            bset(fn,  pos, true);
        }
    }
}

/* ---- 6b. Separators + format-info reservation ---- */
static void reserveFinderAreas(uint8_t *fn, int sz) {
    /* Top-left 9×9 */
    for (int r = 0; r <= 8; r++)
        for (int c = 0; c <= 8; c++)
            bset(fn, r * sz + c, true);
    /* Top-right 9×9 */
    for (int r = 0; r <= 8; r++)
        for (int c = sz - 8; c < sz; c++)
            bset(fn, r * sz + c, true);
    /* Bottom-left 9×9 */
    for (int r = sz - 8; r < sz; r++)
        for (int c = 0; c <= 8; c++)
            bset(fn, r * sz + c, true);
}

/* ---- 6c. Alignment pattern (5×5) ---- */
static void drawAlign(uint8_t *mod, uint8_t *fn, int sz, int cRow, int cCol) {
    for (int dr = -2; dr <= 2; dr++) {
        for (int dc = -2; dc <= 2; dc++) {
            int r = cRow + dr, c = cCol + dc;
            if (r < 0 || r >= sz || c < 0 || c >= sz) continue;
            int mx = (dr < 0 ? -dr : dr);
            int my = (dc < 0 ? -dc : dc);
            int m  = (mx > my) ? mx : my;
            bool dark = (m == 2) || (m == 0);   /* border + centre */
            int pos = r * sz + c;
            bset(mod, pos, dark);
            bset(fn,  pos, true);
        }
    }
}

static void placeAlignments(uint8_t *mod, uint8_t *fn, int ver, int sz) {
    uint8_t cnt = alignCount(ver);
    if (cnt == 0) return;
    const uint8_t *pos = ALIGN_POS[ver - 1];
    for (int i = 0; i < cnt; i++) {
        for (int j = 0; j < cnt; j++) {
            /* Skip corners that overlap finder patterns */
            if ((i == 0       && j == 0)       ||
                (i == 0       && j == cnt - 1) ||
                (i == cnt - 1 && j == 0))
                continue;
            drawAlign(mod, fn, sz, pos[i], pos[j]);
        }
    }
}

/* ---- 6d. Timing patterns ---- */
static void drawTiming(uint8_t *mod, uint8_t *fn, int sz) {
    for (int i = 8; i < sz - 8; i++) {
        bool dark = ((i & 1) == 0);
        /* Horizontal: row 6 */
        int hpos = 6 * sz + i;
        bset(mod, hpos, dark);
        bset(fn,  hpos, true);
        /* Vertical: col 6 */
        int vpos = i * sz + 6;
        bset(mod, vpos, dark);
        bset(fn,  vpos, true);
    }
}

/* ---- 6e. Dark module ---- */
static void setDarkModule(uint8_t *mod, uint8_t *fn, int ver, int sz) {
    int r = 4 * ver + 9;
    int pos = r * sz + 8;
    bset(mod, pos, true);
    bset(fn,  pos, true);
}

/* ---- 6f. Reserve version-info area (v ≥ 7) ---- */
static void reserveVersionArea(uint8_t *fn, int ver, int sz) {
    if (ver < 7) return;
    for (int i = 0; i < 18; i++) {
        int row = i / 3, col = i % 3;
        bset(fn, (sz - 11 + col) * sz + row, true);   /* lower-left  */
        bset(fn, row * sz + (sz - 11 + col),  true);   /* upper-right */
    }
}

/* ============================================================
 * 7. Format & version information
 * ============================================================ */

static const uint8_t ECC_FMT[] = {1, 0, 3, 2};

static uint32_t formatBits(uint8_t ecc, uint8_t mask) {
    uint32_t d = ((uint32_t)ECC_FMT[ecc] << 3) | mask;
    uint32_t rem = d << 10;
    for (int i = 4; i >= 0; i--)
        if (rem & (1U << (i + 10)))
            rem ^= (0x537U << i);
    return ((d << 10) | rem) ^ 0x5412U;
}

static void writeFormat(uint8_t *mod, int sz, uint8_t ecc, uint8_t mask) {
    uint32_t bits = formatBits(ecc, mask);

    /* Copy-1 positions (near top-left finder) */
    static const int8_t c1r[] = {8,8,8,8,8,8,8,8, 7,5,4,3,2,1,0};
    static const int8_t c1c[] = {0,1,2,3,4,5,7,8, 8,8,8,8,8,8,8};

    for (int i = 0; i < 15; i++) {
        bool b = (bits >> i) & 1;
        bset(mod, c1r[i] * sz + c1c[i], b);          /* copy 1 */

        int r2, c2;
        if (i <= 6) { r2 = sz - 1 - i; c2 = 8; }
        else        { r2 = 8; c2 = sz - 8 + (i - 7); }
        bset(mod, r2 * sz + c2, b);                   /* copy 2 */
    }
}

static void writeVersion(uint8_t *mod, int sz, uint8_t ver) {
    if (ver < 7) return;
    uint32_t d = (uint32_t)ver << 12;
    for (int i = 5; i >= 0; i--)
        if (d & (1U << (i + 12)))
            d ^= (0x1F25U << i);
    uint32_t bits = ((uint32_t)ver << 12) | d;

    for (int i = 0; i < 18; i++) {
        bool b = (bits >> i) & 1;
        int row = i / 3, col = i % 3;
        bset(mod, (sz - 11 + col) * sz + row, b);     /* lower-left  */
        bset(mod, row * sz + (sz - 11 + col),  b);     /* upper-right */
    }
}

/* ============================================================
 * 8. Data-bit placement  (right-to-left zigzag)
 * ============================================================ */

static void placeData(uint8_t *mod, const uint8_t *fn,
                      const uint8_t *data, int dataLen, int sz) {
    int bitIdx = 0, totalBits = dataLen * 8;
    bool up = true;

    for (int right = sz - 1; right >= 1; right -= 2) {
        if (right == 6) right = 5;          /* skip timing column */
        for (int v = 0; v < sz; v++) {
            int y = up ? (sz - 1 - v) : v;
            for (int dx = 0; dx <= 1; dx++) {
                int x = right - dx;
                if (x < 0) continue;
                int pos = y * sz + x;
                if (bget(fn, pos)) continue;
                if (bitIdx < totalBits) {
                    bool bit = (data[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
                    bset(mod, pos, bit);
                    bitIdx++;
                }
            }
        }
        up = !up;
    }
}

/* ============================================================
 * 9. Masking
 * ============================================================ */

static bool maskFlip(int mask, int r, int c) {
    switch (mask) {
        case 0: return ((r + c) & 1) == 0;
        case 1: return (r & 1) == 0;
        case 2: return (c % 3) == 0;
        case 3: return ((r + c) % 3) == 0;
        case 4: return (((r >> 1) + (c / 3)) & 1) == 0;
        case 5: return ((r * c) % 2 + (r * c) % 3) == 0;
        case 6: return (((r * c) % 2 + (r * c) % 3) & 1) == 0;
        case 7: return ((((r + c) & 1) + (r * c) % 3) & 1) == 0;
    }
    return false;
}

/* Apply / un-apply mask (XOR → self-inverse). */
static void toggleMask(uint8_t *mod, const uint8_t *fn, int sz, int mask) {
    for (int r = 0; r < sz; r++)
        for (int c = 0; c < sz; c++) {
            int pos = r * sz + c;
            if (bget(fn, pos)) continue;
            if (maskFlip(mask, r, c))
                bset(mod, pos, !bget(mod, pos));
        }
}

/* ---- Penalty scoring ---- */

static long penalty(const uint8_t *mod, int sz) {
    long score = 0;

    /* Rule 1 – runs of same colour in rows & columns */
    for (int r = 0; r < sz; r++) {
        int run = 1;
        bool prev = bget(mod, r * sz);
        for (int c = 1; c < sz; c++) {
            bool cur = bget(mod, r * sz + c);
            if (cur == prev) { run++; }
            else { if (run >= 5) score += run - 2; run = 1; prev = cur; }
        }
        if (run >= 5) score += run - 2;
    }
    for (int c = 0; c < sz; c++) {
        int run = 1;
        bool prev = bget(mod, c);
        for (int r = 1; r < sz; r++) {
            bool cur = bget(mod, r * sz + c);
            if (cur == prev) { run++; }
            else { if (run >= 5) score += run - 2; run = 1; prev = cur; }
        }
        if (run >= 5) score += run - 2;
    }

    /* Rule 2 – 2×2 same-colour blocks */
    for (int r = 0; r < sz - 1; r++)
        for (int c = 0; c < sz - 1; c++) {
            bool v = bget(mod, r * sz + c);
            if (v == bget(mod, r * sz + c + 1) &&
                v == bget(mod, (r + 1) * sz + c) &&
                v == bget(mod, (r + 1) * sz + c + 1))
                score += 3;
        }

    /* Rule 3 – finder-like patterns (1011101 + 4 light) */
    static const bool patA[] = {1,0,1,1,1,0,1,0,0,0,0};
    static const bool patB[] = {0,0,0,0,1,0,1,1,1,0,1};
    for (int r = 0; r < sz; r++) {
        for (int c = 0; c <= sz - 11; c++) {
            bool mA = true, mB = true;
            for (int k = 0; k < 11; k++) {
                bool v = bget(mod, r * sz + c + k);
                if (v != patA[k]) mA = false;
                if (v != patB[k]) mB = false;
                if (!mA && !mB) break;
            }
            if (mA) score += 40;
            if (mB) score += 40;
        }
    }
    for (int c = 0; c < sz; c++) {
        for (int r = 0; r <= sz - 11; r++) {
            bool mA = true, mB = true;
            for (int k = 0; k < 11; k++) {
                bool v = bget(mod, (r + k) * sz + c);
                if (v != patA[k]) mA = false;
                if (v != patB[k]) mB = false;
                if (!mA && !mB) break;
            }
            if (mA) score += 40;
            if (mB) score += 40;
        }
    }

    /* Rule 4 – dark/light ratio */
    int total = sz * sz, dark = 0;
    for (int i = 0; i < (total + 7) / 8; i++) {
        uint8_t b = mod[i];
        /* count set bits */
        b = b - ((b >> 1) & 0x55);
        b = (b & 0x33) + ((b >> 2) & 0x33);
        dark += (b + (b >> 4)) & 0x0F;
    }
    /* Trim any excess bits beyond `total` in the last byte */
    int excess = (total & 7) ? 8 - (total & 7) : 0;
    if (excess) {
        uint8_t last = mod[(total - 1) >> 3];
        for (int i = 8 - excess; i < 8; i++)
            if ((last >> i) & 1) dark--;
    }
    int pct = (dark * 100) / total;
    int p5  = (pct / 5) * 5;
    int n5  = p5 + 5;
    int dP  = (p5 - 50); if (dP < 0) dP = -dP; dP /= 5;
    int dN  = (n5 - 50); if (dN < 0) dN = -dN; dN /= 5;
    score += ((dP < dN) ? dP : dN) * 10;

    return score;
}

static uint8_t bestMask(uint8_t *mod, const uint8_t *fn, int sz) {
    long   best  = 0x7FFFFFFFL;
    uint8_t pick = 0;
    for (int m = 0; m < 8; m++) {
        toggleMask(mod, fn, sz, m);
        long p = penalty(mod, sz);
        toggleMask(mod, fn, sz, m);   /* undo */
        if (p < best) { best = p; pick = (uint8_t)m; }
    }
    return pick;
}

/* ============================================================
 * 10. Public API
 * ============================================================ */

uint16_t qrcode_getBufferSize(uint8_t version) {
    int s = 4 * (int)version + 17;
    return (uint16_t)((s * s + 7) / 8);
}

int8_t qrcode_initText(QRCode *qrcode, uint8_t *buf,
                        uint8_t version, uint8_t ecc, const char *data) {
    /* Validate */
    if (version < 1 || version > 20) return -1;
    if (ecc > 3) return -1;
    if (!data) return -1;

    gf_init();

    int sz = 4 * (int)version + 17;
    int bufSz = (sz * sz + 7) / 8;

    qrcode->version = version;
    qrcode->size    = (uint8_t)sz;
    qrcode->ecc     = ecc;
    qrcode->modules = buf;

    memset(buf, 0, bufSz);

    /* Allocate temporary function-pattern bitmap */
    uint8_t *fn = (uint8_t *)calloc(bufSz, 1);
    if (!fn) return -2;

    /* ---- Place function patterns ---- */
    drawFinder(buf, fn, sz, 3,      3);          /* top-left      */
    drawFinder(buf, fn, sz, 3,      sz - 4);     /* top-right     */
    drawFinder(buf, fn, sz, sz - 4, 3);          /* bottom-left   */
    reserveFinderAreas(fn, sz);
    placeAlignments(buf, fn, version, sz);
    drawTiming(buf, fn, sz);
    setDarkModule(buf, fn, version, sz);
    reserveVersionArea(fn, version, sz);

    /* ---- Encode data codewords ---- */
    const VersionECC *vi = &VER_TBL[version - 1][ecc];
    int totalData = vi->g1Blocks * vi->g1DataCW + vi->g2Blocks * vi->g2DataCW;
    int totalBlks = vi->g1Blocks + vi->g2Blocks;
    int ecPer     = vi->ecPerBlock;
    int totalCW   = totalData + totalBlks * ecPer;

    uint8_t *dataCW = (uint8_t *)malloc(totalData);
    if (!dataCW) { free(fn); return -2; }

    if (encodeData(data, dataCW, totalData, version) < 0) {
        free(dataCW); free(fn); return -3; /* data too long */
    }

    /* ---- RS encode each block ---- */
    uint8_t *gen = (uint8_t *)malloc(ecPer + 1);
    uint8_t *allEC = (uint8_t *)malloc(totalBlks * ecPer);
    uint8_t *interleaved = (uint8_t *)malloc(totalCW);
    if (!gen || !allEC || !interleaved) {
        free(gen); free(allEC); free(interleaved);
        free(dataCW); free(fn);
        return -2;
    }

    rs_buildGen(gen, ecPer);

    int offset = 0;
    for (int b = 0; b < totalBlks; b++) {
        int dcLen = (b < vi->g1Blocks) ? vi->g1DataCW : vi->g2DataCW;
        uint8_t *ecOut = allEC + b * ecPer;
        rs_encode(dataCW + offset, dcLen, ecOut, ecPer, gen);
        reverseBytes(ecOut, ecPer);   /* coefficient → spec order */
        offset += dcLen;
    }
    free(gen);

    /* ---- Interleave data codewords ---- */
    int idx = 0;
    int maxDC = (vi->g1DataCW > vi->g2DataCW) ? vi->g1DataCW : vi->g2DataCW;
    if (vi->g2Blocks == 0) maxDC = vi->g1DataCW;

    int blkOff[30];   /* cumulative offset into dataCW for each block */
    blkOff[0] = 0;
    for (int b = 1; b < totalBlks; b++)
        blkOff[b] = blkOff[b - 1] +
                     ((b - 1 < vi->g1Blocks) ? vi->g1DataCW : vi->g2DataCW);

    for (int i = 0; i < maxDC; i++) {
        for (int b = 0; b < totalBlks; b++) {
            int dcLen = (b < vi->g1Blocks) ? vi->g1DataCW : vi->g2DataCW;
            if (i < dcLen)
                interleaved[idx++] = dataCW[blkOff[b] + i];
        }
    }
    free(dataCW);

    /* ---- Interleave EC codewords ---- */
    for (int i = 0; i < ecPer; i++)
        for (int b = 0; b < totalBlks; b++)
            interleaved[idx++] = allEC[b * ecPer + i];
    free(allEC);

    /* ---- Place data bits ---- */
    placeData(buf, fn, interleaved, totalCW, sz);
    free(interleaved);

    /* ---- Find & apply best mask ---- */
    uint8_t mask = bestMask(buf, fn, sz);
    toggleMask(buf, fn, sz, mask);

    /* ---- Write format & version info ---- */
    writeFormat(buf, sz, ecc, mask);
    writeVersion(buf, sz, version);

    free(fn);
    return 0;
}

bool qrcode_getModule(const QRCode *qrcode, uint8_t x, uint8_t y) {
    if (x >= qrcode->size || y >= qrcode->size) return false;
    return bget(qrcode->modules, y * qrcode->size + x);
}
