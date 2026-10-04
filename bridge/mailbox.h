#ifndef CODE_RED_MAILBOX_H
#define CODE_RED_MAILBOX_H
#include <stdint.h>
#include <stddef.h>
#define CODE_RED_BYTES 36
struct CodeRedBridge {
    void *context;
    uint8_t (*read)(void *, uint32_t);
    void (*write)(void *, uint32_t, uint8_t);
    uint32_t address;
    uint32_t epoch;
};
/* Address comes from the verified ROM build, never from guest input. */
int code_red_snapshot(struct CodeRedBridge *, uint8_t out[CODE_RED_BYTES]);
int code_red_reply(struct CodeRedBridge *, uint32_t epoch, uint32_t request, uint16_t status, uint32_t result);
void code_red_invalidate(struct CodeRedBridge *);
#endif
