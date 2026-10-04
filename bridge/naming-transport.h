#ifndef CODE_RED_NAMING_TRANSPORT_H
#define CODE_RED_NAMING_TRANSPORT_H
#include "mailbox.h"
#define CODE_RED_TEXT_BYTES 60u
#define CODE_RED_TEXT_LIMIT 15u
struct CodeRedTextBridge {
    struct CodeRedBridge *mailbox;
    uint32_t address;
};
int code_red_text_snapshot(struct CodeRedTextBridge *, uint8_t out[CODE_RED_TEXT_BYTES]);
int code_red_text_write(struct CodeRedTextBridge *, uint32_t epoch, uint32_t session,
                        uint32_t sequence, unsigned action, const uint8_t *data, unsigned length);
void code_red_text_invalidate(struct CodeRedTextBridge *);
#endif
