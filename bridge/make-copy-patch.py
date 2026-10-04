"""Copy-only delta: contains source offsets/lengths, never ROM bytes or assets."""
from pathlib import Path
import hashlib,struct,sys
root=Path(__file__).resolve().parents[1]
base=Path(sys.argv[1]).read_bytes();target=Path(sys.argv[2]).read_bytes()
assert hashlib.sha1(base).hexdigest()=='41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc'
assert len(base)==len(target)==16*1024*1024
# Aligned anchors identify moved unchanged data; unmatched bytes also use copies.
anchors={}
for i in range(0,len(base)-31,16):anchors.setdefault(base[i:i+32],i)
byte_offsets={value:base.index(bytes([value])) for value in range(256)}
records=[];pos=0
while pos<len(target):
 source=anchors.get(target[pos:pos+32]) if pos+32<=len(target) else None
 length=1
 if source is None:source=byte_offsets[target[pos]]
 else:
  length=32;limit=min(len(base)-source,len(target)-pos)
  while length+4096<=limit and base[source+length:source+length+4096]==target[pos+length:pos+length+4096]:length+=4096
  while length<limit and base[source+length]==target[pos+length]:length+=1
 if records and records[-1][0]+records[-1][1]==source:records[-1]=(records[-1][0],records[-1][1]+length)
 else:records.append((source,length))
 pos+=length
patch=b'CRCP1'+struct.pack('<II',len(target),len(records))+b''.join(struct.pack('<II',*r) for r in records)
assert b''.join(base[o:o+n] for o,n in records)==target
out=Path(sys.argv[3]);out.write_bytes(patch)
print({'bytes':len(patch),'records':len(records),'targetSHA1':hashlib.sha1(target).hexdigest(),'patchSHA256':hashlib.sha256(patch).hexdigest(),'embeddedROMBytes':0},flush=True)
