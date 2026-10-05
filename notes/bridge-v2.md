# Bridge v2 — sketch

## Today
- calc mailbox: 36 B @ `0x0203f4a8`, magic `CRD1`, op 1 = stats sum, op 2 = scratchpad
- naming mailbox: 60 B @ `0x02039990`, separate exports
- C side validates; JS polls every 16 ms (`setInterval(() => this.poll(), 16)`)
- G: `bridge/README.md`:
  > "Only the fixed stats-sum operation is accepted; stats are bounded to 255 and results to 1530."

## v2 shape
- one EWRAM block, static, small (fits 1,104 B budget):
  ```
  struct CodeRedIO {          // ~128 B static
    u32 magic;   // 'CRD2'
    u16 version;
    u16 state;   // idle / request / reply / cancelled
    u32 seq;     // request id
    u16 op;      // event type
    u16 len;     // payload bytes
    u8  payload[112];
  };
  ```
- larger payloads (code listings, long text): ROM `Alloc`s from heap for the duration, puts pointer+len in header; JS reads via EWRAM pointer
- JS-side registry: `op → handler(payload) → reply`
- ROM-side: one `special CodeRedCall` + `waitstate`; script reads reply into `gStringVar1..4` / `VAR_RESULT`

## Candidate ops (foundation only, no game design)
- `PING` — health check
- `RUN` — run code id N with JSON input, return int / short string
- `TEXT` — browser provides text to print in a native message box (Code Red dialogue from JS)
- `NAME` — naming screen input (replace current transport)
- `OPEN_EDITOR` — open scratchpad overlay, pause game
- `EVENT` — fire-and-forget telemetry (map enter, battle start) → browser updates progress

## Invariants to keep
- epoch check on reset/state load (stale replies dropped)
- guest QuickJS never sees EWRAM, only JSON
- ROM timeout per request (today 600 frames)
- browser text → ROM via charset encode table in JS (FireRed charset `charmap.txt`)
