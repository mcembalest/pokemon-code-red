/* Actual cartridge action test. Inputs reach the core; no script injection. */
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include "mailbox.h"
#include <stdio.h>
#include <stdlib.h>
#include <sys/select.h>
#include <unistd.h>
#include <string.h>
static void quiet(struct mLogger*l,int c,enum mLogLevel v,const char*f,va_list a){(void)l;(void)c;(void)v;(void)f;(void)a;}
static uint8_t read_byte(void*x,uint32_t a){struct mCore*c=x;return c->busRead8(c,a);}
static void write_byte(void*x,uint32_t a,uint8_t v){struct mCore*c=x;c->busWrite8(c,a,v);}
static void picture(const char*path,color_t*p){FILE*f=fopen(path,"wb");fprintf(f,"P6\n240 160\n255\n");for(int i=0;i<240*160;i++){unsigned char b[]={p[i]&255,(p[i]>>8)&255,(p[i]>>16)&255};fwrite(b,1,3,f);}fclose(f);}
static unsigned u32(const uint8_t*b,int o){return b[o]|b[o+1]<<8|b[o+2]<<16|(unsigned)b[o+3]<<24;}
int main(int argc,char**argv){
 if(argc!=5)return 2;
 const char *mode=argv[4];
 struct mLogger l={.log=quiet};mLogSetDefaultLogger(&l);
 struct mCore*c=mCoreFind(argv[1]);if(!c||!c->init(c))return 3;
 mCoreInitConfig(c,NULL);c->opts.useBios=false;color_t*p=calloc(240*160,sizeof(color_t));c->setVideoBuffer(c,p,240);if(!mCoreLoadFile(c,argv[1]))return 4;c->reset(c);
 struct CodeRedBridge b={c,read_byte,write_byte,strtoul(argv[2],NULL,0),1};
 uint8_t snapshot[36];unsigned last=0,epoch=0,request=0;int pending=0,resultFrames=0,run=0,pendingFrames=0;
 for(int frame=0;frame<16000;frame++){
  unsigned keys=frame==600?8:(frame>630&&frame%60<5?1:0);
  if(pending||resultFrames)keys=0;
  if(pending&&!strcmp(mode,"cancel")&&pendingFrames==30)keys=2;
  c->setKeys(c,keys);c->runFrame(c);
  if(resultFrames&&--resultFrames==0){picture(argv[3],p);printf("{\"event\":\"displayed\",\"run\":%d}\n",run);fflush(stdout);if(run==2||strcmp(mode,"success"))break;}
  if(code_red_snapshot(&b,snapshot)&&u32(snapshot,8)!=last){
   last=request=u32(snapshot,8);epoch=u32(snapshot,12);pending=1;pendingFrames=0;run++;
   printf("{\"event\":\"request\",\"run\":%d,\"id\":%u,\"epoch\":%u,\"stats\":[",run,request,epoch);
   for(int i=0;i<6;i++)printf("%s%u",i?",":"",snapshot[20+2*i]|snapshot[21+2*i]<<8);
   puts("]}");fflush(stdout);
  }
  if(pending){
   pendingFrames++;
   if(!strcmp(mode,"restore")){
    void *state=malloc(c->stateSize(c));
    if(!c->saveState(c,state)||!c->loadState(c,state))return 8;
    free(state);code_red_invalidate(&b);
    if(code_red_reply(&b,epoch,request,0,318))return 9;
    puts("{\"event\":\"restore_invalidated\"}");fflush(stdout);
    pending=0;resultFrames=100;continue;
   }
   if(!strcmp(mode,"reset")){
    code_red_invalidate(&b);c->reset(c);
    if(code_red_reply(&b,epoch,request,0,318))return 10;
    puts("{\"event\":\"reset_invalidated\"}");fflush(stdout);
    pending=0;resultFrames=100;continue;
   }
   if((!strcmp(mode,"timeout")||!strcmp(mode,"cancel"))&&pendingFrames>=610){pending=0;resultFrames=100;continue;}
   fd_set set;FD_ZERO(&set);FD_SET(0,&set);struct timeval t={0,0};
   if(select(1,&set,NULL,NULL,&t)>0){unsigned status,total;if(scanf("%u %u",&status,&total)!=2)return 5;
    if(!code_red_reply(&b,epoch,request,status,total))return 6;
    pending=0;resultFrames=100;
    printf("{\"event\":\"reply\",\"value\":%u}\n",total);fflush(stdout);
   }
   usleep(2000); /* Test harness only: lets independent Worker run between frames. */
  }
 }
 mCoreConfigDeinit(&c->config);c->deinit(c);free(p);return run==(strcmp(mode,"success")?1:2)?0:7;
}
