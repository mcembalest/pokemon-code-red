# Types ↔ storage & security concepts (owner + another model, 2026-10-06)

Source: owner's "typechart-email" (v2), screenshots in chat 2026-10-06. Built on the **Gen 6+ chart (18 types)**. Code Red keeps **FireRed's Gen 3 chart** (owner: "keep all type matchups") → no Fairy; a few Gen 3 cells differ from Gen 6 (Steel resists Ghost and Dark in Gen 3) — their stories need a check.

| Type | Concept | Defining matchup |
|---|---|---|
| Normal | Files | immune to Ghost: spyware watching inert data sees nothing |
| Fire | Writes | beats Grass: only overwriting actually destroys data |
| Water | Wipe / erase | weak to Electric: a power cut mid-wipe leaves recoverable data |
| Grass | Sprawl (logs, caches, deleted-not-overwritten blocks) | beats Water: `rm` doesn't remove anything |
| Electric | Power | can't touch Ground: grounded, literally |
| Ice | Local snapshots (ZFS/btrfs/VSS) | four weaknesses, resists only itself: "snapshots are not backups" |
| Fighting | Raw compute (brute force, flooding, exhaustion) | can't hit Ghost: can't brute-force what you can't see |
| Poison | Malware | can't touch Steel: you can't infect ciphertext |
| Ground | On-prem / physical plant | can't touch Flying: the cloud isn't in your building |
| Flying | Cloud / remote | beats Fighting: autoscaling absorbs brute force |
| Psychic | Detection (AV, heuristics, anomaly models) | can't touch Dark: valid credentials look normal |
| Bug | Bugs | beats Dark: privilege escalation |
| Rock | Hardware | weak to Water (liquid), Fighting (thermal), Ground (theft), Steel (encrypted brick) |
| Ghost | Spyware | beats Psychic: rootkits subvert the thing meant to find them |
| Dragon | Root / kernel | (Gen 6: can't touch Fairy — root inside a VM isn't root) |
| Dark | Identity-based access control | immune to Psychic; beats Ghost via least privilege |
| Steel | Encryption | immune to Poison; resists Flying, Psychic, Dragon; weak to Fire, Fighting, Ground |
| (Fairy) | Virtualization layer | not in FireRed |

Structure: Fire/Water/Grass = disk-lifecycle triangle (write, erase, remnants). Ground vs Flying = on-prem vs cloud. Fighting vs Psychic = muscle vs mind. Dragon/(Fairy)/Steel = privilege ladder.

Cells worth quoting: Electric→Water: a power cut mid-wipe leaves recoverable data · Water→Grass ½×: `rm` doesn't remove anything · Ice→Water ½×: snapshots live on the disk · Steel→Ice: `vssadmin delete shadows` · Steel→Rock: a stolen encrypted laptop is a brick · Rock→Flying: us-east-1 · Water→Ground: remote wipe beats whoever has the box · Psychic→Dark 0×: valid credentials look normal · Fighting→Rock: compute cooks hardware.

Known stretches (8): Ice→Ground · Fighting→Ice · Fighting→Steel · Fighting→Bug ½× · Ground→Grass ½× · Bug→Fire ½× · Bug→Steel ½× · Rock→Bug.

## Use in Code Red (proposal)
- type = what a Pokémon's code *is about*; a move's challenge is flavored by its type (EMBER writes/overwrites; WATER GUN wipes; VINE WHIP sprawls logs; THUNDERSHOCK = power)
- super effective / not very effective lines can quote the cell's story (short)
- physical vs special split = FireRed's (by type): physical Normal, Fighting, Flying, Poison, Ground, Rock, Bug, Ghost, Steel · special Fire, Water, Grass, Electric, Ice, Psychic, Dragon, Dark
