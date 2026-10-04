/* Included by the pinned mGBA libretro.c, which owns static `core`.
 * Verified with the compatible pinned browser build; see BROWSER_BUILD.md.
 */
#include "code_red_mailbox.h"
#include "code_red_address.h"
#include "code_red_naming_transport.h"
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/heap.h>
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
static struct CodeRedTextBridge code_red_text_bridge={&code_red_bridge,CODE_RED_NAMING_MAILBOX_ADDRESS};
static void code_red_core_invalidate(void) {
    code_red_bridge.context=core;
    if(core) {
        code_red_invalidate(&code_red_bridge);
        code_red_text_invalidate(&code_red_text_bridge);
    }
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
static int code_red_host_buffer(const void *pointer,unsigned length) {
    if(!pointer) return length==0;
#ifdef __EMSCRIPTEN__
    uintptr_t address=(uintptr_t)pointer;
    size_t size=emscripten_get_heap_size();
    return address<=size && length<=size-address;
#else
    return 1;
#endif
}
CODE_RED_EXPORT int ejs_code_red_text_snapshot(uint8_t *out,unsigned capacity) {
    if(!core || capacity!=CODE_RED_TEXT_BYTES || !out || !code_red_host_buffer(out,capacity)) return 0;
    code_red_bridge.context=core;
    return code_red_text_snapshot(&code_red_text_bridge,out);
}
CODE_RED_EXPORT int ejs_code_red_text_write(unsigned epoch,unsigned session,unsigned sequence,
                                          unsigned action,const uint8_t *data,unsigned length) {
    if(!core || length>CODE_RED_TEXT_LIMIT || !code_red_host_buffer(data,length)) return 0;
    code_red_bridge.context=core;
    return code_red_text_write(&code_red_text_bridge,epoch,session,sequence,action,data,length);
}
#include "code_red_mailbox.c"
#include "code_red_naming_transport.c"
