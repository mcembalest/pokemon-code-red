// Code-speak: the ROM's move descriptions, item descriptions and Pokédex entries, mildly projected (playtest 1,
// 2026-10-12; tone sample approved tentatively). The rule: FireRed's sentence shape and length stay; one or two
// words turn toward code; the Pokémon stays an animal, the item stays an item. Flat text here — scripts/codespeak.py
// wraps it to FireRed's widths (moves 4 lines × 21, items 3 × 36, Pokédex 3 × 43) and writes patch 010 (`make text`).
// Edit this file, not the patch. Keys: Code Red move names (rules/moves.mjs), ITEM_ constants, species names.
// Anything not listed keeps its FireRed words. Vocabulary leaned on: system, signal, stream, patch, ping, boot,
// buffer, cache, loop, memory, packet, process, bug, noise, static, link, file, bytes.

export const MOVE_TEXT = {
  // Absorb
  SCRAPE: 'An attack that scrapes half the damage it dealt back into HP.',
  // Acid
  ACID: 'The foe is sprayed with a harsh, hide- melting acid that may corrode DEFENSE.',
  // Acid Armor
  CORRODE: 'The user liquefies its own cells into a shell that sharply raises DEFENSE.',
  // Aerial Ace
  SHRINK: 'A fast, small attack against one target. It can\'t be evaded.',
  // Agility
  TURBO: 'The user lightens its body and spins up to sharply boost its SPEED.',
  // Amnesia
  FORGET: 'Frees its memory of something and sharply raises SP. DEF.',
  // Astonish
  POPUP: 'An attack using a startling shout. It also may make the foe flinch.',
  // Attract
  MAGNET: 'If it is the other gender, the foe is pulled in and unlikely to attack.',
  // Aurora Beam
  FREEZER: 'A rainbow-colored beam of cold. It may lower the foe\'s ATTACK stat.',
  // Barrier
  SHIELD: 'The user raises a sturdy wall that sharply raises its DEFENSE stat.',
  // Baton Pass
  HANDOFF: 'The user switches out, handing its stat changes to the new battler.',
  // Belly Drum
  OVERDRIVE: 'The user maxes its ATTACK stat at the cost of half its full HP.',
  // Bind
  BIND: 'A long body or tentacles bind the foe\'s process for two to five turns.',
  // Bite
  PHISH: 'The user bites with vicious fangs. It may make the foe flinch.',
  // Body Slam
  CRUSH: 'The user drops its full body on the foe. It may leave the foe paralyzed.',
  // Bone Club
  CLUB: 'The foe is clubbed with a bone held in hand. It may make the foe flinch.',
  // Brick Break
  SMASH: 'An attack that also breaks any barrier like LIGHT SCREEN and REFLECT.',
  // Bubble
  DRIP: 'A drip of bubbles hits the foe. It may lower the foe\'s SPEED stat.',
  // Bubble Beam
  STREAM: 'A stream of bubbles strikes the foe. It may lower the foe\'s SPEED stat.',
  // Calm Mind
  IDLE: 'The user idles its mind to raise the SP. ATK and SP. DEF stats.',
  // Camouflage
  SPOOF: 'Spoofs the user\'s type depending on the location\'s terrain.',
  // Charge
  CHARGE: 'The user charges power to boost the ELECTRIC move it uses next.',
  // Clamp
  CLAMP: 'The foe is clamped and squeezed by the user\'s shell for two to five turns.',
  // Confuse Ray
  PEEK: 'The foe is exposed to a sinister ray that scrambles its senses.',
  // Confusion
  SCRAMBLE: 'A weak telekinetic attack that may also leave the foe scrambled.',
  // Constrict
  CLIP: 'The foe is attacked with long tentacles or vines. It may clip SPEED.',
  // Cosmic Power
  ALIGN: 'The user absorbs a mystic power to raise its DEFENSE and SP. DEF.',
  // Crabhammer
  HAMMER: 'A large pincer hammers the foe. It has a high critical-hit ratio.',
  // Cross Chop
  CROSSCUT: 'The foe is hit with double chops. It has a high critical-hit ratio.',
  // Curse
  ROOTKIT: 'A move that works differently for the GHOST-type and all the other types.',
  // Cut
  CUT: 'A basic attack. It can be used to cut thin trees and grass out of the way.',
  // Defense Curl
  LOCKDOWN: 'The user curls up to lock down weak spots and raise its DEFENSE stat.',
  // Destiny Bond
  HAUNT: 'If the user faints, the foe delivering the final hit also faints.',
  // Dig
  TUNNEL: 'An attack that hits on the 2nd turn. Can also be used to exit dungeons.',
  // Disable
  DISABLE: 'For a few turns, it disables the move the foe last used.',
  // Double Kick
  TWIN: 'Two legs are used to quickly kick the foe twice in one turn.',
  // Double Slap
  UNDO: 'The foe is slapped repeatedly, back and forth, two to five times.',
  // Double Team
  MIRROR: 'The user mirrors itself into copies to raise its evasiveness.',
  // Dragon Rage
  MELTDOWN: 'The foe is hit with a shock wave that always inflicts 40- HP damage.',
  // Drill Peck
  DRILL: 'A corkscrewing attack with the sharp beak acting as a drill.',
  // Ember
  BURNDISC: 'The foe is attacked with small flames. The foe may suffer a burn.',
  // Encore
  LOOP: 'Loops the foe on the move it last used for two to six turns.',
  // Endeavor
  CATCHUP: 'Gains power the fewer HP the user has compared with the foe.',
  // Explosion
  FORMAT: 'The user wipes itself out to inflict terrible damage, fainting.',
  // Faint Attack
  BACKDOOR: 'The user slips up close to the foe disarmingly, then hits without fail.',
  // Fake Out
  DECOY: 'An attack that hits first and causes flinching. Usable only on 1st turn.',
  // Feather Dance
  DAMPEN: 'The foe is covered with a mass of down that sharply dampens ATTACK.',
  // Fire Spin
  HOTLOOP: 'The foe is trapped in an intense loop of fire that rages two to five turns.',
  // Flail
  PANIC: 'A desperate attack that becomes more powerful the less HP the user has.',
  // Flamethrower
  OVERWRITE: 'The foe is scorched with intense flames. The foe may suffer a burn.',
  // Flame Wheel
  HOTSWAP: 'The user makes a fiery charge at the foe. It may cause a burn.',
  // Flatter
  FLATTER: 'Flattery scrambles the foe, but its SP. ATK also rises.',
  // Focus Energy
  COMPILE: 'The user takes a deep breath and focuses to raise its critical-hit ratio.',
  // Follow Me
  REDIRECT: 'The user redirects attention to itself, making foes attack only the user.',
  // Foresight
  BREAKPOINT: 'Completely negates the foe\'s efforts to heighten its ability to evade.',
  // Fury Attack
  SPAM: 'The foe is jabbed repeatedly with a horn or beak two to five times.',
  // Fury Swipes
  GREP: 'The foe is raked with sharp claws or scythes two to five times.',
  // Future Sight
  FORECAST: 'Two turns after this move is used, the foe is attacked psychically.',
  // Giga Drain
  HARVEST: 'A harsh attack that harvests half the damage it dealt back into HP.',
  // Glare
  DEADLOCK: 'The user intimidates the foe with the design on its belly to cause paralysis.',
  // Growl
  ERROR: 'The user growls a garbled note that makes the foe lower its ATTACK stat.',
  // Growth
  UPGRADE: 'The user\'s body is forced to grow, raising the SP. ATK stat.',
  // Grudge
  GRUDGE: 'If the user faints, this move deletes the PP of the move that finished it.',
  // Guillotine
  SEGFAULT: 'A vicious tearing attack with pincers. The foe will faint if it hits.',
  // Gust
  BROADCAST: 'Strikes the foe with a gust of wind whipped up by wings.',
  // Harden
  HARDEN: 'The user stiffens all the muscles in its body to raise its DEFENSE stat.',
  // Haze
  DEFROST: 'Resets all stat changes among all POKéMON engaged in battle.',
  // Headbutt
  REBOOT: 'The user sticks its head out and rams. It may make the foe flinch.',
  // Heat Wave
  THERMAL: 'The user exhales a heated breath to attack. It may also inflict a burn.',
  // Helping Hand
  SYNC: 'A move that boosts the power of the ally\'s attack in a battle.',
  // Horn Attack
  TAIL: 'The foe is jabbed with a sharply pointed horn to inflict damage.',
  // Horn Drill
  KILL: 'The horn is rotated like a drill to ram. The foe will faint if it hits.',
  // Hydro Pump
  FIREHOSE: 'A high volume of water is blasted at the foe under great pressure.',
  // Hyper Beam
  LASER: 'A severely damaging beam that makes the user rest on the next turn.',
  // Hyper Fang
  CRASH: 'The foe is attacked with sharp fangs. It may make the foe flinch.',
  // Hyper Voice
  SHOUT: 'The user lets loose a horribly loud shout with the power to damage.',
  // Hypnosis
  SUSPEND: 'Hypnotic suggestion is used to suspend the foe in a deep sleep.',
  // Ice Beam
  COLDSTORE: 'The foe is struck with an icy beam. It may freeze the foe solid.',
  // Icicle Spear
  SNAPSHOT: 'Sharp icicles are fired at the foe. It strikes two to five times.',
  // Imprison
  LOCK: 'Locks foes out of any move that is also known by the user.',
  // Ingrain
  ROOT: 'The user lays roots that restore HP on every turn. It can\'t switch out.',
  // Iron Tail
  IRONMASK: 'An attack with a steel-hard tail. It may lower the foe\'s DEFENSE stat.',
  // Karate Chop
  OVERCLOCK: 'The foe is attacked with a sharp chop. It has a high critical-hit ratio.',
  // Kinesis
  GLITCH: 'The user distracts the foe by bending a spoon. It may lower accuracy.',
  // Leech Life
  LEAK: 'An attack that leaks half the damage it dealt back into HP.',
  // Leech Seed
  'LEECH SEED': 'A seed is planted on the foe to leak some HP to the user on every turn.',
  // Leer
  EXPOSE: 'The foe is given an intimidating look that lowers its DEFENSE stat.',
  // Light Screen
  SCREEN: 'A wall of light cuts damage from SP. ATK attacks for five turns.',
  // Lock On
  TARGET: 'The user locks on to the foe, making the next move sure to hit.',
  // Low Kick
  DRAIN: 'A low, tripping kick that inflicts more damage on heavier foes.',
  // Magnitude
  RNG: 'A ground-shaking attack against all standing POKéMON. Its power is random.',
  // Meditate
  LINT: 'The user meditates to tidy its power and raise its ATTACK stat.',
  // Megahorn
  OVERFLOW: 'A brutal ramming attack delivered with a tough and impressive horn.',
  // Metal Claw
  HASH: 'The foe is attacked with steel claws. It may also raise the user\'s ATTACK.',
  // Metal Sound
  JAMMER: 'A horrible metallic screech is used to sharply lower the foe\'s SP. DEF.',
  // Mimic
  CLONE: 'The user clones the move last used by the foe for the rest of the battle.',
  // Minimize
  MINIMIZE: 'The user compresses all the cells in its body to raise its evasiveness.',
  // Mirror Move
  RELAY: 'The user relays the move last used by the foe right back at it.',
  // Moonlight
  DARKMODE: 'Restores the user\'s HP. The amount of HP regained varies with the weather.',
  // Mud Shot
  FLOOR: 'The user attacks by hurling mud. It also reduces the foe\'s SPEED.',
  // Mud Sport
  GROUND: 'Grounds ELECTRIC-type attacks while the user is in the battle.',
  // Nightmare
  NIGHTMARE: 'A sleeping foe is shown a nightmare that inflicts some damage every turn.',
  // Odor Sleuth
  SNIFF: 'Completely negates the foe\'s efforts to heighten its ability to evade.',
  // Pay Day
  PAYOUT: 'Numerous coins are hurled at the foe. Money is earned after battle.',
  // Peck
  FETCH: 'The foe is jabbed with a sharply pointed beak or horn.',
  // Petal Dance
  BLOOM: 'The user attacks with petals for two to three turns, then gets scrambled.',
  // Pin Missile
  DOUBLEFREE: 'Sharp pins are shot at the foe and hit two to five times at once.',
  // Poison Gas
  TROJAN: 'The foe is sprayed with a cloud of toxic gas that may poison the foe.',
  // Poison Powder
  PAYLOAD: 'A cloud of toxic dust is scattered. It may poison the foe.',
  // Poison Sting
  INJECT: 'The foe is stabbed with a toxic barb, etc. It may poison the foe.',
  // Pound
  POKE: 'A physical attack delivered with a long tail or a foreleg, etc.',
  // Protect
  FIREWALL: 'Enables the user to block all attacks. It may fail if used in succession.',
  // Psybeam
  SMUDGE: 'A peculiar ray is shot at the foe. It may leave the foe scrambled.',
  // Psychic
  PROFILE: 'A strong telekinetic attack. It may also lower the foe\'s SP. DEF stat.',
  // Psych Up
  COPYCAT: 'The user hypnotizes itself into copying any stat change made by the foe.',
  // Pursuit
  TRACE: 'An attack move that works especially well on a foe that is switching out.',
  // Quick Attack
  HOTFIX: 'An almost invisibly fast attack that is certain to strike first.',
  // Rage
  ECHO: 'An attack that becomes stronger each time the user is hit in battle.',
  // Rain Dance
  'DRAIN PIPE': 'A heavy rain pours for five turns, powering up WATER- type moves.',
  // Rapid Spin
  SPINUP: 'An attack that frees the user from BIND, WRAP, LEECH SEED, and SPIKES.',
  // Razor Leaf
  SHARDS: 'The foe is hit with a cutting leaf. It has a high critical-hit ratio.',
  // Recover
  RECOVER: 'A self-healing move that restores HP by up to half of the user\'s maximum HP.',
  // Reflect
  REFLECT: 'A wall of light cuts damage from physical attacks for five turns.',
  // Rest
  SLEEPMODE: 'The user sleeps for two turns to fully restore HP and clear any status problem.',
  // Roar
  ROTATE: 'The foe is made to switch out with an ally. In the wild, the battle ends.',
  // Rock Blast
  BUCKSHOT: 'The user hurls two to five hard rocks at the foe to attack.',
  // Rock Throw
  BOOT: 'The foe is attacked with a shower of small, easily thrown rocks.',
  // Rock Tomb
  BRICK: 'Boulders are hurled at the foe. It also lowers the foe\'s SPEED if it hits.',
  // Role Play
  PROXY: 'The user mimics the foe completely and copies the foe\'s ability.',
  // Rollout
  ROLLOUT: 'A 5-turn rolling attack that becomes stronger each time it hits.',
  // Safeguard
  CHECKSUM: 'It protects the user\'s party from all status problems for five turns.',
  // Sand Attack
  SANDBOX: 'A lot of sand is hurled in the foe\'s face, reducing its accuracy.',
  // Sand Tomb
  QUICKSAND: 'The foe is trapped inside a painful sandstorm for two to five turns.',
  // Scary Face
  FREEZE: 'Frightens the foe with a scary face to sharply reduce its SPEED.',
  // Scratch
  SLICE: 'Hard, pointed, and sharp claws rake the foe.',
  // Screech
  DISTORTION: 'An ear-splitting screech is emitted to sharply reduce the foe\'s DEFENSE.',
  // Secret Power
  CHEATCODE: 'An attack that may have an additional effect that varies with the terrain.',
  // Seismic Toss
  CALL: 'A gravity-fed throw that causes damage matching the user\'s level.',
  // Self Destruct
  WIPE: 'The user blows up to inflict severe damage, even making itself faint.',
  // Shadow Ball
  PHANTOM: 'A shadowy blob is hurled at the foe. May also lower the foe\'s SP. DEF.',
  // Shock Wave
  SHORT: 'A rapid jolt of electricity strikes the foe. It can\'t be evaded.',
  // Silver Wind
  GLITTER: 'The foe is attacked with a silver dust. It may raise all the user\'s stats.',
  // Sing
  DIM: 'A soothing song in a calming voice lulls the foe into a deep slumber.',
  // Skull Bash
  HEADER: 'The user raises its DEFENSE in the 1st turn, then attacks in the 2nd turn.',
  // Slam
  FLOOD: 'The foe is struck with a long tail, vines, etc.',
  // Slash
  TRUNCATE: 'The foe is slashed with claws, etc. It has a high critical-hit ratio.',
  // Sleep Powder
  SLEEP: 'A sleep-inducing dust is scattered in high volume around a foe.',
  // Sludge
  MALWARE: 'Toxic sludge is hurled at the foe. It may poison the target.',
  // Sludge Bomb
  VIRUS: 'Filthy sludge is hurled at the foe. It may poison the target.',
  // Smog
  SWARM: 'The foe is attacked with exhaust gases. It may also poison the foe.',
  // Smokescreen
  BLUR: 'An obscuring cloud of smoke or ink blurs the foe\'s accuracy.',
  // Solar Beam
  SUNBURST: 'A 2-turn move that blasts the foe with absorbed energy in the 2nd turn.',
  // Sonic Boom
  BUZZ: 'The foe is hit with a shock wave that always inflicts 20- HP damage.',
  // Spark
  SPARK: 'An electrically charged tackle that may also paralyze the foe.',
  // Spikes
  SPIKES: 'A trap of spikes is laid around the foe\'s party to hurt foes switching in.',
  // Spike Cannon
  VOLLEY: 'Sharp spikes are fired at the foe to strike two to five times.',
  // Spit Up
  DUMP: 'The power built using CACHE is dumped at once for attack.',
  // Splash
  SPLASH: 'The user just flops and splashes around without having any effect.',
  // Stockpile
  CACHE: 'The user caches up power for use later. It can be used three times.',
  // Stomp
  STOMP: 'The foe is stomped with a big foot. It may make the foe flinch.',
  // String Shot
  SKIP: 'The foe is bound with strings shot from the mouth to reduce its SPEED.',
  // Stun Spore
  STALL: 'Paralyzing dust is scattered wildly. It may stall the foe.',
  // Superpower
  BRUTEFORCE: 'A powerful attack, but it also lowers the user\'s ATTACK and DEFENSE stats.',
  // Supersonic
  FEEDBACK: 'The user generates odd sound waves. It may scramble the foe.',
  // Super Fang
  BISECT: 'The user attacks with sharp fangs and halves the foe\'s HP.',
  // Swagger
  HYPE: 'A move that scrambles the foe, but also sharply raises its ATTACK.',
  // Swallow
  PURGE: 'The energy it built using CACHE is absorbed to restore HP.',
  // Sweet Scent
  LURE: 'Lures the foe to reduce evasiveness. It also attracts wild POKéMON.',
  // Swift
  SWIFT: 'Star-shaped rays that never miss are fired at all foes in battle.',
  // Synthesis
  REGROW: 'Restores the user\'s HP. The amount of HP regained varies with the weather.',
  // Tackle
  PING: 'A physical attack in which the user slams its whole body into the foe\'s system.',
  // Tail Whip
  DOWNGRADE: 'The user wags its tail cutely, making the foe lower its DEFENSE stat.',
  // Take Down
  SHUTDOWN: 'A reckless, full- body charge attack that also hurts the user a little.',
  // Teleport
  SSH: 'Use it to flee from any wild POKéMON. Also warps to the last POKé CENTER.',
  // Thrash
  THRASH: 'The user rampages about for two to three turns, then becomes scrambled.',
  // Thunder
  OVERLOAD: 'A brutal lightning attack that may also leave the foe paralyzed.',
  // Thunderbolt
  SPIKE: 'A strong electrical spike that may also leave the foe paralyzed.',
  // Thunder Punch
  ZAP: 'The foe is punched with an electrified fist. It may leave the foe paralyzed.',
  // Thunder Shock
  SURGE: 'A jolt of current spiked into the foe that may also leave it paralyzed.',
  // Thunder Wave
  POWERCUT: 'A weak electric shock that is sure to cause paralysis if it hits.',
  // Transform
  MORPH: 'The user transforms into a copy of the foe with even the same move set.',
  // Trick
  SWAP: 'A move that tricks the foe into swapping held items with the user.',
  // Tri Attack
  TRIPLE: 'A simultaneous 3-beam attack that may paralyze, burn, or freeze the foe.',
  // Twineedle
  DOUBLE: 'The foe is stabbed twice with foreleg stingers. It may poison the foe.',
  // Twister
  CYCLONE: 'A vicious twister attacks the foe. It may make the foe flinch.',
  // Vice Grip
  PINCH: 'Huge, impressive pincers grip and squeeze the foe.',
  // Vine Whip
  CRAWL: 'The foe is struck with slender, whip- like vines.',
  // Waterfall
  CASCADE: 'A powerful charge attack. It can also be used to climb a waterfall.',
  // Water Gun
  FLUSH: 'The foe is struck with a stream of water forced from the mouth in one burst.',
  // Water Pulse
  FILTER: 'An attack with a pulsing blast of water. It may also scramble the foe.',
  // Water Sport
  THROTTLE: 'Throttles FIRE-type attacks while the user is in the battle.',
  // Whirlwind
  FAILOVER: 'The foe is made to switch out with an ally. In the wild, the battle ends.',
  // Will O Wisp
  FLICKER: 'A sinister, bluish white flame flickers at the foe to inflict a burn.',
  // Wing Attack
  UPLOAD: 'The foe is struck with large, imposing wings spread wide.',
  // Withdraw
  BUFFER: 'The user withdraws its body into its hard shell, raising its DEFENSE stat.',
  // Wrap
  WRAP: 'A long body or vines are used to wrap the foe for two to five turns.',
  // Yawn
  TIMEOUT: 'A huge yawn lulls the foe into falling asleep on the next turn.',
}

export const ITEM_TEXT = {
  ITEM_ANTIDOTE: 'A spray-type medicine. It cleans a poisoning out of one POKéMON\'s system.',
  ITEM_AWAKENING: 'A spray-type medicine. It wakes a sleeping POKéMON\'s system.',
  ITEM_BICYCLE: 'A folding bicycle that allows faster movement than the RUNNING SHOES.',
  ITEM_BIKE_VOUCHER: 'Take this voucher to the BIKE SHOP in CERULEAN CITY and exchange it for a bicycle.',
  ITEM_BURN_HEAL: 'A spray-type medicine. It cools one POKéMON of a burn.',
  ITEM_CALCIUM: 'A nutritious drink for POKéMON. It raises the base SP. ATK stat of one POKéMON.',
  ITEM_CARBOS: 'A nutritious drink for POKéMON. It raises the base SPEED stat of one POKéMON.',
  ITEM_CHARCOAL: 'An item to be held by a POKéMON. A combustible fuel that boosts the power of FIRE-type moves.',
  ITEM_COIN_CASE: 'A case for holding COINS obtained at the GAME CORNER. It holds up to 9,999 COINS.',
  ITEM_DIRE_HIT: 'Raises the critical-hit ratio of POKéMON in battle. Wears off if the POKéMON is withdrawn.',
  ITEM_DOME_FOSSIL: 'A fossil of an ancient, seafloor- dwelling POKéMON. Its data appears to be part of a shell.',
  ITEM_ENERGY_POWDER: 'A very bitter medicine powder. It restores the HP of one POKéMON by 50 points.',
  ITEM_ENERGY_ROOT: 'A very bitter root. It restores the HP of one POKéMON by 200 points.',
  ITEM_ESCAPE_ROPE: 'A long, durable rope. Use it to exit instantly from a cave or a dungeon.',
  ITEM_EVERSTONE: 'An item to be held by a POKéMON. The holding POKéMON is locked out of evolving.',
  ITEM_FAME_CHECKER: 'A device that logs what you\'ve heard and seen about famous people, for recall anytime.',
  ITEM_FIRE_STONE: 'A peculiar stone that makes certain species of POKéMON evolve. It is colored orange.',
  ITEM_FRESH_WATER: 'Water with a high mineral content. It restores the HP of one POKéMON by 50 points.',
  ITEM_GREAT_BALL: 'A good, quality BALL that offers a higher POKéMON capture rate than a standard POKé BALL.',
  ITEM_GUARD_SPEC: 'An item that blocks stat reduction among party POKéMON for five turns after use.',
  ITEM_HEAL_POWDER: 'A very bitter medicine powder. It clears all the status problems of one POKéMON.',
  ITEM_HELIX_FOSSIL: 'A fossil of an ancient, seafloor- dwelling POKéMON. Its data appears to be part of a seashell.',
  ITEM_HP_UP: 'A nutritious drink for POKéMON. It raises the base HP of one POKéMON.',
  ITEM_ICE_HEAL: 'A spray-type medicine. It thaws a frozen POKéMON\'s system.',
  ITEM_IRON: 'A nutritious drink for POKéMON. It raises the base DEFENSE stat of one POKéMON.',
  ITEM_ITEMFINDER: 'A device used for finding items. If there is a hidden item nearby when it is used, it pings.',
  ITEM_LEAF_STONE: 'A peculiar stone that makes certain species of POKéMON evolve. It has a leaf pattern.',
  ITEM_LEMONADE: 'A very sweet drink. It restores the HP of one POKéMON by 80 points.',
  ITEM_MIRACLE_SEED: 'An item to be held by a POKéMON. A seed imbued with life that boosts the power of GRASS-type moves.',
  ITEM_MYSTIC_WATER: 'An item to be held by a POKéMON. A teardrop-shaped gem that boosts the power of WATER-type moves.',
  ITEM_NET_BALL: 'A somewhat different BALL that works especially well on WATER- and BUG-type POKéMON.',
  ITEM_NUGGET: 'A nugget of pure gold that gives off a lustrous gleam. It can be sold at a high price.',
  ITEM_OAKS_PARCEL: 'A parcel to be delivered to PROF. OAK from VIRIDIAN CITY\'s POKéMON MART.',
  ITEM_OLD_ROD: 'An old and beat-up fishing rod. Use it by any body of water to fish for wild POKéMON.',
  ITEM_PARALYZE_HEAL: 'A spray-type medicine. It frees one POKéMON\'s system from paralysis.',
  ITEM_POKE_BALL: 'A BALL thrown to capture a wild POKéMON. Inside, its system is stored as a capsule.',
  ITEM_POKE_DOLL: 'An attractive doll. Use it to flee from any battle with a wild POKéMON.',
  ITEM_POTION: 'A spray-type wound medicine. It patches the HP of one POKéMON by 20 points.',
  ITEM_PP_UP: 'Slightly raises the maximum PP of a selected move for one POKéMON.',
  ITEM_PROTEIN: 'A nutritious drink for POKéMON. It raises the base ATTACK stat of one POKéMON.',
  ITEM_REPEL: 'Filters weak wild POKéMON out of appearing for 100 steps.',
  ITEM_REVIVAL_HERB: 'A very bitter medicinal herb. It reboots a fainted POKéMON, restoring HP fully.',
  ITEM_REVIVE: 'A medicine that reboots a fainted POKéMON, restoring HP by half the maximum amount.',
  ITEM_SODA_POP: 'A fizzy soda drink. It restores the HP of one POKéMON by 60 points.',
  ITEM_SS_TICKET: 'The ticket required for sailing on the ferry S.S. ANNE. It has a drawing of a ship on it.',
  ITEM_SUPER_POTION: 'A spray-type wound medicine. It patches the HP of one POKéMON by 50 points.',
  ITEM_SUPER_REPEL: 'Filters weak wild POKéMON out of appearing for 200 steps.',
  ITEM_TEA: 'An aromatic tea prepared by an old lady. It will slake even the worst thirst.',
  ITEM_TEACHY_TV: 'A television set that is tuned to a program with useful tips for novice TRAINERS.',
  ITEM_THUNDER_STONE: 'A peculiar stone that makes certain species of POKéMON evolve. It has a thunderbolt pattern.',
  ITEM_TOWN_MAP: 'A very convenient map that can be viewed anytime. It even shows your present location.',
  ITEM_WATER_STONE: 'A peculiar stone that makes certain species of POKéMON evolve. It is a clear light blue.',
  ITEM_X_ACCURACY: 'Raises the accuracy stat of POKéMON in battle. Wears off if the POKéMON is withdrawn.',
  ITEM_X_ATTACK: 'Raises the ATTACK stat of POKéMON in battle. Wears off if the POKéMON is withdrawn.',
  ITEM_X_DEFEND: 'Raises the DEFENSE stat of POKéMON in battle. Wears off if the POKéMON is withdrawn.',
  ITEM_X_SPECIAL: 'Raises the SP. ATK stat of POKéMON in battle. Wears off if the POKéMON is withdrawn.',
  ITEM_X_SPEED: 'Raises the SPEED stat of POKéMON in battle. Wears off if the POKéMON is withdrawn.',
  ITEM_ZINC: 'A nutritious drink for POKéMON. It raises the base SP. DEF stat of one POKéMON.',
}

// Pokédex: zoology stays (the owner's dial, 2026-10-12); one word turns. Move names are Code Red's.
export const DEX_TEXT = {
  ABRA: 'It sleeps for 18 hours a day. It runs a variety of extrasensory processes even while asleep.',
  ARBOK: 'The pattern on its belly appears to be a frightening face. Weak foes will flee just at the sight of the pattern.',
  ARCANINE: 'A POKéMON that is described in Chinese legends. It is said to race at an unbelievable clock speed.',
  BEEDRILL: 'May appear in a swarm. Flies at violent speeds, all the while stabbing with the toxic stinger on its rear.',
  BELLSPROUT: 'Its bud looks like a human face. Because of the bud, it is rumored to be a type of legendary mandrake plant.',
  BLASTOISE: 'It crushes its foe under its heavy body to cause fainting. In a pinch, it will withdraw inside its shell.',
  BULBASAUR: 'There is a plant seed on its back right from the day this POKéMON boots up. The seed slowly grows larger.',
  BUTTERFREE: 'The wings are protected by rain-repellent dust. As a result, this POKéMON can fly about even in rain.',
  CATERPIE: 'It is covered with a green skin. When it grows, it sheds the skin, wraps itself in silk, and becomes a cocoon.',
  CHARIZARD: 'Its wings can carry this POKéMON close to an altitude of 4,600 feet. It blows out fire at very high temperatures.',
  CHARMANDER: 'From the time it boots up, a flame burns at the tip of its tail. Its life would end if the flame were to go out.',
  CHARMELEON: 'It lashes about with its tail to knock down its foe. It then tears up the fallen opponent with sharp claws.',
  CLOYSTER: 'Its shell is extremely hard. It cannot be shattered, even with a bomb. The shell opens only when it is attacking.',
  DITTO: 'It can freely recombine its own cellular code to transform into other life- forms.',
  DROWZEE: 'A descendent of the legendary animal baku, which is said to eat dreams. It is skilled at hypnotism.',
  EEVEE: 'An extremely rare POKéMON that may evolve in a number of different ways depending on its input.',
  EKANS: 'A very common sight in grassland, etc. It flicks its tongue in and out to scan for danger in its surroundings.',
  ELECTABUZZ: 'It loves to feed on strong electricity. It occasionally appears around large power plants and so on.',
  ELECTRODE: 'It explodes in response to even minor input. It is feared, with the nickname of “The Bomb Ball.”',
  FEAROW: 'Its huge and magnificent wings can keep it aloft in the sky. It can remain flying a whole day without landing.',
  GLOOM: 'Its pistils exude an incredibly foul odor. The horrid stench can cause fainting at a distance of 1.25 miles.',
  GOLDEEN: 'Its dorsal and pectoral fins are strongly developed like muscles. It can swim at a speed of five knots.',
  GOLDUCK: 'The forelegs are webbed, helping to make it an adept swimmer. It can be seen swimming elegantly in lakes, etc.',
  GRIMER: 'Sludge exposed to X rays from the moon transformed into GRIMER. It loves feeding on corrupted things.',
  GROWLITHE: 'Very friendly and faithful to people. It will try to repel enemies by barking and biting.',
  GYARADOS: 'It has an extremely aggressive nature. The LASER it shoots from its mouth totally incinerates all targets.',
  HORSEA: 'It maintains balance using its tail, which is wound up like a coil. It may spray ink from its mouth.',
  HYPNO: 'It carries a pendulum-like device. There once was an incident in which it took away a child it hypnotized.',
  IVYSAUR: 'There is a plant bulb on its back. When it absorbs nutrients, the bulb is said to blossom into a large flower.',
  JIGGLYPUFF: 'It captivates foes with its huge, round eyes, then lulls them to sleep by singing a soothing melody.',
  KADABRA: 'It happened one morning - a boy with extrasensory powers awoke in bed transformed into KADABRA.',
  KAKUNA: 'This POKéMON is in a temporary stage while compiling its body. It is almost completely unable to move on its own.',
  KINGLER: 'Its large and hard pincer has 10,000- horsepower strength. However, being so big, it is unwieldy to move.',
  KOFFING: 'Its thin, balloon-like body is inflated by horribly toxic gases. It reeks when it is nearby.',
  KRABBY: 'It can be found near the sea. The large pincers grow back if they are torn out of their sockets.',
  MAGIKARP: 'It is virtually worthless in terms of both power and speed. It is the most weak and pathetic POKéMON in the world.',
  MAGNEMITE: 'It moves while constantly hovering. It discharges POWERCUT and so on from the units at its sides.',
  MAGNETON: 'A linked cluster formed of several MAGNEMITE. It discharges powerful magnetic waves at high voltage.',
  MANKEY: 'Light and agile on its feet, and ferocious in temperament. When angered, it flies into an uncontrollable frenzy.',
  MEOWTH: 'All it does is sleep during the daytime. At night, it patrols its territory with its eyes aglow.',
  METAPOD: 'Even though it is encased in a sturdy shell, the body inside is tender. It can\'t withstand a harsh attack.',
  MUK: 'It is usually undetectable because it blends in with the ground. Touching it can cause terrible poisoning.',
  NIDOKING: 'It is recognized by its rock-hard hide and its extended horn. Be careful with the horn as it contains venom.',
  NIDOQUEEN: 'The body is covered by stiff, needle- like scales. If it becomes excited, the needles bristle outwards.',
  NIDORANF: 'Though small, it must be treated with caution because of its powerfully toxic barbs. The female has smaller horns.',
  NIDORANM: 'Its large ears are flapped like wings when it is listening to distant signals. It extends toxic barbs when angered.',
  NIDORINA: 'The female has a gentle temperament. It emits ultrasonic cries that have the power to befuddle foes.',
  NIDORINO: 'It is easily angered. By swinging its well- developed horn wildly, it can even punch through diamond.',
  NINETALES: 'It has nine long tails and fur that gleams gold. It is said to run for 1,000 years.',
  ODDISH: 'Its scientific name is “Oddium Wanderus.” At night, it is said to walk nearly 1,000 feet on its two roots.',
  PERSIAN: 'Has a vicious temperament. Beware if it raises its tail straight up. It is a signal that it is about to pounce and bite.',
  PIDGEOT: 'It spreads its gorgeous wings widely to intimidate enemies. It races through the skies at Mach-2 speed.',
  PIDGEOTTO: 'The claws on its feet are well developed. It can carry prey such as an EXEGGCUTE to its nest over 60 miles away.',
  PIDGEY: 'Does not like to fight. It hides in tall grass and so on, foraging for food such as small bugs.',
  PIKACHU: 'It has small electric sacs on both its cheeks. If threatened, it discharges a burst of signal from the sacs.',
  POLIWAG: 'Its slick black skin is thin and damp. A part of its internal organs can be seen through the skin as a spiral pattern.',
  POLIWHIRL: 'Its two legs are well developed. Even though it can live on the ground, it prefers living in water.',
  PRIMEAPE: 'It is always outrageously furious. If it gives chase, it will tenaciously trace the target no matter how far.',
  PSYDUCK: 'It is constantly wracked by a headache. When the headache turns intense, it begins running mysterious powers.',
  RAICHU: 'Its electric charges can reach even 100,000 volts. Careless contact can cause even an Indian elephant to faint.',
  RATICATE: 'Its rear feet have three toes each. They are webbed, enabling it to swim across rivers.',
  RATTATA: 'Its fangs are long and very sharp. They grow continuously, so it gnaws on hard things to whittle them down.',
  SANDSHREW: 'It burrows and lives underground. If threatened, it curls itself up into a ball for protection.',
  SANDSLASH: 'It is adept at attacking with the spines on its back and its sharp claws while quickly scurrying about.',
  SEADRA: 'Its body bristles with sharp spikes. Carelessly trying to touch it could cause fainting from the spikes.',
  SEAKING: 'The horn on its head is sharp like a drill. It bores a hole in a boulder to make its nest.',
  SHELLDER: 'It is encased in a shell that is harder than diamond. Inside, however, it is surprisingly tender.',
  SLOWPOKE: 'It is always vacantly lost in thought, but no one knows what it is processing. It is good at fishing with its tail.',
  SPEAROW: 'It busily flits around here and there. Even if it is frail, it can be a tough foe that uses RELAY.',
  SQUIRTLE: 'When it retracts its long neck into its shell, it squirts out a stream of water with vigorous force.',
  STARMIE: 'This POKéMON has a geometric body. Because of its body, the locals suspect that it is an alien creature.',
  STARYU: 'It appears in large numbers by seashores. At night, its central core blinks with a red light.',
  TENTACOOL: 'Its eyes are as transparent as crystals. From them, it shoots mysterious beams of light.',
  TENTACRUEL: 'It has 80 tentacles that move about freely. They can sting, causing poisoning and sharp, stabbing pain.',
  VENOMOTH: 'The wings are covered with dustlike scales. Every time it flaps its wings, it looses highly toxic dust.',
  VENONAT: 'Its eyes act as radar, enabling it to be active in darkness. The eyes can also shoot powerful beams.',
  VENUSAUR: 'A bewitching aroma wafts from its flower. The fragrance becalms those engaged in a battle.',
  VICTREEBEL: 'Lures prey into its mouth with a honeylike aroma. The helpless prey is melted with a dissolving fluid.',
  VOLTORB: 'A life-form whose identity is unknown. It is said to DISTORTION or suddenly WIPE.',
  VULPIX: 'While young, it has six gorgeous tails. When it grows, several new tails are sprouted.',
  WARTORTLE: 'This POKéMON is very popular as a pet. Its fur-covered tail is a symbol of its longevity.',
  WEEDLE: 'Often found in forests and grasslands. It has a sharp, toxic barb of around two inches on top of its head.',
  WEEPINBELL: 'The leafy parts act as cutters for slashing foes. It spits a fluid that dissolves everything.',
  WEEZING: 'Very rarely, a sudden mutation can result in two small KOFFING twins becoming conjoined as a WEEZING.',
  WIGGLYTUFF: 'Its fur is extremely fine, dense, and supple. The exquisitely pleasant fur conveys an image of luxury.',
}
