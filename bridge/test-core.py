"""Exercise the actual custom exports in the pinned native libretro build."""
import ctypes as C,json,struct,subprocess,re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
lib=C.CDLL(str(root/'.cache/core-mgba/mgba_libretro.so'))
ENV=C.CFUNCTYPE(C.c_bool,C.c_uint,C.c_void_p)
VIDEO=C.CFUNCTYPE(None,C.c_void_p,C.c_uint,C.c_uint,C.c_size_t)
AUDIO=C.CFUNCTYPE(None,C.c_int16,C.c_int16)
BATCH=C.CFUNCTYPE(C.c_size_t,C.c_void_p,C.c_size_t)
POLL=C.CFUNCTYPE(None)
INPUT=C.CFUNCTYPE(C.c_int16,C.c_uint,C.c_uint,C.c_uint,C.c_uint)
keys=0
@ENV
def env(command,data):
 if command in (9,31):C.cast(data,C.POINTER(C.c_char_p))[0]=b'/tmp';return True
 if command==10:return True
 if command==52:C.cast(data,C.POINTER(C.c_uint))[0]=0;return True
 return False
video=VIDEO(lambda *_:None);audio=AUDIO(lambda *_:None);batch=BATCH(lambda _,n:n);poll=POLL(lambda:None)
input_cb=INPUT(lambda port,device,index,key:1 if keys&(1<<key) else 0)
for name,cb in [('environment',env),('video_refresh',video),('audio_sample',audio),('audio_sample_batch',batch),('input_poll',poll),('input_state',input_cb)]:getattr(lib,'retro_set_'+name)(cb)
class Game(C.Structure):_fields_=[('path',C.c_char_p),('data',C.c_void_p),('size',C.c_size_t),('meta',C.c_char_p)]
lib.retro_load_game.argtypes=[C.POINTER(Game)];lib.retro_load_game.restype=C.c_bool
lib.ejs_code_red_snapshot.argtypes=[C.c_void_p,C.c_uint];lib.ejs_code_red_snapshot.restype=C.c_int
lib.ejs_code_red_reply.argtypes=[C.c_uint]*4;lib.ejs_code_red_reply.restype=C.c_int
lib.ejs_code_red_epoch.restype=C.c_uint
lib.retro_serialize_size.restype=C.c_size_t
lib.retro_serialize.argtypes=[C.c_void_p,C.c_size_t];lib.retro_serialize.restype=C.c_bool
lib.retro_unserialize.argtypes=[C.c_void_p,C.c_size_t];lib.retro_unserialize.restype=C.c_bool
lib.retro_get_memory_data.argtypes=[C.c_uint];lib.retro_get_memory_data.restype=C.c_void_p
lib.retro_init();game=Game(str(root/'build/code-red.gba').encode(),None,0,None);assert lib.retro_load_game(C.byref(game))
request=(C.c_uint8*36)()
assert not lib.ejs_code_red_snapshot(request,35)
found=False
for frame in range(12000):
 keys=8 if frame==600 else (256 if frame>630 and frame%60<5 else 0) # libretro A is ID 8
 lib.retro_run()
 if lib.ejs_code_red_snapshot(request,36):found=True;break
assert found,'Actual ROM action did not publish request'
magic,version,state,request_id,epoch,operation,status,*tail=struct.unpack('<IHHIIHH6HI',bytes(request))
assert (magic,version,state,operation)==(0x31445243,1,1,1)
result=subprocess.check_output(['node',root/'bridge/calculate.mjs',json.dumps({'stats':tail[:6]})],text=True,timeout=5).strip()
assert result=='318'
assert not lib.ejs_code_red_reply(epoch,request_id+1,0,318)
assert lib.ejs_code_red_reply(epoch,request_id,0,318)
keys=0
for _ in range(100):lib.retro_run()
address=int(re.search(r'(0x[0-9a-f]+)\s+gStringVar1',(root/'.cache/pokefirered/pokefirered.map').read_text()).group(1),16)
ram=lib.retro_get_memory_data(2)
assert C.string_at(ram+address-0x02000000,4)==bytes([0xa4,0xa2,0xa9,0xff]),'In-game string is not 318'
# Reach a second real request, then load its pending state through the actual hook.
def next_request():
 global keys
 for f in range(1800):
  keys=256 if f%60<5 else 0
  lib.retro_run()
  if lib.ejs_code_red_snapshot(request,36):
   fields=struct.unpack('<IHHIIHH6HI',bytes(request))
   return fields[3],fields[4]
 raise AssertionError('Repeated interaction did not issue request')
pending_id,pending_epoch=next_request()
size=lib.retro_serialize_size();save=C.create_string_buffer(size)
assert lib.retro_serialize(save,size)
old=lib.ejs_code_red_epoch();assert lib.retro_unserialize(save,size);assert lib.ejs_code_red_epoch()!=old
assert not lib.ejs_code_red_reply(pending_epoch,pending_id,0,318)
assert not lib.ejs_code_red_snapshot(request,36)
keys=0
for _ in range(100):lib.retro_run()
assert C.string_at(ram+address-0x02000000,10)==bytes([0xbd,0xd5,0xe2,0xd7,0xd9,0xe0,0xe0,0xd9,0xd8,0xff]),'Pending load did not cancel in-game request'
pending_id,pending_epoch=next_request()
old=lib.ejs_code_red_epoch();lib.retro_reset();assert lib.ejs_code_red_epoch()!=old
assert not lib.ejs_code_red_reply(pending_epoch,pending_id,0,318)
lib.retro_unload_game();lib.retro_deinit()
print(json.dumps({'pinned_native_core_exports':True,'actual_rom_action':True,'quickjs_result':318,'in_game_string_verified':True,'load_reset_hooks':True,'wasm_build_verified':False},indent=2))
