/* Code Red core adapter (ABI 1). Included at the end of mGBA's libretro.c.
 *
 * ROM-agnostic on purpose: exposes where EWRAM/IWRAM live in the WASM heap and a
 * counter that changes on reset / state load. All protocol logic (mailbox
 * layout, validation, replies) lives in JavaScript, so game changes never
 * require rebuilding this core.
 */
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define CODE_RED_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define CODE_RED_EXPORT
#endif

static unsigned code_red_epoch = 1;

static void code_red_core_invalidate(void) {
    code_red_epoch++;
    if (!code_red_epoch) code_red_epoch = 1;
}

CODE_RED_EXPORT unsigned ejs_cr_abi(void) { return 1; }
CODE_RED_EXPORT unsigned ejs_cr_epoch(void) { return code_red_epoch; }
/* GBA EWRAM (0x02000000). Not retro_get_memory_size(SYSTEM_RAM): at the
 * pinned mGBA revision that returns the Game Boy WRAM size for every platform. */
CODE_RED_EXPORT void *ejs_cr_ewram(void) {
    if (!core || core->platform(core) != mPLATFORM_GBA) return NULL;
    return ((struct GBA*) core->board)->memory.wram;
}
CODE_RED_EXPORT unsigned ejs_cr_ewram_size(void) {
    return ejs_cr_ewram() ? GBA_SIZE_EWRAM : 0;
}
/* GBA IWRAM (0x03000000): save block pointers and other fast globals. */
CODE_RED_EXPORT void *ejs_cr_iwram(void) {
    if (!core || core->platform(core) != mPLATFORM_GBA) return NULL;
    return ((struct GBA*) core->board)->memory.iwram;
}
CODE_RED_EXPORT unsigned ejs_cr_iwram_size(void) {
    return ejs_cr_iwram() ? GBA_SIZE_IWRAM : 0;
}
