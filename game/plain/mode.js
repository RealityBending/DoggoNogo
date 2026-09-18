/**
 * @file Plain (non-gamified) mode: the `?gamified=0` comparison condition.
 *
 * REMOVABLE. This folder exists for one study — DoggoNogo against a barebones version of the same
 * tasks — and is designed to be deleted whole. To remove the feature: delete `game/plain/`, revert
 * the `?gamified` block in game/index.html, and revert the `coverScreen` / `scoreScreen` /
 * `gamified` options in game/engine.js. No level file, core.js, game.js or stimuli.js change is
 * involved, and nothing here mutates the game's own objects.
 *
 * ---
 *
 * A plain level is a SUBCLASS of the real level, not a patched copy:
 *
 *     plain -> level1 -> DoggoNogoBaseLevel
 *
 * `Object.create(level1)` puts the game level in the prototype chain and the overrides shadow it as
 * own properties. Everything not listed in ./levels.js therefore resolves to the game's own
 * implementation and is literally the same function object — which is the property the whole
 * comparison rests on, and which `assertTaskLogicShared` below checks on load.
 *
 * Two mechanisms carry most of the stripping:
 *
 *  1. A nulled `assets` object. `safePlay`, `startBackgroundMusic`, `stopBackgroundMusic` and
 *     `drawImageCover` all already bail on a missing asset, so this silences every cue and removes
 *     every image without touching a single call site — including the `safePlay(soundFast)` calls
 *     that sit inline inside each level's `handleKeyDown`, which must stay the game's own function.
 *  2. One `draw()` override (./levels.js), which drops six decoration layers at once.
 *
 * What deliberately KEEPS running, invisibly, because the two conditions would otherwise stop being
 * matched: the score, the phase progression it gates (and therefore how many trials a level lasts),
 * the adaptive threshold, the 200 ms post-response refractory, and the photodiode marker.
 */

import { plainCoverScreen, plainScoreScreen } from "./screens.js"
import { plainLevelOverrides, plainLevelParams, plainParams, sharedPlainOverrides } from "./levels.js"

/**
 * Methods that MUST remain the game's own in the plain condition.
 *
 * Every one of these either schedules a trial, classifies a response, moves the score, advances a
 * phase or writes the data log. If a future edit shadows one of them by accident, the comparison is
 * silently broken in a way no screenshot would show — so this list is asserted at install time
 * instead.
 */
const TASK_LOGIC = [
    "update",
    "updateTrialSchedule",
    "startNewTrial",
    "isAwaitingStimulusOnset",
    "isBelatedResponse",
    "cancelPendingStimulus",
    "getRealizedISI",
    "placeStimulus",
    "composeStimulusItems",
    "handleKeyDown",
    "onResponseTimeout",
    "finishTrial",
    "getEffectiveThreshold",
    "computeMedian",
    "computePhaseTarget",
    "getPhaseTargets",
    "ensurePhaseTarget",
    "_checkForPhaseOrLevelEnd",
    "startPhaseBreak",
    "updateBreak",
    "resumeFromBreak",
    "endLevel",
    "_logTrialData",
    "getStimulusLogFields",
    "now",
    "eventTime",
]

/** Params that must not differ between conditions, whatever else a plain override does. */
const MATCHED_PARAMS = [
    "trialsNumber",
    "minTrialsPerPhase",
    "minISI",
    "maxISI",
    "meanISIDecay",
    "minScore",
    "maxScore",
    "gameDifficulty",
    "stimulusLength",
    "stimulusThickness",
    "stimulusDiameter",
    "stimulusSizeJitter",
    "stimulusOffsetX",
    "stimulusJitterX",
    "stimulusJitterY",
    "stimulusFallDistance",
    "neutralProportionPhase2",
    "incongruentProportionPhase3",
    "stimulusColorMode",
]

/**
 * Asserts that the plain level still shares the game level's task logic and timing.
 *
 * Runs on every install, not just in development: it costs nothing, and a broken comparison found
 * in the console beats one found in the data.
 */
function assertTaskLogicShared(plain, game, number) {
    const divergedMethods = TASK_LOGIC.filter((name) => typeof game[name] === "function" && plain[name] !== game[name])
    if (divergedMethods.length) {
        console.error(
            `plain mode, level ${number}: these must stay the game's own implementation but are shadowed — ${divergedMethods.join(", ")}. ` +
                `The two conditions are no longer matched on task logic.`,
        )
    }
    const divergedParams = MATCHED_PARAMS.filter((key) => key in game.params && plain.params[key] !== game.params[key])
    if (divergedParams.length) {
        console.error(`plain mode, level ${number}: these params differ from the game's — ${divergedParams.join(", ")}.`)
    }
    // `phases` is an array, so it is compared by content rather than by the identity the spread preserves.
    if (game.params.phases && JSON.stringify(plain.params.phases) !== JSON.stringify(game.params.phases)) {
        console.error(`plain mode, level ${number}: params.phases differs from the game's.`)
    }
}

/**
 * Every asset key the level declares, set to null.
 *
 * The one exception is `imgPlayer1`: `initializeDimensions` reads its `naturalWidth`/`naturalHeight`
 * to size the player box, so it gets a 1:1 stand-in rather than null. Nothing draws it — the box
 * only matters because the player's position is where feedback bubbles and the catch animation
 * would have been anchored, and neither exists here.
 */
function nulledAssets(gameAssets) {
    const out = {}
    for (const key of Object.keys(gameAssets || {})) out[key] = null
    out.imgPlayer1 = { naturalWidth: 1, naturalHeight: 1 }
    return out
}

/** Builds the plain variant of one level. The game level is not modified. */
function toPlainLevel(gameLevel, number) {
    const plain = Object.create(gameLevel)
    Object.assign(plain, sharedPlainOverrides, plainLevelOverrides[number] || {})
    // Own copies, so a param tweak (or `?trials=`) applies to the plain run without reaching back
    // into the game object. The spread runs at install time, so every value not named in the plain
    // tables is whatever the game level currently holds.
    plain.params = { ...gameLevel.params, ...plainParams, ...(plainLevelParams[number] || {}) }
    plain.assets = nulledAssets(gameLevel.assets)
    // Mirrors the last line of every level file: a level object carries a usable state before
    // `start()` replaces it, and the plain one must not share the game object's.
    plain.state = plain.getInitialState()
    assertTaskLogicShared(plain, gameLevel, number)
    return plain
}

/**
 * Maps a chain of `{ level, cutscene, number }` entries to their plain equivalents.
 *
 * The cutscene is dropped here rather than in the host page, so a chain is plain whichever entry
 * point built it.
 */
export function installPlainMode(chain) {
    console.warn("Plain (non-gamified) mode: decoration, sound and trial feedback are off. Task logic and timing are unchanged.")
    return chain.map((entry) => ({
        ...entry,
        level: toPlainLevel(entry.level, entry.number),
        cutscene: null,
    }))
}

/** Engine options the plain condition runs with; spread into `DoggoNogoEngine.run`'s options. */
export const plainEngineOptions = {
    coverScreen: plainCoverScreen,
    scoreScreen: plainScoreScreen,
    gamified: false,
    dataButton: false,
    // Nothing here draws the artwork or plays the cues, so the global manifest is not fetched:
    // the condition loads no image and no audio at all, and a missing or broken asset cannot
    // affect a plain run.
    assetManifest: { images: [], audio: [] },
}
