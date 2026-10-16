/* Private, persistent libmgba session. No cartridge save is opened on disk.
 * Python bridge owns the public JSON protocol and bounded artifact names. */
#include <mgba/flags.h>
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba/core/blip_buf.h>
#include <mgba/core/version.h>
#include <mgba/gba/core.h>
#include <mgba-util/vfs.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void quiet(struct mLogger* l, int c, enum mLogLevel v, const char* f, va_list a) {}
static struct mLogger logger = {.log = quiet};
static int writePixels(FILE* f, const color_t* pixels) {
    unsigned char row[240 * 4];
    for (int y = 0; y < 160; ++y) {
        for (int x = 0; x < 240; ++x) {
            color_t c = pixels[y * 240 + x];
            row[x * 4] = c & 255; row[x * 4 + 1] = (c >> 8) & 255;
            row[x * 4 + 2] = (c >> 16) & 255; row[x * 4 + 3] = 255;
        }
        if (fwrite(row, 1, sizeof(row), f) != sizeof(row)) return 0;
    }
    return 1;
}
static void drain(struct mCore* core) {
    short samples[4096];
    for (int ch = 0; ch < 2; ++ch) {
        struct blip_t* b = core->getAudioChannel(core, ch);
        while (blip_samples_avail(b) > 0) {
            int n = blip_samples_avail(b);
            blip_read_samples(b, samples, n > 4096 ? 4096 : n, 0);
        }
    }
}
int main(int argc, char** argv) {
    if (argc != 3 && argc != 5 && argc != 6) return 2;
    unsigned mailboxBase = 0, mailboxSize = 0, callbackAddress = 0;
    if (argc == 5 && !strcmp(argv[3], "--callback-watch")) {
        callbackAddress = strtoul(argv[4], NULL, 0);
        if (callbackAddress < 0x03000000 || callbackAddress > 0x03008000 - 4) return 2;
    } else if (argc >= 5) {
        mailboxBase = strtoul(argv[3], NULL, 0);
        mailboxSize = strtoul(argv[4], NULL, 0);
        if (!mailboxSize || mailboxSize > 8192 || mailboxBase < 0x02000000 ||
            mailboxBase > 0x02040000 - mailboxSize) return 2;
    }
    if (argc == 6) {
        callbackAddress = strtoul(argv[5], NULL, 0);
        if (callbackAddress < 0x03000000 || callbackAddress > 0x03008000 - 4) return 2;
    }
    mLogSetDefaultLogger(&logger);
    struct mCore* core = GBACoreCreate();
    if (!core || !core->init(core)) return 3;
    mCoreInitConfig(core, NULL);
    mCoreConfigSetDefaultIntValue(&core->config, "skipBios", 1);
    mCoreConfigSetDefaultIntValue(&core->config, "useBios", 0);
    mCoreLoadConfig(core);
    color_t* pixels = calloc(240 * 160, sizeof(color_t));
    if (!pixels) return 4;
    core->setVideoBuffer(core, pixels, 240);
    core->setAudioBufferSize(core, 4096);
    if (!mCoreLoadFile(core, argv[1])) return 5;
    core->rtc.override = RTC_FIXED;
    core->rtc.value = 1704067200000LL;
    core->reset(core);
    for (int ch = 0; ch < 2; ++ch)
        blip_set_rates(core->getAudioChannel(core, ch), core->frequency(core), 16000);
    char line[256], op[32], path[4096];
    unsigned long long frames = 0;
    unsigned long long recorded = 0, recordingFrame = 0;
    unsigned stride = 2;
    FILE* video = NULL;
    unsigned watchAddress[32], watchWidth[32], watchMask[32], watchCount = 0;
    puts("OK ready"); fflush(stdout);
    while (fgets(line, sizeof(line), stdin)) {
        unsigned a = 0, b = 0;
        int fields = sscanf(line, "%31s %u %u", op, &a, &b);
        if (fields < 1) { puts("ERR command"); }
        else if ((!strcmp(op, "step") || !strcmp(op, "stepw")) && fields == 3 && a < 1024 && b <= 3600) {
            core->setKeys(core, a);
            int videoOk = 1;
            unsigned advanced = 0;
            int watchHit = -1;
            unsigned watchBefore[32];
            for (unsigned w = 0; w < watchCount; ++w) {
                unsigned value = 0;
                for (unsigned j = 0; j < watchWidth[w]; ++j)
                    value |= (unsigned) core->busRead8(core, watchAddress[w] + j) << (8 * j);
                watchBefore[w] = value & watchMask[w];
            }
            unsigned callbackBefore = callbackAddress ? core->busRead32(core, callbackAddress) : 0;
            for (unsigned i = 0; i < b; ++i) {
                core->runFrame(core); drain(core); ++advanced;
                if (video && recordingFrame++ % stride == 0) {
                    if (!writePixels(video, pixels)) videoOk = 0;
                    else ++recorded;
                }
                /* Source words sampled after EVERY frame, before another
                 * frame can hide a transient boundary. Read-only RAM only. */
                for (unsigned w = 0; w < watchCount; ++w) {
                    unsigned value = 0;
                    for (unsigned j = 0; j < watchWidth[w]; ++j)
                        value |= (unsigned) core->busRead8(core, watchAddress[w] + j) << (8 * j);
                    if ((value & watchMask[w]) != watchBefore[w]) { watchHit = (int) w; break; }
                }
                if (watchHit >= 0) break;
                /* Stop at the source-owned region export boundary; never skip
                 * a READY travel event while running a longer input batch. */
                if (callbackAddress && core->busRead32(core, callbackAddress) != callbackBefore) break;
                if (mailboxSize >= 24 && core->busRead32(core, mailboxBase) == 0x57474D31 &&
                    core->busRead32(core, mailboxBase + 16) == 1 &&
                    core->busRead32(core, mailboxBase + 20) == 2) break;
            }
            core->setKeys(core, 0); frames += advanced;
            if (!videoOk) puts("ERR recording");
            else if (!strcmp(op, "stepw")) printf("OK %llu %d\n", frames, watchHit);
            else printf("OK %llu\n", frames);
        } else if (!strcmp(op, "unwatch")) {
            watchCount = 0; puts("OK cleared");
        } else if (!strcmp(op, "watch") && fields == 3 && watchCount < 32 &&
                   (b == 1 || b == 2 || b == 4) &&
                   ((a >= 0x02000000 && a <= 0x02040000 - b) ||
                    (a >= 0x03000000 && a <= 0x03008000 - b))) {
            unsigned mask;
            if (sscanf(line, "%*s %*u %*u %u", &mask) == 1 && mask) {
                watchAddress[watchCount] = a; watchWidth[watchCount] = b;
                watchMask[watchCount++] = mask; puts("OK watching");
            } else puts("ERR watch");
        } else if (!strcmp(op, "frame")) {
            snprintf(path, sizeof(path), "%s/frame.rgba", argv[2]);
            FILE* f = fopen(path, "wb");
            int ok = f != NULL;
            if (f) {
                ok = writePixels(f, pixels);
                if (fclose(f)) ok = 0;
            }
            if (ok) printf("OK %llu\n", frames); else puts("ERR frame");
        } else if (!strcmp(op, "read") && fields == 3 && b > 0 && b <= 256 &&
                   ((a >= 0x02000000 && a <= 0x02040000 - b) ||
                    (a >= 0x03000000 && a <= 0x03008000 - b))) {
            printf("OK ");
            for (unsigned i = 0; i < b; ++i) printf("%02x", (unsigned) core->busRead8(core, a + i));
            putchar('\n');
        } else if (!strcmp(op, "write") && fields == 3 && mailboxSize && b > 0 && b <= 64 &&
                   a >= mailboxBase && a <= mailboxBase + mailboxSize - b && b <= mailboxSize) {
            char hex[129];
            int n = 0, valid = 1;
            if (sscanf(line, "%*s %*u %*u %128s%n", hex, &n) != 1 || strlen(hex) != b * 2) valid = 0;
            for (unsigned i = 0; valid && i < b * 2; ++i)
                if (!((hex[i] >= '0' && hex[i] <= '9') || (hex[i] >= 'a' && hex[i] <= 'f'))) valid = 0;
            if (valid) {
                for (unsigned i = 0; i < b; ++i) {
                    char byte[3] = {hex[2*i], hex[2*i+1], 0};
                    core->busWrite8(core, a + i, strtoul(byte, NULL, 16));
                }
                puts("OK written");
            } else puts("ERR mailbox");
        } else if (!strcmp(op, "record") && fields >= 2 && a <= 1) {
            if (a == 1 && !video && fields == 3 && b >= 1 && b <= 6) {
                snprintf(path, sizeof(path), "%s/video.rgba", argv[2]);
                video = fopen(path, "wb"); stride = b; recordingFrame = recorded = 0;
                puts(video ? "OK recording" : "ERR recording");
            } else if (a == 0 && video) {
                int ok = !fclose(video); video = NULL;
                if (ok) printf("OK %llu\n", recorded); else puts("ERR recording");
            } else puts("ERR recording");
        } else if (!strcmp(op, "version")) {
            printf("OK %s %d %d\n", projectVersion, core->frequency(core), core->frameCycles(core));
        } else if ((!strcmp(op, "save") || !strcmp(op, "load")) && fields == 2 && a < 32) {
            int saving = !strcmp(op, "save");
            snprintf(path, sizeof(path), "%s/checkpoint-%u.ss", argv[2], a);
            /* mCoreSaveStateNamed maps the file read/write, so O_WRONLY fails. */
            struct VFile* vf = VFileOpen(path, saving ? O_CREAT | O_TRUNC | O_RDWR : O_RDONLY);
            int flags = SAVESTATE_SAVEDATA | SAVESTATE_RTC | SAVESTATE_METADATA;
            int ok = vf && (saving ? mCoreSaveStateNamed(core, vf, flags) : mCoreLoadStateNamed(core, vf, flags));
            if (vf) vf->close(vf);
            puts(ok ? "OK state" : "ERR state");
        } else if (!strcmp(op, "close")) { puts("OK close"); fflush(stdout); break; }
        else puts("ERR command");
        fflush(stdout);
    }
    if (video) fclose(video);
    core->deinit(core); free(pixels);
    return 0;
}
