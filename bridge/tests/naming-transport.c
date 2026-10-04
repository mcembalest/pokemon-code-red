#include "../naming-transport.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint8_t ram[60];
static unsigned writes,last_offset;
static uint8_t rd(void *x,uint32_t a) {
    (void)x;assert(a>=0x02001000 && a<0x02001000+60);return ram[a-0x02001000];
}
static void wr(void *x,uint32_t a,uint8_t v) {
    (void)x;assert(a>=0x02001000 && a<0x02001000+60);
    last_offset=a-0x02001000;ram[last_offset]=v;writes++;
}
static void active(void) {
    memset(ram,0,sizeof(ram));memcpy(ram,"CRN1",4);
    ram[4]=1;ram[6]=1;ram[7]=7;ram[8]=9;
    ram[27]=3;memcpy(ram+28,"RED",3);writes=0;
}
static void reject(struct CodeRedTextBridge *t,unsigned epoch,unsigned session,unsigned sequence,
                   unsigned action,const uint8_t *data,unsigned length) {
    uint8_t before[60];memcpy(before,ram,60);unsigned n=writes;
    assert(!code_red_text_write(t,epoch,session,sequence,action,data,length));
    assert(writes==n && !memcmp(before,ram,60));
}
int main(void) {
    struct CodeRedBridge b={NULL,rd,wr,0x02000000,3};
    struct CodeRedTextBridge t={&b,0x02001000};
    struct {uint8_t before,out[60],after;} output={0xa5,{0},0x5a};
    active();assert(code_red_text_snapshot(&t,output.out));
    assert(output.before==0xa5 && output.after==0x5a && output.out[27]==3);
    reject(&t,2,9,1,1,(const uint8_t *)"ABC",3);
    reject(&t,3,10,1,1,(const uint8_t *)"ABC",3);
    reject(&t,3,9,0,1,(const uint8_t *)"ABC",3);
    reject(&t,3,9,1,0,(const uint8_t *)"ABC",3);
    reject(&t,3,9,1,3,(const uint8_t *)"ABC",3);
    reject(&t,3,9,1,1,(const uint8_t *)"ABCDEFGH",8);
    reject(&t,3,9,1,1,NULL,1);
    reject(&t,3,9,1,1,(const uint8_t *)"{}",2);
    reject(&t,3,9,1,1,(const uint8_t *)"\n",1);
    reject(&t,3,9,1,1,(const uint8_t *)"\xc3\xa9",2);
    assert(code_red_text_write(&t,3,9,1,1,(const uint8_t *)"A-b'9!?",7));
    assert(last_offset==24 && ram[24]==1 && ram[12]==9 && ram[16]==1 && ram[25]==7);
    assert(!memcmp(ram+44,"A-b'9!?",7));for(unsigned i=51;i<60;i++)assert(!ram[i]);
    reject(&t,3,9,1,1,(const uint8_t *)"REPLAY",6);
    assert(code_red_text_write(&t,3,9,2,1,(const uint8_t *)"NEW",3));
    assert(ram[16]==2 && !memcmp(ram+44,"NEW",3)); /* Coalesce before ROM polls. */
    ram[20]=2;ram[24]=0;reject(&t,3,9,2,1,(const uint8_t *)"REPLAY",6);
    assert(code_red_text_write(&t,3,9,3,2,NULL,0));assert(last_offset==24 && ram[24]==2);
    b.epoch++;code_red_text_invalidate(&t);assert(ram[24]==0);
    reject(&t,3,9,4,1,(const uint8_t *)"OLD",3);
    assert(code_red_text_write(&t,4,9,4,1,NULL,0));assert(ram[25]==0);
    active();ram[6]=0;assert(!code_red_text_snapshot(&t,output.out));
    active();ram[4]=2;assert(!code_red_text_snapshot(&t,output.out));
    active();ram[5]=1;assert(!code_red_text_snapshot(&t,output.out));
    active();ram[7]=16;assert(!code_red_text_snapshot(&t,output.out));
    active();ram[7]=0;assert(!code_red_text_snapshot(&t,output.out));
    active();ram[8]=0;assert(!code_red_text_snapshot(&t,output.out));
    active();ram[27]=8;assert(!code_red_text_snapshot(&t,output.out));
    active();ram[28]='[';assert(!code_red_text_snapshot(&t,output.out));
    active();t.address=0x0203ffff;assert(!code_red_text_snapshot(&t,output.out));
    puts("naming fixed bounds/ASCII/session/epoch/sequence/coalescing/invalidation tests passed");
}
