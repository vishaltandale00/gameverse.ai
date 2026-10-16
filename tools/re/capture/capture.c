/* gameverse GBA capture harness.
 *
 * Headless libmgba (0.10.x) runner that executes scripted phases of a ROM and
 * records evidence for the GBA component ontology: keyframes, per-frame video
 * register telemetry, raster/HBlank-DMA usage, sound mechanism, HLE BIOS SWI
 * calls, executed-code coverage, end-of-phase savestate and RAM dumps, and a
 * 16 kHz mono WAV.
 *
 * One process handles one ROM; phases always start from a fresh core (cold
 * boot via mGBA's HLE BIOS with skip-BIOS). See README.md for usage.
 */
#include <mgba/flags.h>
#include <mgba/core/blip_buf.h>
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba/core/version.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/gba/gba.h>
#include <mgba-util/vfs.h>

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

#ifndef HARNESS_SRC_SHA
#define HARNESS_SRC_SHA "unknown"
#endif
#define HARNESS_VERSION "0.2.0"

#define W 240
#define H 160
#define CYCLES_PER_FRAME 280896
#define GBA_CLOCK 16777216
#define WAV_RATE 16000

/* ------------------------------------------------------------------ */
/* Register groups used for raster classification                      */
enum { G_CTRL, G_SCROLL, G_AFFINE, G_WINDOW, G_MOSAIC, G_BLEND, G_PALETTE, G_OTHER, G_COUNT };
static const char* const GROUP_NAMES[G_COUNT] = {
	"dispcnt_bgcnt", "bg_scroll", "bg_affine", "window", "mosaic", "blend", "palette", "other"
};

static int ioGroup(uint32_t off) {
	if (off < 0x10) return G_CTRL;
	if (off < 0x20) return G_SCROLL;
	if (off < 0x40) return G_AFFINE;
	if (off < 0x4C) return G_WINDOW;
	if (off < 0x50) return G_MOSAIC;
	if (off < 0x58) return G_BLEND;
	return G_OTHER;
}

static const char* const SWI_NAMES[0x2B] = {
	"SoftReset", "RegisterRamReset", "Halt", "Stop", "IntrWait", "VBlankIntrWait", "Div", "DivArm",
	"Sqrt", "ArcTan", "ArcTan2", "CpuSet", "CpuFastSet", "GetBiosChecksum", "BgAffineSet", "ObjAffineSet",
	"BitUnPack", "LZ77UnCompWram", "LZ77UnCompVram", "HuffUnComp", "RLUnCompWram", "RLUnCompVram",
	"Diff8bitUnFilterWram", "Diff8bitUnFilterVram", "Diff16bitUnFilter", "SoundBias", "SoundDriverInit",
	"SoundDriverMode", "SoundDriverMain", "SoundDriverVSync", "SoundChannelClear", "MidiKey2Freq",
	"SoundWhatever0", "SoundWhatever1", "SoundWhatever2", "SoundWhatever3", "SoundWhatever4",
	"MultiBoot", "HardReset", "CustomHalt", "SoundDriverVSyncOff", "SoundDriverVSyncOn", "SoundGetJumpList"
};

static const char* const KEY_NAMES[10] = { "A", "B", "SELECT", "START", "RIGHT", "LEFT", "UP", "DOWN", "R", "L" };

/* ------------------------------------------------------------------ */
/* Options                                                              */
struct PhaseSpec {
	char name[32];
	int frames;
	char* inputs; /* "frame:hold:KEY+KEY,..." */
};

static struct {
	const char* rom;
	const char* out;
	struct PhaseSpec phases[8];
	int nPhases;
	int coverage;
	int png;
	int mp4;
	int wav;
	int keyframeInterval;
	double sceneThreshold;
	int sceneMinGap;
	int64_t rtcMs;
	int assetTraceLimit;
	uint32_t assetSnapshotMax;
} opt = { .coverage = 1, .png = 1, .mp4 = 0, .wav = 1, .keyframeInterval = 120, .sceneThreshold = 18.0,
	      .sceneMinGap = 30, .rtcMs = 1704067200000LL, .assetTraceLimit = 64, .assetSnapshotMax = 0 };

/* ------------------------------------------------------------------ */
/* Per-phase state                                                      */
struct DmaConfig {
	int ch;
	uint32_t src, dst;
	int count, timing, repeat, width, dstGroup;
	int setups;
	int firstFrame;
};

struct CovRegion {
	uint32_t base;
	uint32_t size; /* bytes */
	uint32_t* hits; /* per halfword */
	uint8_t* flags; /* bit0 thumb, bit1 arm, bit2 block start, bit3 call target */
};
enum { CF_THUMB = 1, CF_ARM = 2, CF_BLOCK = 4, CF_CALL = 8 };

struct LoadedAsset {
	uint32_t source, destination, romOffset, header, outputLength;
	uint32_t firstPcRaw, firstLrRaw, lastPcRaw, lastLrRaw;
	int firstThumb, lastThumb;
	int swi, firstFrame, lastFrame, calls, romValid, headerValid;
	int snapshotStatus; /* 0 disabled, 1 saved, 2 size limit, 3 destination unsupported, 4 IO failure */
	char snapshot[48];
};

static struct Phase {
	struct mCore* core;
	struct GBA* gba;
	struct ARMCore* cpu;
	int frame;

	/* hooks */
	void (*origStore8)(struct ARMCore*, uint32_t, int8_t, int*);
	void (*origStore16)(struct ARMCore*, uint32_t, int16_t, int*);
	void (*origStore32)(struct ARMCore*, uint32_t, int32_t, int*);
	uint32_t (*origStoreMultiple)(struct ARMCore*, uint32_t, int, enum LSMDirection, int*);
	void (*origSwi16)(struct ARMCore*, int);
	void (*origSwi32)(struct ARMCore*, int);

	/* per-frame raster accumulation: bitmaps of scanlines (0..227) */
	uint64_t hdmaLines[G_COUNT][4];
	uint64_t cpuLines[G_COUNT][4];
	uint32_t fifoWrites[2];
	uint32_t psgTriggers[4];

	/* phase totals */
	uint64_t swi[256];
	uint64_t swiTotal;
	struct LoadedAsset* assets;
	int assetCount;
	uint64_t assetCalls, assetDroppedCalls, assetSnapshotBytes;
	char assetDir[1024];
	uint64_t modeFrames[8];
	uint64_t bgFrames[4], objFrames, win0Frames, win1Frames, objwinFrames;
	uint64_t blendFrames[4];
	uint64_t mosaicFrames;
	uint64_t affineBgFrames, affineBgTransformedFrames;
	uint64_t bitmapPageFlips;
	uint64_t forcedBlankFrames;
	int maxObjActive, maxObjVisible, maxObjAffine;
	uint64_t objAffineFrames;
	int sizeMax[12];
	uint64_t sizeTotal[12];
	uint64_t hdmaFrames[G_COUNT], hdmaFramesStrong[G_COUNT], cpuRasterFrames[G_COUNT];
	uint64_t hdmaWrites[G_COUNT];
	int maxHdmaLines[G_COUNT], maxCpuLines[G_COUNT];
	uint64_t hblankIrqFrames, vcountIrqFrames;
	uint64_t hblankDmaEnabledFrames;
	struct DmaConfig dmaCfg[64];
	int nDmaCfg;
	int dmaCfgOverflow;

	/* sound */
	uint64_t dsFrames[2], psgFrames[4], soundMasterFrames;
	uint64_t fifoWritesTotal[2], psgTriggersTotal[4];
	struct { int rate; uint64_t frames; } rates[16];
	int nRates;
	uint64_t wavSamples;
	double wavSumSq;
	int wavPeak;

	/* frame capture */
	color_t* fb;
	uint8_t sig[30 * 20], lastSig[30 * 20];
	int lastKeyframe;
	int nKeyframes, nSceneKeyframes;
	FILE* mp4;

	/* telemetry */
	FILE* tele;
	char lastRow[512];
	int teleRows;
	FILE* audioEv;
	char lastAudioRow[128];
	int audioRows;
	FILE* wavf;

	/* coverage */
	struct CovRegion cov[3];
	uint64_t instructions;
	uint64_t stuckFrames;

	/* logging */
	uint64_t logCount[8];
	char errors[10][256];
	int nErrors;
	char samples[8][256]; /* first distinct-ish GAME_ERROR/WARN messages, for diagnosis */
	int nSamples;
} P;

/* ------------------------------------------------------------------ */
/* Logging                                                              */
static void logHandler(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger;
	int idx = 0;
	switch (level) {
	case mLOG_FATAL: idx = 0; break;
	case mLOG_ERROR: idx = 1; break;
	case mLOG_WARN: idx = 2; break;
	case mLOG_INFO: idx = 3; break;
	case mLOG_DEBUG: idx = 4; break;
	case mLOG_STUB: idx = 5; break;
	case mLOG_GAME_ERROR: idx = 6; break;
	default: idx = 7; break;
	}
	P.logCount[idx]++;
	if ((level == mLOG_GAME_ERROR || level == mLOG_WARN) && P.nSamples < 8) {
		char msg[200];
		vsnprintf(msg, sizeof(msg), format, args);
		int dup = 0;
		for (int i = 0; i < P.nSamples; ++i)
			if (strstr(P.samples[i], msg)) dup = 1;
		if (!dup)
			snprintf(P.samples[P.nSamples++], sizeof(P.samples[0]), "frame %d [%s] %s", P.frame,
			         mLogCategoryName(category) ? mLogCategoryName(category) : "?", msg);
		return;
	}
	if ((level == mLOG_FATAL || level == mLOG_ERROR) && P.nErrors < 10) {
		char msg[200];
		vsnprintf(msg, sizeof(msg), format, args);
		snprintf(P.errors[P.nErrors++], sizeof(P.errors[0]), "frame %d [%s] %s", P.frame,
		         mLogCategoryName(category) ? mLogCategoryName(category) : "?", msg);
	}
}
static struct mLogger logger = { .log = logHandler, .filter = NULL };

/* ------------------------------------------------------------------ */
/* JSON helpers                                                         */
static void jsonStr(FILE* f, const char* s) {
	fputc('"', f);
	for (; *s; ++s) {
		unsigned char c = (unsigned char) *s;
		if (c == '"' || c == '\\') {
			fputc('\\', f);
			fputc(c, f);
		} else if (c < 0x20) {
			fprintf(f, "\\u%04x", c);
		} else {
			fputc(c, f);
		}
	}
	fputc('"', f);
}

static void mkdirs(const char* path) {
	char tmp[1024];
	snprintf(tmp, sizeof(tmp), "%s", path);
	for (char* p = tmp + 1; *p; ++p) {
		if (*p == '/') {
			*p = 0;
			mkdir(tmp, 0755);
			*p = '/';
		}
	}
	mkdir(tmp, 0755);
}

static double nowSec(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec + ts.tv_nsec * 1e-9;
}

static inline void setLine(uint64_t* bm, int line) {
	if (line >= 0 && line < 256) bm[line >> 6] |= 1ULL << (line & 63);
}
static inline int countVisibleLines(const uint64_t* bm) {
	/* lines 0..159 */
	return __builtin_popcountll(bm[0]) + __builtin_popcountll(bm[1]) + __builtin_popcountll(bm[2] & 0xFFFFFFFFULL);
}

/* ------------------------------------------------------------------ */
/* Bus hooks                                                            */
static void noteDmaConfig(int ch) {
	struct GBADMA* d = &P.gba->memory.dma[ch];
	uint16_t reg = d->reg;
	if (!(reg & 0x8000)) return;
	int timing = (reg >> 12) & 3;
	if (timing == 0 || timing == 1) return; /* immediate / vblank are not raster */
	uint32_t dst = d->dest;
	int grp;
	if ((dst >> 24) == 4) grp = ioGroup(dst & 0x3FF);
	else if ((dst >> 24) == 5) grp = G_PALETTE;
	else grp = G_OTHER;
	for (int i = 0; i < P.nDmaCfg; ++i) {
		struct DmaConfig* c = &P.dmaCfg[i];
		if (c->ch == ch && c->dst == dst && c->timing == timing && c->src == d->source) {
			c->setups++;
			return;
		}
	}
	if (P.nDmaCfg >= 64) {
		P.dmaCfgOverflow++;
		return;
	}
	struct DmaConfig* c = &P.dmaCfg[P.nDmaCfg++];
	c->ch = ch;
	c->src = d->source;
	c->dst = dst;
	c->count = d->count;
	c->timing = timing;
	c->repeat = (reg >> 9) & 1;
	c->width = (reg & 0x400) ? 32 : 16;
	c->dstGroup = grp;
	c->setups = 1;
	c->firstFrame = P.frame;
}

/* Called after any 16-bit chunk of an IO-region store has been applied. */
static void onIOWrite16(uint32_t off, uint16_t value, uint16_t byteMask) {
	int dma = P.gba->performingDMA;
	if (off < 0x60) {
		int line = P.gba->video.vcount;
		int grp = ioGroup(off);
		if (dma) {
			int ch = (dma >> 1) & 3;
			if (((P.gba->memory.dma[ch].reg >> 12) & 3) == 2) {
				setLine(P.hdmaLines[grp], line);
				P.hdmaWrites[grp]++;
			}
		} else if (line < 160) {
			setLine(P.cpuLines[grp], line);
		}
		return;
	}
	if (off < 0xA0) {
		/* PSG trigger bits: NR14/NR24/NR34/NR44 bit 15 */
		if ((byteMask & 0xFF00) && (value & 0x8000)) {
			switch (off) {
			case 0x64: P.psgTriggers[0]++; break;
			case 0x6C: P.psgTriggers[1]++; break;
			case 0x74: P.psgTriggers[2]++; break;
			case 0x7C: P.psgTriggers[3]++; break;
			}
		}
		return;
	}
	if (off < 0xA8) {
		P.fifoWrites[off >= 0xA4]++;
		return;
	}
	switch (off) {
	case 0xBA: noteDmaConfig(0); break;
	case 0xC6: noteDmaConfig(1); break;
	case 0xD2: noteDmaConfig(2); break;
	case 0xDE: noteDmaConfig(3); break;
	}
}

static inline void notePaletteWrite(void) {
	int dma = P.gba->performingDMA;
	int line = P.gba->video.vcount;
	if (dma) {
		int ch = (dma >> 1) & 3;
		if (((P.gba->memory.dma[ch].reg >> 12) & 3) == 2) {
			setLine(P.hdmaLines[G_PALETTE], line);
			P.hdmaWrites[G_PALETTE]++;
		}
	} else if (line < 160) {
		setLine(P.cpuLines[G_PALETTE], line);
	}
}

static void hookStore8(struct ARMCore* cpu, uint32_t address, int8_t value, int* cycles) {
	P.origStore8(cpu, address, value, cycles);
	uint32_t region = address >> 24;
	if (region == 4) {
		uint32_t off = address & 0x3FF;
		uint16_t v = (uint8_t) value;
		onIOWrite16(off & ~1u, (off & 1) ? (uint16_t)(v << 8) : v, (off & 1) ? 0xFF00 : 0x00FF);
	} else if (region == 5) {
		notePaletteWrite();
	}
}

static void hookStore16(struct ARMCore* cpu, uint32_t address, int16_t value, int* cycles) {
	P.origStore16(cpu, address, value, cycles);
	uint32_t region = address >> 24;
	if (region == 4) {
		onIOWrite16(address & 0x3FE, (uint16_t) value, 0xFFFF);
	} else if (region == 5) {
		notePaletteWrite();
	}
}

static void hookStore32(struct ARMCore* cpu, uint32_t address, int32_t value, int* cycles) {
	P.origStore32(cpu, address, value, cycles);
	uint32_t region = address >> 24;
	if (region == 4) {
		uint32_t off = address & 0x3FC;
		onIOWrite16(off, (uint16_t) value, 0xFFFF);
		onIOWrite16(off + 2, (uint16_t)((uint32_t) value >> 16), 0xFFFF);
	} else if (region == 5) {
		notePaletteWrite();
	}
}

static uint32_t hookStoreMultiple(struct ARMCore* cpu, uint32_t base, int mask, enum LSMDirection dir, int* cycles) {
	uint32_t r = P.origStoreMultiple(cpu, base, mask, dir, cycles);
	uint32_t region = base >> 24;
	if (region == 4) {
		int n = __builtin_popcount(mask & 0xFFFF);
		uint32_t start = base & ~3u;
		if (dir & LSM_D) start = start - 4 * n + ((dir & LSM_B) ? 0 : 4);
		else if (dir & LSM_B) start += 4;
		for (int i = 0; i < n; ++i) {
			uint32_t off = (start + 4 * i) & 0x3FC;
			const uint16_t* io = P.gba->memory.io;
			onIOWrite16(off, io[off >> 1], 0xFFFF);
			onIOWrite16(off + 2, io[(off + 2) >> 1], 0xFFFF);
		}
	} else if (region == 5) {
		notePaletteWrite();
	}
	return r;
}

/* Read only native ROM bytes here: bus loads would alter emulated timing/state.
 * mGBA 0.10.5 HLE _unLz77 consumes r0/r1 synchronously before its BIOS stall.
 * These are observed decompression uses, not a classification of the payload. */
static int assetBeforeSwi(struct ARMCore* cpu, int swi) {
	if (!opt.assetTraceLimit || (swi != 0x11 && swi != 0x12)) return -1;
	P.assetCalls++;
	uint32_t source = (uint32_t) cpu->gprs[0], destination = (uint32_t) cpu->gprs[1];
	for (int i = 0; i < P.assetCount; ++i) {
		struct LoadedAsset* a = &P.assets[i];
		if (a->source == source && a->destination == destination && a->swi == swi) {
			a->calls++;
			a->lastFrame = P.frame;
			a->lastPcRaw = (uint32_t) cpu->gprs[ARM_PC];
			a->lastLrRaw = (uint32_t) cpu->gprs[ARM_LR];
			a->lastThumb = cpu->executionMode == MODE_THUMB;
			return -1; /* first-use snapshot only; repeated uses remain counted */
		}
	}
	if (!P.assets || P.assetCount >= opt.assetTraceLimit) {
		P.assetDroppedCalls++;
		return -1;
	}
	int index = P.assetCount++;
	struct LoadedAsset* a = &P.assets[index];
	a->source = source; a->destination = destination; a->swi = swi;
	a->firstFrame = a->lastFrame = P.frame; a->calls = 1;
	a->firstPcRaw = a->lastPcRaw = (uint32_t) cpu->gprs[ARM_PC];
	a->firstLrRaw = a->lastLrRaw = (uint32_t) cpu->gprs[ARM_LR];
	a->firstThumb = a->lastThumb = cpu->executionMode == MODE_THUMB;
	a->romOffset = source & 0x01FFFFFF;
	a->romValid = source >= 0x08000000 && source < 0x0E000000 &&
	              (uint64_t) a->romOffset + 4 <= P.gba->memory.romSize;
	if (a->romValid) {
		const uint8_t* bytes = (const uint8_t*) P.gba->memory.rom + a->romOffset;
		a->header = (uint32_t) bytes[0] | ((uint32_t) bytes[1] << 8) |
		            ((uint32_t) bytes[2] << 16) | ((uint32_t) bytes[3] << 24);
		a->outputLength = a->header >> 8;
		a->headerValid = (a->header & 0xFF) == 0x10 && a->outputLength > 0;
	}
	return index;
}

static void assetAfterSwi(int index) {
	if (index < 0 || !opt.assetSnapshotMax) return;
	struct LoadedAsset* a = &P.assets[index];
	if (!a->headerValid) { a->snapshotStatus = 3; return; }
	if (a->outputLength > opt.assetSnapshotMax) { a->snapshotStatus = 2; return; }
	const uint8_t* memory = NULL;
	uint32_t base = 0, size = 0;
	switch (a->destination >> 24) {
	case 2: base = 0x02000000; size = 0x40000; memory = (const uint8_t*) P.gba->memory.wram; break;
	case 3: base = 0x03000000; size = 0x8000; memory = (const uint8_t*) P.gba->memory.iwram; break;
	case 6: base = 0x06000000; size = 0x18000; memory = (const uint8_t*) P.gba->video.vram; break;
	}
	if (!memory || a->destination < base || (uint64_t) a->destination - base + a->outputLength > size) {
		a->snapshotStatus = 3; return;
	}
	char path[1200];
	snprintf(a->snapshot, sizeof(a->snapshot), "asset_%04d.bin", index);
	snprintf(path, sizeof(path), "%s/%s", P.assetDir, a->snapshot);
	FILE* file = fopen(path, "wb");
	if (!file) { a->snapshotStatus = 4; return; }
	size_t written = fwrite(memory + (a->destination - base), 1, a->outputLength, file);
	int closed = fclose(file);
	if (written != a->outputLength || closed != 0) { a->snapshotStatus = 4; return; }
	a->snapshotStatus = 1;
	P.assetSnapshotBytes += written;
}

static int writeLoadedAssets(const char* dir, const char* phase) {
	if (!opt.assetTraceLimit) return 0;
	char path[1200]; snprintf(path, sizeof(path), "%s/loaded_assets.jsonl", dir);
	FILE* file = fopen(path, "w"); if (!file) return 0;
	static const char* statuses[] = { "disabled", "saved", "output_limit", "unsupported_header_or_destination", "io_error" };
	for (int i = 0; i < P.assetCount; ++i) {
		struct LoadedAsset* a = &P.assets[i];
		fprintf(file, "{\"phase\":"); jsonStr(file, phase);
		fprintf(file, ",\"swi\":%d,\"source\":\"0x%08x\",\"destination\":\"0x%08x\","
		              "\"first_frame\":%d,\"last_frame\":%d,\"calls\":%d,\"source_rom_valid\":%s,"
		              "\"header_valid\":%s,\"rom_offset\":", a->swi, a->source, a->destination,
		        a->firstFrame, a->lastFrame, a->calls, a->romValid ? "true" : "false", a->headerValid ? "true" : "false");
		if (a->romValid) fprintf(file, "%u,\"native_header\":\"0x%08x\",\"output_length\":%u", a->romOffset, a->header, a->outputLength);
		else fprintf(file, "null,\"native_header\":null,\"output_length\":null");
		fprintf(file, ",\"first_context\":{\"pc_raw\":\"0x%08x\",\"lr_raw\":\"0x%08x\",\"mode\":\"%s\"},"
		              "\"last_context\":{\"pc_raw\":\"0x%08x\",\"lr_raw\":\"0x%08x\",\"mode\":\"%s\"},"
		              "\"context_note\":\"pre-HLE raw registers; prefetch/return normalization unverified; intermediate callers not retained\"",
		        a->firstPcRaw, a->firstLrRaw, a->firstThumb ? "thumb" : "arm",
		        a->lastPcRaw, a->lastLrRaw, a->lastThumb ? "thumb" : "arm");
		fprintf(file, ",\"snapshot_status\":"); jsonStr(file, statuses[a->snapshotStatus]);
		fprintf(file, ",\"snapshot\":"); if (a->snapshotStatus == 1) jsonStr(file, a->snapshot); else fprintf(file, "null");
		fprintf(file, ",\"evidence\":\"observed BIOS LZ77 call; format/use classification pending\"}\n");
	}
	return fclose(file) == 0;
}

static void hookSwi16(struct ARMCore* cpu, int immediate) {
	P.swi[immediate & 0xFF]++;
	if ((immediate & 0xFF) != 0xF0) P.swiTotal++; /* 0xF0: mGBA HLE BIOS internal stall hook */
	int asset = assetBeforeSwi(cpu, immediate & 0xFF);
	P.origSwi16(cpu, immediate);
	assetAfterSwi(asset);
}

static void hookSwi32(struct ARMCore* cpu, int immediate) {
	/* GBASwi32 forwards to GBASwi16 directly (not through irqh), so no double count. */
	P.swi[(immediate >> 16) & 0xFF]++;
	if (((immediate >> 16) & 0xFF) != 0xF0) P.swiTotal++;
	int asset = assetBeforeSwi(cpu, (immediate >> 16) & 0xFF);
	P.origSwi32(cpu, immediate);
	assetAfterSwi(asset);
}

static void installHooks(void) {
	struct ARMCore* cpu = P.cpu;
	if (cpu->memory.store16 != hookStore16) {
		P.origStore8 = cpu->memory.store8;
		P.origStore16 = cpu->memory.store16;
		P.origStore32 = cpu->memory.store32;
		P.origStoreMultiple = cpu->memory.storeMultiple;
		cpu->memory.store8 = hookStore8;
		cpu->memory.store16 = hookStore16;
		cpu->memory.store32 = hookStore32;
		cpu->memory.storeMultiple = hookStoreMultiple;
	}
	if (cpu->irqh.swi16 != hookSwi16) {
		P.origSwi16 = cpu->irqh.swi16;
		P.origSwi32 = cpu->irqh.swi32;
		cpu->irqh.swi16 = hookSwi16;
		cpu->irqh.swi32 = hookSwi32;
	}
}

/* ------------------------------------------------------------------ */
/* Coverage                                                             */
static void covInit(void) {
	uint32_t romSize = (uint32_t) P.gba->memory.romSize;
	if (!romSize) romSize = 0x02000000;
	P.cov[0] = (struct CovRegion) { 0x08000000, romSize, NULL, NULL };
	P.cov[1] = (struct CovRegion) { 0x02000000, 0x40000, NULL, NULL };
	P.cov[2] = (struct CovRegion) { 0x03000000, 0x8000, NULL, NULL };
	for (int i = 0; i < 3; ++i) {
		P.cov[i].hits = calloc(P.cov[i].size / 2, sizeof(uint32_t));
		P.cov[i].flags = calloc(P.cov[i].size / 2, 1);
	}
}

static void covFree(void) {
	for (int i = 0; i < 3; ++i) {
		free(P.cov[i].hits);
		free(P.cov[i].flags);
		P.cov[i].hits = NULL;
		P.cov[i].flags = NULL;
	}
}

static inline struct CovRegion* covLookup(uint32_t pc, uint32_t* idx) {
	switch (pc >> 24) {
	case 0x8: case 0x9: case 0xA: case 0xB: case 0xC: case 0xD: {
		uint32_t o = pc & 0x01FFFFFF;
		if (o >= P.cov[0].size) return NULL;
		*idx = o >> 1;
		return &P.cov[0];
	}
	case 0x2:
		*idx = (pc & 0x3FFFF) >> 1;
		return &P.cov[1];
	case 0x3:
		*idx = (pc & 0x7FFF) >> 1;
		return &P.cov[2];
	default:
		return NULL;
	}
}

static uint32_t covPrevPc = 0xFFFFFFFF;
static int covPrevThumb = 0;
static uint32_t covLastLr = 0;
static uint64_t covLrSetAt = 0;
static uint64_t covCount = 0;
static uint32_t covNext[3]; /* pc+width of the last three executed instructions (any region) */

/* Run one frame by single-stepping the CPU and recording each instruction's
 * address. Replicates mCore runFrame's termination conditions. */
static void runFrameCoverage(void) {
	struct ARMCore* cpu = P.cpu;
	struct GBA* gba = P.gba;
	uint32_t fc = gba->video.frameCounter;
	int32_t startCycle = mTimingCurrentTime(&gba->timing);
	uint64_t n = 0;
	uint64_t count = covCount;
	while (gba->video.frameCounter == fc) {
		while (cpu->cycles >= cpu->nextEvent) {
			cpu->irqh.processEvents(cpu);
		}
		if (gba->video.frameCounter != fc) break;
		int thumb = cpu->executionMode == MODE_THUMB;
		uint32_t pc = (uint32_t) cpu->gprs[ARM_PC] - (thumb ? 2 : 4);
		uint32_t lr = (uint32_t) cpu->gprs[ARM_LR];
		if (lr != covLastLr) {
			covLastLr = lr;
			covLrSetAt = count;
		}
		uint32_t idx;
		struct CovRegion* r = covLookup(pc, &idx);
		if (r) {
			r->hits[idx]++;
			uint8_t f = r->flags[idx] | (thumb ? CF_THUMB : CF_ARM);
			uint32_t seq = covPrevPc + (covPrevThumb ? 2 : 4);
			if (pc != seq || thumb != covPrevThumb) {
				f |= CF_BLOCK;
				/* Call target: LR was rewritten by one of the previous two instructions (BL/BLX,
				 * "mov lr,pc; bx rN", or "bl veneer; bx rN") and this is not a return to LR. */
				uint32_t ret = lr & ~1u;
				if (count - covLrSetAt <= 2 && pc != ret && (ret == covNext[0] || ret == covNext[1] || ret == covNext[2]))
					f |= CF_CALL;
			}
			r->flags[idx] = f;
		}
		covPrevPc = pc;
		covPrevThumb = thumb;
		covNext[2] = covNext[1];
		covNext[1] = covNext[0];
		covNext[0] = pc + (thumb ? 2 : 4);
		ARMRun(cpu);
		++n;
		++count;
		if (!(n & 0x3FF) && mTimingCurrentTime(&gba->timing) - startCycle >= CYCLES_PER_FRAME + 1232) {
			P.stuckFrames++;
			break;
		}
	}
	P.instructions += n;
	covCount = count;
}

static void writeCoverage(const char* path, const char* phase) {
	FILE* f = fopen(path, "w");
	if (!f) return;
	static const char* const names[3] = { "rom", "ewram", "iwram" };
	uint64_t uniq = 0, blocks = 0, calls = 0;
	for (int i = 0; i < 3; ++i) {
		struct CovRegion* r = &P.cov[i];
		for (uint32_t j = 0; j < r->size / 2; ++j) {
			if (!r->hits[j]) continue;
			uniq++;
			if (r->flags[j] & CF_BLOCK) blocks++;
			if (r->flags[j] & CF_CALL) calls++;
		}
	}
	fprintf(f, "{\"phase\":");
	jsonStr(f, phase);
	fprintf(f, ",\"method\":\"single-step ARMRun with direct-mapped per-halfword hit counters\"");
	fprintf(f, ",\"notes\":\"addresses are pre-execution PC; ROM mirrors folded to 0x08000000; RAM code may be overlaid so RAM entries can mix routines; call targets = non-sequential entry where LR was written by one of the last 2 instructions and points just past one of the last 3 executed instructions (BL/BLX, mov lr,pc;bx, bl-to-bx veneer), excluding returns to LR\"");
	fprintf(f, ",\"instructions_executed\":%llu,\"unique_instructions\":%llu,\"blocks\":%llu,\"call_targets\":%llu",
	        (unsigned long long) P.instructions, (unsigned long long) uniq, (unsigned long long) blocks,
	        (unsigned long long) calls);
	fprintf(f, ",\"block_format\":[\"addr\",\"mode\",\"entry_hits\",\"bytes\",\"max_hits\"],\"function_format\":[\"addr\",\"mode\",\"hits\"]");
	fprintf(f, ",\"regions\":{");
	for (int i = 0; i < 3; ++i) {
		struct CovRegion* r = &P.cov[i];
		fprintf(f, "%s\"%s\":{\"functions\":[", i ? "," : "", names[i]);
		int first = 1;
		for (uint32_t j = 0; j < r->size / 2; ++j) {
			if (!r->hits[j] || !(r->flags[j] & CF_CALL)) continue;
			fprintf(f, "%s[\"0x%08x\",\"%c\",%u]", first ? "" : ",", r->base + j * 2,
			        (r->flags[j] & CF_THUMB) ? 'T' : 'A', r->hits[j]);
			first = 0;
		}
		fprintf(f, "],\"blocks\":[");
		first = 1;
		uint32_t j = 0, n = r->size / 2;
		while (j < n) {
			if (!r->hits[j]) {
				++j;
				continue;
			}
			uint32_t start = j;
			uint8_t mode = r->flags[j] & (CF_THUMB | CF_ARM);
			int step = (mode & CF_THUMB) ? 1 : 2;
			uint32_t maxHits = r->hits[j];
			j += step;
			while (j < n && r->hits[j] && !(r->flags[j] & CF_BLOCK) && (r->flags[j] & (CF_THUMB | CF_ARM)) == mode) {
				if (r->hits[j] > maxHits) maxHits = r->hits[j];
				j += step;
			}
			fprintf(f, "%s[\"0x%08x\",\"%c\",%u,%u,%u]", first ? "" : ",", r->base + start * 2,
			        (mode & CF_THUMB) ? 'T' : 'A', r->hits[start], (j - start) * 2, maxHits);
			first = 0;
		}
		fprintf(f, "]}");
	}
	fprintf(f, "}}\n");
	fclose(f);
}

/* ------------------------------------------------------------------ */
/* Frame capture                                                        */
static void computeSig(uint8_t* sig) {
	for (int by = 0; by < 20; ++by) {
		for (int bx = 0; bx < 30; ++bx) {
			unsigned acc = 0;
			for (int k = 0; k < 4; ++k) {
				color_t c = P.fb[(by * 8 + 2 + (k >> 1) * 4) * W + bx * 8 + 2 + (k & 1) * 4];
				acc += (c & 0xFF) + 2 * ((c >> 8) & 0xFF) + ((c >> 16) & 0xFF);
			}
			sig[by * 30 + bx] = (uint8_t)(acc / 16);
		}
	}
}

static void saveKeyframe(const char* dir, int scene) {
	char path[1200];
	snprintf(path, sizeof(path), "%s/keyframes/f%06d%s.png", dir, P.frame, scene ? "_scene" : "");
	struct VFile* vf = VFileOpen(path, O_CREAT | O_TRUNC | O_WRONLY);
	if (vf) {
		mCoreTakeScreenshotVF(P.core, vf);
		vf->close(vf);
	}
	memcpy(P.lastSig, P.sig, sizeof(P.sig));
	P.lastKeyframe = P.frame;
	P.nKeyframes++;
	if (scene) P.nSceneKeyframes++;
}

static void captureFrame(const char* dir) {
	computeSig(P.sig);
	if (P.mp4) fwrite(P.fb, sizeof(color_t), W * H, P.mp4);
	if (!opt.png) return;
	if (P.frame == 0 || P.frame - P.lastKeyframe >= opt.keyframeInterval) {
		saveKeyframe(dir, 0);
		return;
	}
	if (P.frame - P.lastKeyframe < opt.sceneMinGap) return;
	unsigned diff = 0;
	for (size_t i = 0; i < sizeof(P.sig); ++i) diff += abs((int) P.sig[i] - (int) P.lastSig[i]);
	if ((double) diff / sizeof(P.sig) >= opt.sceneThreshold) saveKeyframe(dir, 1);
}

/* ------------------------------------------------------------------ */
/* Per-frame telemetry                                                  */
static int addRate(int rate) {
	for (int i = 0; i < P.nRates; ++i) {
		if (P.rates[i].rate == rate) {
			P.rates[i].frames++;
			return rate;
		}
	}
	if (P.nRates < 16) {
		P.rates[P.nRates].rate = rate;
		P.rates[P.nRates].frames = 1;
		P.nRates++;
	}
	return rate;
}

static int fifoRate(int timer) {
	struct GBATimer* t = &P.gba->timers[timer];
	if (!(t->flags & (1 << 6))) return 0; /* not enabled */
	int shift = t->flags & 0xF;
	int period = 0x10000 - t->reload;
	if (period <= 0) return 0;
	return (int) ((double) (GBA_CLOCK >> shift) / period + 0.5);
}

static void frameTelemetry(void) {
	const uint16_t* io = P.gba->memory.io;
	uint16_t dispcnt = io[0];
	int mode = dispcnt & 7;
	int forcedBlank = (dispcnt >> 7) & 1;
	if (!forcedBlank) P.modeFrames[mode]++; /* modes are only counted for displayed frames */
	if (forcedBlank) P.forcedBlankFrames++;
	static int lastFrameSel = -1;
	if (P.frame == 0) lastFrameSel = -1;
	if (mode >= 4 && mode <= 5) {
		int sel = (dispcnt >> 4) & 1;
		if (lastFrameSel >= 0 && sel != lastFrameSel) P.bitmapPageFlips++;
		lastFrameSel = sel;
	}
	for (int i = 0; i < 4; ++i)
		if (dispcnt & (0x100 << i)) P.bgFrames[i]++;
	if (dispcnt & 0x1000) P.objFrames++;
	if (dispcnt & 0x2000) P.win0Frames++;
	if (dispcnt & 0x4000) P.win1Frames++;
	if (dispcnt & 0x8000) P.objwinFrames++;
	uint16_t bldcnt = io[0x50 >> 1];
	int effect = (bldcnt >> 6) & 3;
	if (effect && (bldcnt & 0x3F)) P.blendFrames[effect]++;
	else P.blendFrames[0]++;

	int affineBg = (mode == 1 && (dispcnt & 0x400)) || (mode == 2 && (dispcnt & 0xC00));
	if (affineBg) {
		P.affineBgFrames++;
		int16_t pa = io[0x20 >> 1], pb = io[0x22 >> 1], pc = io[0x24 >> 1], pd = io[0x26 >> 1];
		int16_t qa = io[0x30 >> 1], qb = io[0x32 >> 1], qc = io[0x34 >> 1], qd = io[0x36 >> 1];
		int t2 = (dispcnt & 0x400) && (pa != 0x100 || pb || pc || pd != 0x100);
		int t3 = mode == 2 && (dispcnt & 0x800) && (qa != 0x100 || qb || qc || qd != 0x100);
		if (t2 || t3) P.affineBgTransformedFrames++;
	}

	/* OAM */
	int active = 0, visible = 0, affine = 0, mosaicObj = 0;
	int sizes[12] = { 0 };
	if (dispcnt & 0x1000) {
		const struct GBAObj* obj = P.gba->video.oam.obj;
		for (int i = 0; i < 128; ++i) {
			uint16_t a = obj[i].a, b = obj[i].b;
			if (!a && !b && !obj[i].c) continue; /* zero-filled (cleared) OAM entry: tile 0 at (0,0), treat as unused */
			/* identical to the previous entry: a fill pattern or exact overdraw, adds nothing visible */
			if (i && a == obj[i - 1].a && b == obj[i - 1].b && obj[i].c == obj[i - 1].c) continue;
			int transformed = (a >> 8) & 1;
			if (!transformed && ((a >> 9) & 1)) continue; /* disabled */
			int shape = (a >> 14) & 3;
			if (shape == 3) continue;
			int objMode = (a >> 10) & 3;
			if (objMode == 3) continue;
			int size = (b >> 14) & 3;
			int w = GBAVideoObjSizes[shape * 4 + size][0];
			int h = GBAVideoObjSizes[shape * 4 + size][1];
			active++;
			if (transformed) affine++;
			int bw = w, bh = h;
			if (transformed && ((a >> 9) & 1)) {
				bw *= 2;
				bh *= 2;
			}
			int y = a & 0xFF;
			if (y >= 160) y -= 256;
			int x = b & 0x1FF;
			if (x >= 240) x -= 512;
			if (x < 240 && x + bw > 0 && y < 160 && y + bh > 0 && objMode != 2) {
				visible++;
				sizes[shape * 4 + size]++;
				if ((a >> 12) & 1) mosaicObj = 1;
			}
		}
	}
	if (active > P.maxObjActive) P.maxObjActive = active;
	if (visible > P.maxObjVisible) P.maxObjVisible = visible;
	if (affine > P.maxObjAffine) P.maxObjAffine = affine;
	if (affine) P.objAffineFrames++;
	for (int i = 0; i < 12; ++i) {
		if (sizes[i] > P.sizeMax[i]) P.sizeMax[i] = sizes[i];
		P.sizeTotal[i] += sizes[i];
	}
	uint16_t mosaic = io[0x4C >> 1];
	int mosaicBg = 0;
	for (int i = 0; i < 4; ++i)
		if ((dispcnt & (0x100 << i)) && (io[(0x08 >> 1) + i] & 0x40)) mosaicBg = 1;
	if (mosaic && (mosaicBg || mosaicObj)) P.mosaicFrames++;

	/* raster */
	int hdmaMask = 0, cpuMask = 0;
	for (int g = 0; g < G_COUNT; ++g) {
		int hl = countVisibleLines(P.hdmaLines[g]);
		int cl = countVisibleLines(P.cpuLines[g]);
		if (hl) {
			P.hdmaFrames[g]++;
			hdmaMask |= 1 << g;
		}
		if (hl >= 32) P.hdmaFramesStrong[g]++;
		if (cl >= 4) {
			P.cpuRasterFrames[g]++;
			cpuMask |= 1 << g;
		}
		if (hl > P.maxHdmaLines[g]) P.maxHdmaLines[g] = hl;
		if (cl > P.maxCpuLines[g]) P.maxCpuLines[g] = cl;
	}
	memset(P.hdmaLines, 0, sizeof(P.hdmaLines));
	memset(P.cpuLines, 0, sizeof(P.cpuLines));
	uint16_t ie = io[0x200 >> 1], dispstat = io[0x4 >> 1];
	int hbIrq = (ie & 2) && (dispstat & 0x10);
	int vcIrq = (ie & 4) && (dispstat & 0x20);
	if (hbIrq) P.hblankIrqFrames++;
	if (vcIrq) P.vcountIrqFrames++;
	int hdmaEnabled = 0;
	for (int i = 0; i < 4; ++i) {
		uint16_t r = P.gba->memory.dma[i].reg;
		if ((r & 0x8000) && ((r >> 12) & 3) == 2) hdmaEnabled |= 1 << i;
	}
	if (hdmaEnabled) P.hblankDmaEnabledFrames++;

	if (P.tele) {
		char row[512];
		int n = snprintf(row, sizeof(row),
		                 "%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x%04x,%04x%04x,%04x,%04x,%04x,%04x,%04x%04x,%04x%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x,%d,%d,%d,",
		                 dispcnt, io[4], io[0x08 >> 1], io[0x0A >> 1], io[0x0C >> 1], io[0x0E >> 1], io[0x20 >> 1],
		                 io[0x22 >> 1], io[0x24 >> 1], io[0x26 >> 1], io[0x2A >> 1], io[0x28 >> 1], io[0x2E >> 1],
		                 io[0x2C >> 1], io[0x30 >> 1], io[0x32 >> 1], io[0x34 >> 1], io[0x36 >> 1], io[0x3A >> 1],
		                 io[0x38 >> 1], io[0x3E >> 1], io[0x3C >> 1], io[0x50 >> 1], io[0x52 >> 1], io[0x54 >> 1],
		                 mosaic, io[0x40 >> 1], io[0x42 >> 1], io[0x44 >> 1], io[0x46 >> 1], io[0x48 >> 1],
		                 io[0x4A >> 1], active, visible, affine);
		for (int i = 0; i < 12; ++i) n += snprintf(row + n, sizeof(row) - n, "%s%d", i ? "." : "", sizes[i]);
		snprintf(row + n, sizeof(row) - n, ",%02x,%02x,%x,%d,%d,%04x", hdmaMask, cpuMask, hdmaEnabled, hbIrq, vcIrq, ie);
		if (strcmp(row, P.lastRow)) {
			fprintf(P.tele, "%d,%s\n", P.frame, row);
			strcpy(P.lastRow, row);
			P.teleRows++;
		}
	}

	/* sound */
	uint16_t sndH = io[0x82 >> 1], sndX = io[0x84 >> 1];
	struct GBAAudio* au = &P.gba->audio;
	int master = au->enable || (sndX & 0x80);
	if (master) P.soundMasterFrames++;
	int ds[2] = { 0, 0 }, rate[2] = { 0, 0 };
	for (int c = 0; c < 2; ++c) {
		int routed = c ? (sndH & 0x3000) : (sndH & 0x0300);
		/* DMA1/2 in "special" timing targeting this FIFO */
		int dmaArmed = 0;
		for (int d = 1; d <= 2; ++d) {
			struct GBADMA* dm = &P.gba->memory.dma[d];
			if ((dm->reg & 0x8000) && ((dm->reg >> 12) & 3) == 3 && (dm->dest & 0xFFFFFFFC) == (c ? 0x040000A4u : 0x040000A0u))
				dmaArmed = 1;
		}
		if (master && routed && (P.fifoWrites[c] || dmaArmed)) {
			ds[c] = 1;
			P.dsFrames[c]++;
			int timer = c ? ((sndH >> 14) & 1) : ((sndH >> 10) & 1);
			rate[c] = fifoRate(timer);
			if (rate[c]) addRate(rate[c]);
		}
		P.fifoWritesTotal[c] += P.fifoWrites[c];
		P.fifoWrites[c] = 0;
	}
	int psgMask = 0;
	if (master) {
		const struct GBAudio* g = &au->psg;
		if (g->playingCh1 && (g->ch1Left || g->ch1Right)) psgMask |= 1;
		if (g->playingCh2 && (g->ch2Left || g->ch2Right)) psgMask |= 2;
		if (g->playingCh3 && (g->ch3Left || g->ch3Right)) psgMask |= 4;
		if (g->playingCh4 && (g->ch4Left || g->ch4Right)) psgMask |= 8;
	}
	for (int c = 0; c < 4; ++c) {
		if (psgMask & (1 << c)) P.psgFrames[c]++;
		P.psgTriggersTotal[c] += P.psgTriggers[c];
	}
	if (P.audioEv) {
		char row[128];
		snprintf(row, sizeof(row), "%d,%d,%d,%d,%d,%x,%d%d%d%d", master, ds[0], ds[1], rate[0], rate[1], psgMask,
		         P.psgTriggers[0] ? 1 : 0, P.psgTriggers[1] ? 1 : 0, P.psgTriggers[2] ? 1 : 0, P.psgTriggers[3] ? 1 : 0);
		if (strcmp(row, P.lastAudioRow)) {
			fprintf(P.audioEv, "%d,%s\n", P.frame, row);
			strcpy(P.lastAudioRow, row);
			P.audioRows++;
		}
	}
	memset(P.psgTriggers, 0, sizeof(P.psgTriggers));
}

/* ------------------------------------------------------------------ */
/* Audio                                                                */
static void wavHeader(FILE* f, uint32_t samples) {
	uint32_t dataBytes = samples * 2;
	uint8_t h[44];
	memcpy(h, "RIFF", 4);
	uint32_t v = 36 + dataBytes;
	memcpy(h + 4, &v, 4);
	memcpy(h + 8, "WAVEfmt ", 8);
	v = 16;
	memcpy(h + 16, &v, 4);
	uint16_t s = 1;
	memcpy(h + 20, &s, 2); /* PCM */
	memcpy(h + 22, &s, 2); /* mono */
	v = WAV_RATE;
	memcpy(h + 24, &v, 4);
	v = WAV_RATE * 2;
	memcpy(h + 28, &v, 4);
	s = 2;
	memcpy(h + 32, &s, 2);
	s = 16;
	memcpy(h + 34, &s, 2);
	memcpy(h + 36, "data", 4);
	memcpy(h + 40, &dataBytes, 4);
	fseek(f, 0, SEEK_SET);
	fwrite(h, 1, 44, f);
}

static void drainAudio(void) {
	blip_t* l = P.core->getAudioChannel(P.core, 0);
	blip_t* r = P.core->getAudioChannel(P.core, 1);
	short bl[1024], br[1024], mono[1024];
	for (;;) {
		int avail = blip_samples_avail(l);
		if (avail <= 0) break;
		if (avail > 1024) avail = 1024;
		int nl = blip_read_samples(l, bl, avail, 0);
		int nr = blip_read_samples(r, br, nl, 0);
		if (nr < nl) memset(br + nr, 0, (nl - nr) * sizeof(short));
		if (!P.wavf) continue;
		for (int i = 0; i < nl; ++i) {
			int m = ((int) bl[i] + (int) br[i]) / 2;
			mono[i] = (short) m;
			int a = m < 0 ? -m : m;
			if (a > P.wavPeak) P.wavPeak = a;
			P.wavSumSq += (double) m * m;
		}
		fwrite(mono, sizeof(short), nl, P.wavf);
		P.wavSamples += nl;
	}
}

/* ------------------------------------------------------------------ */
/* Inputs                                                               */
static int keyBit(const char* name, size_t len) {
	for (int i = 0; i < 10; ++i)
		if (strlen(KEY_NAMES[i]) == len && !strncasecmp(name, KEY_NAMES[i], len)) return 1 << i;
	return -1;
}

static uint16_t* expandInputs(const char* spec, int frames, char* err, size_t errLen) {
	uint16_t* keys = calloc(frames + 1, sizeof(uint16_t));
	if (!spec || !*spec || !strcmp(spec, "-")) return keys;
	const char* p = spec;
	while (*p) {
		char* end;
		long f = strtol(p, &end, 10);
		if (*end != ':') goto bad;
		long hold = strtol(end + 1, &end, 10);
		if (*end != ':') goto bad;
		p = end + 1;
		int mask = 0;
		while (*p && *p != ',') {
			const char* q = p;
			while (*q && *q != '+' && *q != ',') ++q;
			int b = keyBit(p, q - p);
			if (b < 0) goto bad;
			mask |= b;
			p = (*q == '+') ? q + 1 : q;
		}
		for (long i = f; i < f + hold && i < frames; ++i)
			if (i >= 0) keys[i] |= mask;
		if (*p == ',') ++p;
	}
	return keys;
bad:
	snprintf(err, errLen, "bad input spec near '%.20s'", p);
	free(keys);
	return NULL;
}

/* ------------------------------------------------------------------ */
/* Phase runner                                                         */
static int runPhase(const struct PhaseSpec* spec) {
	char dir[1024], path[1200];
	snprintf(dir, sizeof(dir), "%s/%s", opt.out, spec->name);
	snprintf(path, sizeof(path), "%s/keyframes", dir);
	mkdirs(path);

	memset(&P, 0, sizeof(P));
	covPrevPc = 0xFFFFFFFF;
	covPrevThumb = 0;
	covLastLr = 0;
	covLrSetAt = 0;
	covCount = 0;
	memset(covNext, 0, sizeof(covNext));
	char err[256] = "";
	uint16_t* keys = expandInputs(spec->inputs, spec->frames, err, sizeof(err));
	if (!keys) {
		fprintf(stderr, "%s: %s\n", spec->name, err);
		return 1;
	}

	double t0 = nowSec();
	struct mCore* core = GBACoreCreate();
	if (!core || !core->init(core)) {
		fprintf(stderr, "core init failed\n");
		return 1;
	}
	mCoreInitConfig(core, NULL);
	mCoreConfigSetDefaultIntValue(&core->config, "skipBios", 1);
	mCoreConfigSetDefaultIntValue(&core->config, "useBios", 0);
	mCoreConfigSetDefaultIntValue(&core->config, "volume", 0x100); /* opts.volume defaults to 0 (silent) */
	mCoreLoadConfig(core);
	P.fb = calloc(W * H, sizeof(color_t));
	core->setVideoBuffer(core, P.fb, W);
	core->setAudioBufferSize(core, 4096);
	if (!mCoreLoadFile(core, opt.rom)) {
		fprintf(stderr, "failed to load ROM %s\n", opt.rom);
		core->deinit(core);
		return 1;
	}
	core->rtc.override = RTC_FIXED;
	core->rtc.value = opt.rtcMs;
	core->reset(core);
	blip_set_rates(core->getAudioChannel(core, 0), GBA_CLOCK, WAV_RATE);
	blip_set_rates(core->getAudioChannel(core, 1), GBA_CLOCK, WAV_RATE);

	P.core = core;
	P.gba = core->board;
	P.cpu = core->cpu;
	snprintf(P.assetDir, sizeof(P.assetDir), "%s", dir);
	if (opt.assetTraceLimit) P.assets = calloc((size_t) opt.assetTraceLimit, sizeof(*P.assets));
	installHooks();
	if (opt.coverage) covInit();

	snprintf(path, sizeof(path), "%s/telemetry.csv", dir);
	P.tele = fopen(path, "w");
	if (P.tele)
		fprintf(P.tele,
		        "frame,dispcnt,dispstat,bg0cnt,bg1cnt,bg2cnt,bg3cnt,bg2pa,bg2pb,bg2pc,bg2pd,bg2x,bg2y,bg3pa,bg3pb,bg3pc,bg3pd,"
		        "bg3x,bg3y,bldcnt,bldalpha,bldy,mosaic,win0h,win1h,win0v,win1v,winin,winout,obj_active,obj_visible,"
		        "obj_affine,obj_sizes,hdma_groups,cpu_raster_groups,hdma_channels,hblank_irq,vcount_irq,ie\n");
	snprintf(path, sizeof(path), "%s/audio_events.csv", dir);
	P.audioEv = fopen(path, "w");
	if (P.audioEv) fprintf(P.audioEv, "frame,master,ds_a,ds_b,ds_a_hz,ds_b_hz,psg_playing_mask,psg_triggers_1234\n");
	if (opt.wav) {
		snprintf(path, sizeof(path), "%s/%s.wav", opt.out, spec->name);
		P.wavf = fopen(path, "wb");
		if (P.wavf) wavHeader(P.wavf, 0);
	}
	if (opt.mp4) {
		char cmd[1600];
		snprintf(cmd, sizeof(cmd),
		         "ffmpeg -loglevel error -y -f rawvideo -pix_fmt rgb0 -s 240x160 -r 60 -i - -c:v libx264 -preset ultrafast "
		         "-crf 26 -pix_fmt yuv420p -threads 1 '%s/%s.mp4'",
		         opt.out, spec->name);
		P.mp4 = popen(cmd, "w");
	}
	mLogSetDefaultLogger(&logger);

	double tSetup = nowSec();
	double tCapture = 0;
	for (P.frame = 0; P.frame < spec->frames; ++P.frame) {
		core->setKeys(core, keys[P.frame]);
		installHooks();
		if (opt.coverage) runFrameCoverage();
		else core->runFrame(core);
		double tc = nowSec();
		frameTelemetry();
		drainAudio();
		captureFrame(dir);
		tCapture += nowSec() - tc;
	}
	double tRun = nowSec();

	/* end-of-phase artifacts */
	snprintf(path, sizeof(path), "%s/state.ss", dir);
	/* Raw savestates are mapped read/write by libmgba, unlike PNG output. */
	struct VFile* vf = VFileOpen(path, O_CREAT | O_TRUNC | O_RDWR);
	int stateOk = 0;
	if (vf) {
		stateOk = mCoreSaveStateNamed(core, vf, SAVESTATE_SAVEDATA | SAVESTATE_RTC | SAVESTATE_METADATA);
		vf->close(vf);
	}
	snprintf(path, sizeof(path), "%s/ewram.bin", dir);
	FILE* f = fopen(path, "wb");
	if (f) {
		fwrite(P.gba->memory.wram, 1, 0x40000, f);
		fclose(f);
	}
	snprintf(path, sizeof(path), "%s/iwram.bin", dir);
	f = fopen(path, "wb");
	if (f) {
		fwrite(P.gba->memory.iwram, 1, 0x8000, f);
		fclose(f);
	}
	if (opt.coverage) {
		snprintf(path, sizeof(path), "%s/coverage.json", dir);
		writeCoverage(path, spec->name);
	}
	if (P.tele) {
		fprintf(P.tele, "%d,end\n", P.frame);
		fclose(P.tele);
	}
	if (P.audioEv) {
		fprintf(P.audioEv, "%d,end\n", P.frame);
		fclose(P.audioEv);
	}
	if (P.wavf) {
		wavHeader(P.wavf, (uint32_t) P.wavSamples);
		fclose(P.wavf);
	}
	if (P.mp4) pclose(P.mp4);
	int assetTraceWritten = writeLoadedAssets(dir, spec->name);
	double tEnd = nowSec();

	/* phase.json */
	snprintf(path, sizeof(path), "%s/phase.json", dir);
	f = fopen(path, "w");
	if (!f) return 1;
	int frames = spec->frames;
	fprintf(f, "{\"phase\":");
	jsonStr(f, spec->name);
	fprintf(f, ",\"frames\":%d,\"inputs\":", frames);
	jsonStr(f, spec->inputs ? spec->inputs : "");
	fprintf(f, ",\"timing\":{\"setup_s\":%.4f,\"emulate_and_capture_s\":%.4f,\"capture_overhead_s\":%.4f,"
	           "\"finalize_s\":%.4f,\"wall_s\":%.4f,\"emulated_fps\":%.1f,\"realtime_multiple\":%.2f}",
	        tSetup - t0, tRun - tSetup, tCapture, tEnd - tRun, tEnd - t0, frames / (tRun - tSetup),
	        frames / (tRun - tSetup) / 59.7275);
	fprintf(f, ",\"options\":{\"coverage\":%s,\"png\":%s,\"mp4\":%s,\"wav\":%s,\"keyframe_interval\":%d,"
	           "\"scene_threshold\":%.1f,\"scene_min_gap\":%d,\"rtc_fixed_ms\":%lld}",
	        opt.coverage ? "true" : "false", opt.png ? "true" : "false", opt.mp4 ? "true" : "false",
	        opt.wav ? "true" : "false", opt.keyframeInterval, opt.sceneThreshold, opt.sceneMinGap,
	        (long long) opt.rtcMs);
	fprintf(f, ",\"video\":{\"mode_frames\":[");
	for (int i = 0; i < 8; ++i) fprintf(f, "%s%llu", i ? "," : "", (unsigned long long) P.modeFrames[i]);
	fprintf(f, "],\"bg_enabled_frames\":[%llu,%llu,%llu,%llu],\"obj_enabled_frames\":%llu",
	        (unsigned long long) P.bgFrames[0], (unsigned long long) P.bgFrames[1], (unsigned long long) P.bgFrames[2],
	        (unsigned long long) P.bgFrames[3], (unsigned long long) P.objFrames);
	fprintf(f, ",\"win0_frames\":%llu,\"win1_frames\":%llu,\"objwin_frames\":%llu,\"forced_blank_frames\":%llu",
	        (unsigned long long) P.win0Frames, (unsigned long long) P.win1Frames, (unsigned long long) P.objwinFrames,
	        (unsigned long long) P.forcedBlankFrames);
	fprintf(f, ",\"blend_frames\":{\"none\":%llu,\"alpha\":%llu,\"brighten\":%llu,\"darken\":%llu}",
	        (unsigned long long) P.blendFrames[0], (unsigned long long) P.blendFrames[1],
	        (unsigned long long) P.blendFrames[2], (unsigned long long) P.blendFrames[3]);
	fprintf(f, ",\"mosaic_frames\":%llu,\"affine_bg_frames\":%llu,\"affine_bg_transformed_frames\":%llu,"
	           "\"bitmap_page_flips\":%llu",
	        (unsigned long long) P.mosaicFrames, (unsigned long long) P.affineBgFrames,
	        (unsigned long long) P.affineBgTransformedFrames, (unsigned long long) P.bitmapPageFlips);
	fprintf(f, ",\"max_obj_active\":%d,\"max_obj_visible\":%d,\"max_obj_affine\":%d,\"obj_affine_frames\":%llu",
	        P.maxObjActive, P.maxObjVisible, P.maxObjAffine, (unsigned long long) P.objAffineFrames);
	fprintf(f, ",\"obj_size_visible\":{");
	for (int i = 0; i < 12; ++i)
		fprintf(f, "%s\"%dx%d\":{\"max\":%d,\"mean\":%.2f}", i ? "," : "", GBAVideoObjSizes[i][0],
		        GBAVideoObjSizes[i][1], P.sizeMax[i], frames ? (double) P.sizeTotal[i] / frames : 0.0);
	fprintf(f, "},\"keyframes\":%d,\"scene_keyframes\":%d,\"telemetry_rows\":%d}", P.nKeyframes, P.nSceneKeyframes,
	        P.teleRows);
	fprintf(f, ",\"raster\":{\"hblank_irq_frames\":%llu,\"vcount_irq_frames\":%llu,\"hblank_dma_enabled_frames\":%llu,"
	           "\"groups\":{",
	        (unsigned long long) P.hblankIrqFrames, (unsigned long long) P.vcountIrqFrames,
	        (unsigned long long) P.hblankDmaEnabledFrames);
	for (int g = 0; g < G_COUNT; ++g)
		fprintf(f, "%s\"%s\":{\"hdma_frames\":%llu,\"hdma_frames_ge32_lines\":%llu,\"hdma_max_lines\":%d,"
		           "\"hdma_writes\":%llu,\"cpu_midframe_frames\":%llu,\"cpu_max_lines\":%d}",
		        g ? "," : "", GROUP_NAMES[g], (unsigned long long) P.hdmaFrames[g],
		        (unsigned long long) P.hdmaFramesStrong[g], P.maxHdmaLines[g], (unsigned long long) P.hdmaWrites[g],
		        (unsigned long long) P.cpuRasterFrames[g], P.maxCpuLines[g]);
	fprintf(f, "},\"dma_configs\":[");
	for (int i = 0; i < P.nDmaCfg; ++i) {
		struct DmaConfig* c = &P.dmaCfg[i];
		fprintf(f, "%s{\"ch\":%d,\"timing\":\"%s\",\"src\":\"0x%08x\",\"dst\":\"0x%08x\",\"dst_group\":\"%s\",\"count\":%d,"
		           "\"repeat\":%d,\"width\":%d,\"setups\":%d,\"first_frame\":%d}",
		        i ? "," : "", c->ch, c->timing == 2 ? "hblank" : "special", c->src, c->dst,
		        (c->dst >> 24) == 4 && (c->dst & 0x3FF) >= 0xA0 && (c->dst & 0x3FF) < 0xA8 ? "sound_fifo" : GROUP_NAMES[c->dstGroup],
		        c->count, c->repeat, c->width, c->setups, c->firstFrame);
	}
	fprintf(f, "],\"dma_configs_overflow\":%d}", P.dmaCfgOverflow);
	double rms = P.wavSamples ? sqrt(P.wavSumSq / P.wavSamples) : 0;
	fprintf(f, ",\"sound\":{\"master_on_frames\":%llu,\"directsound_frames\":{\"A\":%llu,\"B\":%llu},"
	           "\"fifo_writes\":{\"A\":%llu,\"B\":%llu},\"psg_playing_frames\":[%llu,%llu,%llu,%llu],"
	           "\"psg_triggers\":[%llu,%llu,%llu,%llu],\"directsound_rates_hz\":{",
	        (unsigned long long) P.soundMasterFrames, (unsigned long long) P.dsFrames[0],
	        (unsigned long long) P.dsFrames[1], (unsigned long long) P.fifoWritesTotal[0],
	        (unsigned long long) P.fifoWritesTotal[1], (unsigned long long) P.psgFrames[0],
	        (unsigned long long) P.psgFrames[1], (unsigned long long) P.psgFrames[2],
	        (unsigned long long) P.psgFrames[3], (unsigned long long) P.psgTriggersTotal[0],
	        (unsigned long long) P.psgTriggersTotal[1], (unsigned long long) P.psgTriggersTotal[2],
	        (unsigned long long) P.psgTriggersTotal[3]);
	for (int i = 0; i < P.nRates; ++i)
		fprintf(f, "%s\"%d\":%llu", i ? "," : "", P.rates[i].rate, (unsigned long long) P.rates[i].frames);
	fprintf(f, "},\"wav\":{\"file\":\"%s.wav\",\"sample_rate\":%d,\"channels\":1,\"bits\":16,\"samples\":%llu,"
	           "\"duration_s\":%.3f,\"rms\":%.1f,\"peak\":%d},\"event_rows\":%d}",
	        spec->name, WAV_RATE, (unsigned long long) P.wavSamples, (double) P.wavSamples / WAV_RATE, rms, P.wavPeak,
	        P.audioRows);
	fprintf(f, ",\"swi\":{\"total\":%llu,\"counts\":{", (unsigned long long) P.swiTotal);
	int first = 1;
	for (int i = 0; i < 256; ++i) {
		if (!P.swi[i]) continue;
		fprintf(f, "%s\"0x%02x %s\":%llu", first ? "" : ",", i, i < 0x2B ? SWI_NAMES[i] : (i == 0xF0 ? "mgba_hle_internal" : "unknown"),
		        (unsigned long long) P.swi[i]);
		first = 0;
	}
	fprintf(f, "}}");
	fprintf(f, ",\"asset_trace\":{\"enabled\":%s,\"entry_limit\":%d,\"snapshot_max_bytes\":%u,"
	           "\"observed_lz77_calls\":%llu,\"unique_records\":%d,\"unrecorded_new_calls\":%llu,"
	           "\"snapshot_bytes\":%llu,\"allocation_ok\":%s,\"written\":%s,"
	           "\"records_file\":\"loaded_assets.jsonl\",\"note\":\"First-use snapshots after synchronous mGBA HLE;"
	           " repeated uses deduplicated by SWI/source/destination; omitted calls remain counted; payload kind unclassified\"}",
	        opt.assetTraceLimit ? "true" : "false", opt.assetTraceLimit, opt.assetSnapshotMax,
	        (unsigned long long) P.assetCalls, P.assetCount, (unsigned long long) P.assetDroppedCalls,
	        (unsigned long long) P.assetSnapshotBytes, (!opt.assetTraceLimit || P.assets) ? "true" : "false",
	        assetTraceWritten ? "true" : "false");
	if (opt.coverage) {
		uint64_t uniq[3] = { 0 }, calls[3] = { 0 };
		for (int i = 0; i < 3; ++i)
			for (uint32_t j = 0; j < P.cov[i].size / 2; ++j)
				if (P.cov[i].hits[j]) {
					uniq[i]++;
					if (P.cov[i].flags[j] & CF_CALL) calls[i]++;
				}
		fprintf(f, ",\"coverage\":{\"instructions_executed\":%llu,\"unique_instructions\":{\"rom\":%llu,\"ewram\":%llu,"
		           "\"iwram\":%llu},\"call_targets\":{\"rom\":%llu,\"ewram\":%llu,\"iwram\":%llu},\"stuck_frames\":%llu}",
		        (unsigned long long) P.instructions, (unsigned long long) uniq[0], (unsigned long long) uniq[1],
		        (unsigned long long) uniq[2], (unsigned long long) calls[0], (unsigned long long) calls[1],
		        (unsigned long long) calls[2], (unsigned long long) P.stuckFrames);
	}
	fprintf(f, ",\"savestate\":%s,\"log_counts\":{\"fatal\":%llu,\"error\":%llu,\"warn\":%llu,\"stub\":%llu,"
	           "\"game_error\":%llu},\"errors\":[",
	        stateOk ? "true" : "false", (unsigned long long) P.logCount[0], (unsigned long long) P.logCount[1],
	        (unsigned long long) P.logCount[2], (unsigned long long) P.logCount[5], (unsigned long long) P.logCount[6]);
	for (int i = 0; i < P.nErrors; ++i) {
		if (i) fputc(',', f);
		jsonStr(f, P.errors[i]);
	}
	fprintf(f, "],\"log_samples\":[");
	for (int i = 0; i < P.nSamples; ++i) {
		if (i) fputc(',', f);
		jsonStr(f, P.samples[i]);
	}
	fprintf(f, "]}\n");
	fclose(f);

	mLogSetDefaultLogger(NULL);
	covFree();
	mCoreConfigDeinit(&core->config);
	core->deinit(core);
	free(P.fb);
	free(P.assets);
	free(keys);
	return 0;
}

static void usage(const char* argv0) {
	fprintf(stderr,
	        "usage: %s --rom ROM.gba --out DIR [options] --phase NAME --frames N [--inputs SPEC] [--phase ...]\n"
	        "  --inputs SPEC        comma list of FRAME:HOLD:KEY[+KEY] (keys: A B SELECT START RIGHT LEFT UP DOWN R L)\n"
	        "  --no-coverage        use libmgba runFrame instead of single-step coverage\n"
	        "  --no-png             skip keyframes\n"
	        "  --no-wav             skip WAV output\n"
	        "  --asset-trace-limit N  maximum unique LZ77 uses/phase (default 64; 0 disables; max 4096)\n"
	        "  --asset-snapshot-max-bytes N  save post-HLE output only when <= N bytes (default 0; max 1048576)\n"
	        "  --mp4                pipe frames to ffmpeg (libx264 ultrafast) per phase\n"
	        "  --keyframe-interval N  periodic keyframe interval in frames (default 120)\n"
	        "  --scene-threshold X  mean abs luma diff (0-255) on 30x20 grid for scene keyframes (default 18)\n"
	        "  --version            print harness/libmgba version\n",
	        argv0);
}

int main(int argc, char** argv) {
	for (int i = 1; i < argc; ++i) {
		const char* a = argv[i];
		const char* v = i + 1 < argc ? argv[i + 1] : NULL;
		if (!strcmp(a, "--version")) {
			printf("{\"harness_version\":\"%s\",\"harness_src_sha1\":\"%s\",\"libmgba_version\":\"%s\",\"libmgba_git\":\"%s\"}\n",
			       HARNESS_VERSION, HARNESS_SRC_SHA, projectVersion, gitCommit);
			return 0;
		} else if (!strcmp(a, "--rom") && v) {
			opt.rom = v;
			++i;
		} else if (!strcmp(a, "--out") && v) {
			opt.out = v;
			++i;
		} else if (!strcmp(a, "--phase") && v && opt.nPhases < 8) {
			snprintf(opt.phases[opt.nPhases].name, sizeof(opt.phases[0].name), "%s", v);
			opt.phases[opt.nPhases].frames = 3600;
			opt.nPhases++;
			++i;
		} else if (!strcmp(a, "--frames") && v && opt.nPhases) {
			opt.phases[opt.nPhases - 1].frames = atoi(v);
			++i;
		} else if (!strcmp(a, "--inputs") && v && opt.nPhases) {
			opt.phases[opt.nPhases - 1].inputs = (char*) v;
			++i;
		} else if (!strcmp(a, "--no-coverage")) {
			opt.coverage = 0;
		} else if (!strcmp(a, "--no-png")) {
			opt.png = 0;
		} else if (!strcmp(a, "--no-wav")) {
			opt.wav = 0;
		} else if (!strcmp(a, "--asset-trace-limit") && v) {
			char* end = NULL; long n = strtol(v, &end, 10);
			if (!*v || *end || n < 0 || n > 4096) { fprintf(stderr, "invalid asset trace limit\n"); return 2; }
			opt.assetTraceLimit = (int) n; ++i;
		} else if (!strcmp(a, "--asset-snapshot-max-bytes") && v) {
			char* end = NULL; long n = strtol(v, &end, 10);
			if (!*v || *end || n < 0 || n > 1048576) { fprintf(stderr, "invalid asset snapshot limit\n"); return 2; }
			opt.assetSnapshotMax = (uint32_t) n; ++i;
		} else if (!strcmp(a, "--mp4")) {
			opt.mp4 = 1;
		} else if (!strcmp(a, "--keyframe-interval") && v) {
			opt.keyframeInterval = atoi(v);
			++i;
		} else if (!strcmp(a, "--scene-threshold") && v) {
			opt.sceneThreshold = atof(v);
			++i;
		} else {
			usage(argv[0]);
			return 2;
		}
	}
	if (!opt.rom || !opt.out || !opt.nPhases) {
		usage(argv[0]);
		return 2;
	}
	mkdirs(opt.out);
	int rc = 0;
	for (int i = 0; i < opt.nPhases; ++i) {
		double t = nowSec();
		int r = runPhase(&opt.phases[i]);
		fprintf(stderr, "[capture] %s phase=%s frames=%d rc=%d wall=%.2fs\n", opt.out, opt.phases[i].name,
		        opt.phases[i].frames, r, nowSec() - t);
		if (r) rc = 1;
	}
	return rc;
}
