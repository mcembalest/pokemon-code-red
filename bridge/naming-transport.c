#include "naming-transport.h"
#include <string.h>
static uint32_t text_u32(const uint8_t *p) {
    return (uint32_t)p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24;
}
static int text_address_valid(const struct CodeRedTextBridge *t) {
    return t && t->mailbox && t->mailbox->read && t->mailbox->write
        && t->address>=0x02000000u && t->address<=0x02040000u-CODE_RED_TEXT_BYTES;
}
static int text_ascii_allowed(uint8_t c) {
    return (c>='A'&&c<='Z') || (c>='a'&&c<='z') || (c>='0'&&c<='9')
        || c==' ' || c=='.' || c==',' || c=='!' || c=='?' || c=='/'
        || c=='-' || c=='\'' || c=='"';
}
int code_red_text_snapshot(struct CodeRedTextBridge *t, uint8_t out[CODE_RED_TEXT_BYTES]) {
    uint8_t value[CODE_RED_TEXT_BYTES];
    if(!out || !text_address_valid(t)) return 0;
    for(unsigned i=0;i<CODE_RED_TEXT_BYTES;i++)
        value[i]=t->mailbox->read(t->mailbox->context,t->address+i);
    if(text_u32(value)!=0x314e5243u || value[4]!=1 || value[5]!=0 || value[6]!=1
       || !value[7] || value[7]>CODE_RED_TEXT_LIMIT || !text_u32(value+8)
       || value[27]>value[7]) return 0;
    for(unsigned i=0;i<value[27];i++) if(!text_ascii_allowed(value[28+i])) return 0;
    memcpy(out,value,CODE_RED_TEXT_BYTES);
    return 1;
}
static void text_write_u32(struct CodeRedTextBridge *t,unsigned offset,uint32_t n) {
    for(unsigned i=0;i<4;i++) t->mailbox->write(t->mailbox->context,t->address+offset+i,(uint8_t)(n>>(8*i)));
}
int code_red_text_write(struct CodeRedTextBridge *t,uint32_t epoch,uint32_t session,
                        uint32_t sequence,unsigned action,const uint8_t *data,unsigned length) {
    uint8_t value[CODE_RED_TEXT_BYTES];
    if(!code_red_text_snapshot(t,value) || epoch!=t->mailbox->epoch
       || session!=text_u32(value+8) || !sequence || sequence<=text_u32(value+20)
       || (value[24] && sequence<=text_u32(value+16))
       || (action!=1 && action!=2) || length>value[7] || length>CODE_RED_TEXT_LIMIT
       || (length && !data)) return 0;
    for(unsigned i=0;i<length;i++) if(!text_ascii_allowed(data[i])) return 0;
    /* All writes stay inside the fixed naming mailbox. Publish the action last;
     * a newer pending sequence may replace an older one between ROM frames. */
    t->mailbox->write(t->mailbox->context,t->address+24,0);
    text_write_u32(t,12,session);
    text_write_u32(t,16,sequence);
    t->mailbox->write(t->mailbox->context,t->address+25,(uint8_t)length);
    for(unsigned i=0;i<16;i++) t->mailbox->write(t->mailbox->context,t->address+44+i,i<length?data[i]:0);
    t->mailbox->write(t->mailbox->context,t->address+24,(uint8_t)action);
    return 1;
}
void code_red_text_invalidate(struct CodeRedTextBridge *t) {
    if(text_address_valid(t)) t->mailbox->write(t->mailbox->context,t->address+24,0);
}
