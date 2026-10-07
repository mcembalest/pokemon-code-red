# Moves (draft 2026-10-07)

Owner: rename moves with plain technical words that sound cool; moves shape the code. FireRed's type, power, accuracy, effect, animation stay.
Battle rule (draft): clean the foe's bytes the way its type demands → compute what the move asks for → strike once with the answer, within budget. Hit = right answer; miss = wrong answer / crash / timeout / over budget / no strike / two strikes. Crits = FireRed's own roll.
Names ≤ 12 chars (Gen 3 limit). ★ = a starter learns it before Brock. Edit names here.

| Move | Was | Type | Power/acc | Effect | The code computes |
|---|---|---|---|---|---|
| PING ★ | Tackle | Normal | 35/95 | hit | how many bytes there are |
| CUT ★ | Scratch | Normal | 40/100 | hit | the first 3 bytes |
| POKE | Pound | Normal | 40/100 | hit | the second byte |
| FETCH | Peck | Flying | 35/100 | hit | the last byte |
| SPIKE | Horn Attack | Normal | 65/100 | hit | the largest byte's position |
| BOOTDRIVE | Rock Throw | Rock | 50/90 | hit | the sum of the bytes |
| FORKBOMB | Slam | Normal | 80/75 | hit | every byte doubled |
| CRAWL ★ | Vine Whip | Grass | 35/100 | hit | every other byte, starting with the first |
| FLUSH | Water Gun | Water | 40/100 | hit | the bytes with every 0 removed |
| UPLOAD | Wing Attack | Flying | 60/100 | hit | the bytes joined into one string with '-' |
| UNDO | Double Slap | Normal | 15/85 | multi hit | the bytes without the first one |
| SPAM | Fury Attack | Normal | 15/85 | multi hit | the first byte, repeated 5 times |
| BRUTEFORCE | Fury Swipes | Normal | 18/80 | multi hit | every byte under 50 |
| SNAPSHOT | Icicle Spear | Ice | 10/100 | multi hit | a copy of the bytes, unchanged |
| SUSPEND | Hypnosis | Psychic | –/60 | sleep | the smallest byte |
| SCREENSAVER | Sing | Normal | –/55 | sleep | how many bytes are even |
| HIBERNATE | Sleep Powder | Grass | –/75 | sleep | the average byte, rounded down |
| STANDBY | Spore | Grass | –/100 | sleep | the first byte minus the last |
| GLITCH | Kinesis | Psychic | –/80 | accuracy down | each byte's last digit |
| SANDBOX | Sand Attack | Ground | –/100 | accuracy down | every byte, capped at 100 |
| OBFUSCATE | Smokescreen | Normal | –/100 | accuracy down | every byte XOR 255 |
| SCRAMBLE | Confusion | Psychic | 50/100 | confuse hit | the bytes sorted from largest to smallest |
| DEEPFAKE | Psybeam | Psychic | 65/100 | confuse hit | every byte rounded to the nearest 10 |
| DROPTABLE | Water Pulse | Water | 60/100 | confuse hit | the bytes with every byte under 50 dropped |
| PHISH | Bite | Dark | 60/100 | flinch hit | the second-to-last byte |
| REBOOT | Headbutt | Normal | 70/100 | flinch hit | the first byte plus the last |
| SEGFAULT | Hyper Fang | Normal | 80/90 | flinch hit | the byte at position (first byte mod how many bytes) |
| OVERCLOCK | Karate Chop | Fighting | 50/100 | high critical | the sum of every byte squared |
| SHARDS | Razor Leaf | Grass | 55/95 | high critical | the bytes split into pairs |
| TRUNCATE | Slash | Normal | 70/100 | high critical | the first half of the bytes (rounded down) |
| BROWNOUT | Glare | Normal | –/75 | paralyze | the smallest byte times how many bytes |
| SPINLOCK | Stun Spore | Grass | –/75 | paralyze | how many bytes are under 50 |
| POWERCUT | Thunder Wave | Electric | –/100 | paralyze | the bytes with the largest one removed |
| INJECT | Poison Sting | Poison | 15/100 | poison hit | the bytes with a 1 added at the end |
| MALWARE | Sludge | Poison | 65/100 | poison hit | every byte plus the first byte |
| BOTNET | Smog | Poison | 20/70 | poison hit | the sum of the bytes over 100 |
| TROJAN | Poison Gas | Poison | –/55 | poison | the bytes with the largest moved to the front |
| PAYLOAD | Poison Powder | Poison | –/75 | poison | how many bytes are odd |
| SCRAPE | Absorb | Grass | 20/100 | absorb | half the sum, rounded down |
| LEAK | Leech Life | Bug | 20/100 | absorb | the sum of the last two bytes |
| AUTOSCALE | Aerial Ace | Flying | 60/– | always hit | every byte halved, rounded down |
| HOTKEY | Swift | Normal | 60/– | always hit | the first byte plus 1 |
| EXPOSE | Leer | Normal | –/100 | defense down | the largest byte's position, counting from 1 |
| DOWNGRADE ★ | Tail Whip | Normal | –/100 | defense down | the largest byte |
| FIREWALL | Harden | Normal | –/– | defense up | the smallest byte's position |
| BACKUP ★ | Withdraw | Water | –/– | defense up | the bytes in reverse order |
| SHORTCIRCUIT | Spark | Electric | 65/100 | paralyze hit | the largest byte minus the smallest |
| SURGE | Thunder Shock | Electric | 40/100 | paralyze hit | the largest byte plus 1 |
| WIPEDISC ★ | Bubble | Water | 20/100 | speed down hit | every byte set to 0 |
| BRICK | Rock Tomb | Rock | 50/80 | speed down hit | the bytes sorted from smallest to largest |
| DEADLOCK | Bind | Normal | 15/75 | trap | the first and last byte, as a pair |
| HANG | Wrap | Normal | 15/85 | trap | the bytes with the first byte added again at the end |
| RATELIMIT ★ | Growl | Normal | –/100 | attack down | how many bytes are over 100 |
| COLDSTORAGE | Aurora Beam | Ice | 65/100 | attack down hit | the 3 smallest bytes |
| HASH ★ | Metal Claw | Steel | 50/95 | attack up hit | the sum of the bytes mod 256 |
| BURNDISC ★ | Ember | Fire | 40/100 | burn hit | every byte plus 1 |
| SPOOF | Camouflage | Normal | –/100 | camouflage | how many letters are in the foe's type |
| UPS | Charge | Electric | –/100 | charge | the largest byte times 2 |
| FEEDBACK | Supersonic | Normal | –/55 | confuse | the sum of the first two bytes |
| ROOTKIT | Curse | Mystery | –/– | curse | every byte minus the smallest |
| LOCKDOWN | Defense Curl | Normal | –/– | defense curl | the first byte times 2 |
| DISTORTION | Screech | Normal | –/85 | defense down 2 | the sum minus the largest byte |
| CORRUPT | Acid | Poison | 40/100 | defense down hit | every byte with its last digit dropped |
| KILL -9 | Disable | Normal | –/55 | disable | the last byte minus the first |
| COPYPASTE | Double Kick | Fighting | 30/100 | double hit | the bytes, then the bytes again |
| KERNELPANIC | Dragon Rage | Dragon | 1/100 | dragon rage | how many bytes, times 10 |
| LOOP | Encore | Normal | –/100 | encore | the first byte, once for every byte |
| HONEYPOT | Sweet Scent | Normal | –/100 | evasion down | the largest even byte |
| MIRROR | Double Team | Normal | –/– | evasion up | the bytes, then the bytes in reverse |
| RM -RF | Self Destruct | Normal | 200/100 | explosion | an empty list |
| PANIC | Flail | Normal | 1/100 | flail | how many bytes are under 10 |
| POPUP | Astonish | Ghost | 30/100 | flinch minimize hit | the middle byte (rounded down) |
| COMPILE | Focus Energy | Normal | –/– | focus energy | the bytes joined into one string with no separators |
| REDIRECT | Follow Me | Normal | –/100 | follow me | the smallest byte's position, counting from 1 |
| DEBUGGER | Foresight | Normal | –/100 | foresight | the positions of every byte over 100 |
| BROADCAST | Gust | Flying | 40/100 | gust | every byte plus the last byte |
| PAIRPROGRAM | Helping Hand | Normal | –/100 | helping hand | the first byte times the second |
| CRYPTOMINER ★ | Leech Seed | Grass | –/90 | leech seed | the sum of the bytes at even positions |
| THROW | Seismic Toss | Fighting | 1/100 | level damage | the foe's level |
| UNDERFLOW | Low Kick | Fighting | 1/100 | low kick | the smallest byte minus 1 |
| RNG | Magnitude | Ground | 1/100 | magnitude | the sum of the bytes mod 10 |
| MINIFY | Minimize | Normal | –/– | minimize | the bytes with duplicates removed |
| GROUNDWIRE | Mud Sport | Ground | –/100 | mud sport | every byte, capped at 128 |
| TRACEROUTE | Pursuit | Dark | 40/100 | pursuit | the position of the first byte over 100 |
| HOTFIX | Quick Attack | Normal | 40/100 | quick attack | the first byte |
| RECURSION | Rage | Normal | 20/100 | rage | the sum of the digits of the sum of the bytes |
| THRASHING | Thrash | Normal | 90/100 | rampage | every byte times how many bytes |
| SPINUP | Rapid Spin | Normal | 20/100 | rapid spin | the bytes with the first one moved to the end |
| TLS | Reflect | Psychic | –/– | reflect | every byte XOR 42 |
| RESTORE | Recover | Normal | –/– | restore hp | the bytes before cleanup, exactly as scanned |
| BACKTRACE | Revenge | Fighting | 60/100 | revenge | the bytes over 50, last to first |
| FAILOVER | Whirlwind | Normal | –/100 | roar | the bytes with the last one moved to the front |
| ROLLBACK | Rollout | Rock | 30/90 | rollout | the bytes without the last one |
| DIALUP | Sonic Boom | Normal | 1/90 | sonicboom | how many bytes are over 20 |
| UPGRADE | Growth | Normal | –/– | special attack up | the largest byte plus the smallest |
| JAMMER | Metal Sound | Steel | –/85 | special defense down 2 | the bytes with every third one removed |
| STRINGIFY | String Shot | Bug | –/95 | speed down | the bytes as a JSON string |
| BLUESCREEN | Scary Face | Normal | –/90 | speed down 2 | how many bytes equal the largest |
| NOOP | Splash | Normal | –/– | splash | nothing (null) |
| SSH | Teleport | Psychic | –/– | teleport | the foe's name |
| DOUBLEFREE | Twineedle | Bug | 25/100 | twineedle | the first byte, twice |
| HEATSINK | Water Sport | Water | –/100 | water sport | every byte, capped at 200 |
| TIMEOUT | Yawn | Normal | –/100 | yawn | half the largest byte, rounded down |

## Foe type cleanup (draft)
- NORMAL: nothing · ROCK: skip 255s · WATER: skip 0s · POISON: skip negatives · BUG: keep the first of each duplicate · others: to draft from notes/types.md
- first rival battle: tutorial, no cleanup needed
