#include "../mailbox.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint8_t ram[64];
static uint8_t rd(void*x,uint32_t a){(void)x;assert(a>=0x02000000&&a<0x02000040);return ram[a-0x02000000];}
static void wr(void*x,uint32_t a,uint8_t v){(void)x;assert(a>=0x02000000&&a<0x02000000+36);ram[a-0x02000000]=v;}
static void request(void){memset(ram,0,sizeof(ram));ram[0]='C';ram[1]='R';ram[2]='D';ram[3]='1';ram[4]=1;ram[6]=1;ram[8]=7;ram[16]=1;for(int i=0;i<6;i++)ram[20+2*i]=45;}
int main(void){struct CodeRedBridge b={NULL,rd,wr,0x02000000,1};uint8_t out[36];request();assert(code_red_snapshot(&b,out));assert(out[12]==1);assert(!code_red_reply(&b,2,7,0,318));assert(!code_red_reply(&b,1,8,0,318));assert(!code_red_reply(&b,1,7,0,1531));assert(!code_red_reply(&b,1,7,3,0));assert(code_red_reply(&b,1,7,0,318));assert(ram[6]==2&&ram[32]==62&&ram[33]==1);assert(!code_red_reply(&b,1,7,0,318));request();assert(code_red_snapshot(&b,out));code_red_invalidate(&b);assert(b.epoch==2&&ram[6]==4);assert(!code_red_reply(&b,1,7,0,318));request();assert(code_red_snapshot(&b,out)&&out[12]==2);ram[21]=1;assert(!code_red_snapshot(&b,out));request();ram[4]=2;assert(!code_red_snapshot(&b,out));request();ram[16]=2;assert(code_red_snapshot(&b,out));assert(code_red_reply(&b,b.epoch,7,2,0));request();ram[16]=3;assert(!code_red_snapshot(&b,out));b.address=0x0203ffff;assert(!code_red_snapshot(&b,out));puts("mailbox bounds/version/operation/ID/epoch/replay/result tests passed");}
