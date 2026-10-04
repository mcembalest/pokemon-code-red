/* Local headless boot check using mGBA; screenshots stay in ignored build/. */
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <stdio.h>
#include <stdlib.h>

static void quiet_log(struct mLogger *logger, int category, enum mLogLevel level, const char *format, va_list args) {
    (void)logger; (void)category;
    if (level == mLOG_FATAL || level == mLOG_ERROR) { vfprintf(stderr, format, args); fputc('\n', stderr); }
}

static void screenshot(const char *path, color_t *pixels) {
    FILE *file = fopen(path, "wb");
    if (!file) { perror(path); exit(1); }
    fprintf(file, "P6\n240 160\n255\n");
    for (int i = 0; i < 240*160; ++i) {
        unsigned char rgb[] = {pixels[i] & 255, (pixels[i] >> 8) & 255, (pixels[i] >> 16) & 255};
        fwrite(rgb, 1, 3, file);
    }
    fclose(file);
}
int main(int argc, char **argv) {
    if (argc != 5) return 2;
    struct mLogger logger = {.log = quiet_log, .filter = NULL};
    mLogSetDefaultLogger(&logger);
    struct mCore *core = mCoreFind(argv[1]);
    if (!core || !core->init(core)) return 3;
    mCoreInitConfig(core, NULL);
    core->opts.useBios = false;
    color_t *pixels = calloc(240 * 160, sizeof(color_t));
    if (!pixels) return 4;
    core->setVideoBuffer(core, pixels, 240);
    if (!mCoreLoadFile(core, argv[1])) return 5;
    core->reset(core);
    for (int frame = 0; frame < 600; ++frame) core->runFrame(core);
    screenshot(argv[2], pixels);
    /* Start, then A pulses to enter NEW GAME and step through help pages. */
    for (int frame = 0; frame < 1800; ++frame) {
        unsigned keys = frame < 30 ? 8 : (frame % 120 < 12 ? 1 : 0);
        core->setKeys(core, keys);
        core->runFrame(core);
        if (frame == 1669) screenshot(argv[4], pixels);
    }
    screenshot(argv[3], pixels);
    unsigned different = 0;
    for (int i=1; i<240*160; ++i) if(pixels[i] != pixels[0]) ++different;
    mCoreConfigDeinit(&core->config);
    core->deinit(core);
    free(pixels);
    printf("Ran 2400 GBA frames; final framebuffer has %u nonuniform pixels. Inspect captures for boot/intro.\n", different);
    return different > 100 ? 0 : 6;
}
