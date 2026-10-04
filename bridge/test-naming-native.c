/* Normal intro -> native naming screen; no script injection. */
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void quiet(struct mLogger *l,int c,enum mLogLevel v,const char *f,va_list a){(void)l;(void)c;(void)v;(void)f;(void)a;}
static struct mCore *core;
static unsigned box;
static void frames(int n){core->setKeys(core,0);while(n--)core->runFrame(core);}
static void capture(const char *path,color_t *pixels){FILE *f=fopen(path,"wb");fprintf(f,"P6\n240 160\n255\n");for(int i=0;i<240*160;i++){unsigned char rgb[]={pixels[i]&255,pixels[i]>>8,pixels[i]>>16};fwrite(rgb,1,3,f);}fclose(f);}
static void request(unsigned session,unsigned seq,unsigned action,const char *text){size_t n=strlen(text);core->busWrite32(core,box+12,session);core->busWrite32(core,box+16,seq);core->busWrite8(core,box+25,n);for(unsigned i=0;i<16;i++)core->busWrite8(core,box+44+i,i<n?(unsigned char)text[i]:0);core->busWrite8(core,box+24,action);frames(2);}
static int matches(const char *text){size_t n=strlen(text);if(core->busRead8(core,box+27)!=n)return 0;for(unsigned i=0;i<n;i++)if(core->busRead8(core,box+28+i)!=(unsigned char)text[i])return 0;return 1;}
#define CHECK(expr) do{if(!(expr)){fprintf(stderr,"Failed line %d: %s\n",__LINE__,#expr);return 7;}}while(0)
int main(int argc,char **argv){
 if(argc!=5)return 2;
 box=strtoul(argv[2],0,0);
 struct mLogger logger={.log=quiet};mLogSetDefaultLogger(&logger);
 core=mCoreFind(argv[1]);CHECK(core&&core->init(core));mCoreInitConfig(core,NULL);core->opts.useBios=0;
 color_t *pixels=calloc(240*160,sizeof(color_t));core->setVideoBuffer(core,pixels,240);CHECK(mCoreLoadFile(core,argv[1]));core->reset(core);
 int found=0;
 for(int frame=0;frame<10000;frame++){core->setKeys(core,frame==600?8:(frame>630&&frame%60<5?1:0));core->runFrame(core);if(core->busRead32(core,box)==0x314E5243&&core->busRead8(core,box+6)){found=1;break;}}
 CHECK(found);frames(3);unsigned session=core->busRead32(core,box+8);CHECK(session!=0);CHECK(core->busRead8(core,box+7)==7);
 request(session,1,1,"Ab 12?!");CHECK(core->busRead8(core,box+26)==0);CHECK(matches("Ab 12?!"));
 request(session,2,1,"Ab 1");CHECK(matches("Ab 1"));
 request(session+1,3,1,"wrong");CHECK(core->busRead8(core,box+26)==1);CHECK(matches("Ab 1"));
 request(session,4,1,"{bad}");CHECK(core->busRead8(core,box+26)==2);CHECK(matches("Ab 1"));
 request(session,5,1,"Ab 12?!");CHECK(matches("Ab 12?!"));capture(argv[3],pixels);
 request(session,6,2,"");frames(90);CHECK(core->busRead8(core,box+6)==0);CHECK(core->busRead8(core,box+24)==0);CHECK(core->busRead8(core,box+27)==0);
 unsigned save2=core->busRead32(core,strtoul(argv[4],0,0));
 const unsigned char saved[]={0xBB,0xD6,0x00,0xA2,0xA3,0xAC,0xAB,0xFF};
 for(unsigned i=0;i<sizeof(saved);i++)CHECK(core->busRead8(core,save2+i)==saved[i]);
 puts("Native naming passed: ASCII replacement, shorter replacement, stale session rejection, unsupported character rejection, original confirmation path, exit invalidation.");
 mCoreConfigDeinit(&core->config);core->deinit(core);free(pixels);return 0;
}
