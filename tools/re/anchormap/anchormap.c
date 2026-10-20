/* Anchormap memory-probe worker: a read/step/snapshot superset of
 * tools/re/session/session.c, built for offline anchor discovery.
 *
 * It deliberately exposes raw bus reads over the *whole* 32-bit address space
 * (so ROM, OAM, VRAM and I/O are readable) and raw snapshots to files, because
 * anchor discovery is a diff-scan problem, not a gameplay problem. Writes are
 * restricted to EWRAM/IWRAM so a probe can reset a discovered shadow and watch
 * the game react. No cartridge save is opened on disk. The Python driver owns
 * the analysis; this process only moves bytes.
 *
 * Line protocol (hex or decimal for numeric fields):
 *   blocks                       -> block inventory
 *   step <keys> <frames>         -> run frames with a GBA key mask
 *   read <addr> <len>            -> hex dump of bus bytes (len <= 65536)
 *   read32 <addr>                -> single little-endian word
 *   snap <addr> <len> <name>     -> raw bus bytes to <outdir>/<name>.bin
 *   shot <name>                  -> 240x160 RGBA to <outdir>/<name>.rgba
 *   writemem <addr> <len> <hex>  -> write EWRAM/IWRAM bytes
 *   save/load <path>             -> native mGBA savestate
 *   regs / version / close
 */
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

static unsigned char rbuf[1 << 20];

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    const char* outdir = argv[2];
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

    char line[8192], op[32], path[4096], name[256], hex[4097];
    unsigned long long frames = 0;
    puts("OK ready");
    fflush(stdout);
    while (fgets(line, sizeof(line), stdin)) {
        if (sscanf(line, "%31s", op) != 1) { puts("ERR command"); fflush(stdout); continue; }
        int ai = 0, bi = 0;
        unsigned a = 0, b = 0;
        if (!strcmp(op, "step") && sscanf(line, "%*s %i %i", &ai, &bi) == 2 &&
            ai >= 0 && ai < 1024 && bi >= 0 && bi <= 100000) {
            core->setKeys(core, (unsigned) ai);
            for (int i = 0; i < bi; ++i) { core->runFrame(core); drain(core); }
            core->setKeys(core, 0);
            frames += (unsigned) bi;
            printf("OK %llu\n", frames);
        } else if (!strcmp(op, "read") && sscanf(line, "%*s %i %i", &ai, &bi) == 2 &&
                   ai >= 0 && bi > 0 && bi <= 65536) {
            a = (unsigned) ai; b = (unsigned) bi;
            printf("OK ");
            for (unsigned i = 0; i < b; ++i) printf("%02x", (unsigned) core->busRead8(core, a + i));
            putchar('\n');
        } else if (!strcmp(op, "read32") && sscanf(line, "%*s %i", &ai) == 1 && ai >= 0) {
            printf("OK %08x\n", (unsigned) core->busRead32(core, (unsigned) ai));
        } else if (!strcmp(op, "blocks")) {
            const struct mCoreMemoryBlock* blocks = NULL;
            size_t n = core->listMemoryBlocks(core, &blocks);
            printf("OK");
            for (size_t i = 0; i < n; ++i) {
                const struct mCoreMemoryBlock* bl = &blocks[i];
                printf("%s%s,%08x,%x,%x", i ? ";" : "",
                       bl->shortName ? bl->shortName : "?", bl->start, bl->size, bl->flags);
            }
            putchar('\n');
        } else if (!strcmp(op, "snap") && sscanf(line, "%*s %i %i %255s", &ai, &bi, name) == 3 &&
                   ai >= 0 && bi > 0 && (size_t) bi <= sizeof(rbuf)) {
            a = (unsigned) ai; b = (unsigned) bi;
            snprintf(path, sizeof(path), "%s/%s.bin", outdir, name);
            FILE* f = fopen(path, "wb");
            int ok = f != NULL;
            if (f) {
                for (unsigned i = 0; i < b; ++i) rbuf[i] = (unsigned char) core->busRead8(core, a + i);
                ok = fwrite(rbuf, 1, b, f) == b;
                if (fclose(f)) ok = 0;
            }
            printf(ok ? "OK %u\n" : "ERR snap\n", b);
        } else if (!strcmp(op, "shot") && sscanf(line, "%*s %255s", name) == 1) {
            snprintf(path, sizeof(path), "%s/%s.rgba", outdir, name);
            FILE* f = fopen(path, "wb");
            int ok = f != NULL;
            if (f) {
                unsigned char row[240 * 4];
                for (int y = 0; y < 160 && ok; ++y) {
                    for (int x = 0; x < 240; ++x) {
                        color_t c = pixels[y * 240 + x];
                        row[x*4] = c & 255; row[x*4+1] = (c >> 8) & 255;
                        row[x*4+2] = (c >> 16) & 255; row[x*4+3] = 255;
                    }
                    if (fwrite(row, 1, sizeof(row), f) != sizeof(row)) ok = 0;
                }
                if (fclose(f)) ok = 0;
            }
            puts(ok ? "OK shot" : "ERR shot");
        } else if (!strcmp(op, "writemem") && sscanf(line, "%*s %i %i %4096s", &ai, &bi, hex) == 3 &&
                   ai >= 0 && bi > 0 && bi <= 2048 && (size_t) bi * 2 == strlen(hex)) {
            a = (unsigned) ai; b = (unsigned) bi;
            int valid = (a >= 0x02000000 && a <= 0x02040000 - b) || (a >= 0x03000000 && a <= 0x03008000 - b);
            for (unsigned i = 0; valid && i < b * 2; ++i)
                if (!((hex[i] >= '0' && hex[i] <= '9') || (hex[i] >= 'a' && hex[i] <= 'f'))) valid = 0;
            if (!valid) { puts("ERR write"); }
            else {
                for (unsigned i = 0; i < b; ++i) {
                    char byte[3] = {hex[2*i], hex[2*i+1], 0};
                    core->busWrite8(core, a + i, strtoul(byte, NULL, 16));
                }
                puts("OK written");
            }
        } else if ((!strcmp(op, "save") || !strcmp(op, "load")) && sscanf(line, "%*s %4095s", path) == 1) {
            int saving = !strcmp(op, "save");
            struct VFile* vf = VFileOpen(path, saving ? O_CREAT | O_TRUNC | O_RDWR : O_RDONLY);
            int flags = SAVESTATE_SAVEDATA | SAVESTATE_RTC | SAVESTATE_METADATA;
            int ok = vf && (saving ? mCoreSaveStateNamed(core, vf, flags) : mCoreLoadStateNamed(core, vf, flags));
            if (vf) vf->close(vf);
            puts(ok ? "OK state" : "ERR state");
        } else if (!strcmp(op, "reset")) {
            core->reset(core); frames = 0; puts("OK reset");
        } else if (!strcmp(op, "regs")) {
            const struct mCoreRegisterInfo* regs = NULL;
            size_t n = core->listRegisters(core, &regs);
            printf("OK");
            for (size_t i = 0; i < n; ++i) {
                uint32_t v = 0;
                if (core->readRegister(core, regs[i].name, &v))
                    printf(" %s=%08x", regs[i].name, v);
            }
            putchar('\n');
        } else if (!strcmp(op, "version")) {
            printf("OK %s %d %d\n", projectVersion, core->frequency(core), core->frameCycles(core));
        } else if (!strcmp(op, "close")) { puts("OK close"); fflush(stdout); break; }
        else puts("ERR command");
        fflush(stdout);
    }
    core->deinit(core); free(pixels);
    return 0;
}
