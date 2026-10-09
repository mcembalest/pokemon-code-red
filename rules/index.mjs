// Code Red battle rules: one browser-safe module shared by the game (player/) and the simulator (models/lab/).
// What we calibrate in the simulator is what the player plays.
export * from './moves.mjs'
export * from './formats.mjs'
export * from './growth.mjs'
export * from './turn.mjs'
export { FIRERED } from './firered.mjs'
export * from './doubt.mjs'
