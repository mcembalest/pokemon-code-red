#include "mailbox.h"
static uint32_t read_n(struct CodeRedBridge *b, unsigned offset, unsigned n) {
    uint32_t value=0; unsigned i;
    for(i=0;i<n;i++) value|=(uint32_t)b->read(b->context,b->address+offset+i)<<(8*i);
    return value;
}
static void write_n(struct CodeRedBridge *b, unsigned offset, unsigned n, uint32_t value) {
    unsigned i;
    for(i=0;i<n;i++) b->write(b->context,b->address+offset+i,(uint8_t)(value>>(8*i)));
}
static int valid(struct CodeRedBridge *b) {
    return b->address>=0x02000000 && b->address<=0x02040000-CODE_RED_BYTES
        && read_n(b,0,4)==0x31445243 && read_n(b,4,2)==1;
}
int code_red_snapshot(struct CodeRedBridge *b, uint8_t out[CODE_RED_BYTES]) {
    unsigned i;
    if(!valid(b)||read_n(b,6,2)!=1||read_n(b,16,2)!=1) return 0;
    if(!b->epoch) b->epoch=1;
    if(read_n(b,12,4)==0) write_n(b,12,4,b->epoch);
    if(read_n(b,12,4)!=b->epoch) return 0;
    for(i=0;i<6;i++) if(read_n(b,20+2*i,2)>255) return 0;
    for(i=0;i<CODE_RED_BYTES;i++) out[i]=b->read(b->context,b->address+i);
    return 1;
}
int code_red_reply(struct CodeRedBridge *b,uint32_t epoch,uint32_t request,uint16_t status,uint32_t result) {
    if(!valid(b)||read_n(b,6,2)!=1||read_n(b,16,2)!=1||epoch!=b->epoch
      ||read_n(b,12,4)!=epoch||read_n(b,8,4)!=request||status>2||result>1530) return 0;
    write_n(b,18,2,status); write_n(b,32,4,result); write_n(b,6,2,2);
    return 1;
}
void code_red_invalidate(struct CodeRedBridge *b) {
    b->epoch++; if(!b->epoch) b->epoch=1;
    if(valid(b)&&read_n(b,6,2)==1) write_n(b,6,2,4);
}
