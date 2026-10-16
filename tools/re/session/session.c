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
    if (argc != 3) return 2;
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
    puts("OK ready"); fflush(stdout);
    while (fgets(line, sizeof(line), stdin)) {
        unsigned a = 0, b = 0;
        int fields = sscanf(line, "%31s %u %u", op, &a, &b);
        if (fields < 1) { puts("ERR command"); }
        else if (!strcmp(op, "step") && fields == 3 && a < 1024 && b <= 3600) {
            core->setKeys(core, a);
            int videoOk = 1;
            for (unsigned i = 0; i < b; ++i) {
                core->runFrame(core); drain(core);
                if (video && recordingFrame++ % stride == 0) {
                    if (!writePixels(video, pixels)) videoOk = 0;
                    else ++recorded;
                }
            }
            core->setKeys(core, 0); frames += b;
            if (videoOk) printf("OK %llu\n", frames); else puts("ERR recording");
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
