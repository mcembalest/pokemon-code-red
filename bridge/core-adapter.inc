/* Included by the pinned mGBA libretro.c, which owns static `core`.
 * Verified with the compatible pinned browser build; see BROWSER_BUILD.md.
 */
#include "code_red_mailbox.h"
#include "code_red_address.h"
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define CODE_RED_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define CODE_RED_EXPORT
#endif
static uint8_t code_red_read_byte(void *context, uint32_t address) {
    struct mCore *c=context;
    return c->busRead8(c,address);
}
static void code_red_write_byte(void *context,uint32_t address,uint8_t value) {
    struct mCore *c=context;
    c->busWrite8(c,address,value);
}
static struct CodeRedBridge code_red_bridge={NULL,code_red_read_byte,code_red_write_byte,CODE_RED_MAILBOX_ADDRESS,1};
static void code_red_core_invalidate(void) {
    code_red_bridge.context=core;
    if(core) code_red_invalidate(&code_red_bridge);
}
CODE_RED_EXPORT unsigned ejs_code_red_epoch(void) { return code_red_bridge.epoch; }
CODE_RED_EXPORT int ejs_code_red_snapshot(uint8_t *out,unsigned capacity) {
    if(!core||capacity!=CODE_RED_BYTES)return 0;
    code_red_bridge.context=core;
    return code_red_snapshot(&code_red_bridge,out);
}
CODE_RED_EXPORT int ejs_code_red_reply(unsigned epoch,unsigned request,unsigned status,unsigned result) {
    if(!core||status>2)return 0;
    code_red_bridge.context=core;
    return code_red_reply(&code_red_bridge,epoch,request,(uint16_t)status,result);
}
#include "code_red_mailbox.c"
