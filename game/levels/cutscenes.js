/**
 * @file Cutscene step sequences, consumed by `CutsceneRunner`.
 */
export const level1Cutscene = [
    { type: "fill", color: "black" },
    { type: "text", what: "You are an investigator tasked with bringing down criminals that mistreat animals.", animation: "appear" },
    { type: "wait", duration: 3000 },
    { type: "sound", what: "level1/sound_intro_metaldoor.mp3" },
    { type: "image", what: "level1/intro_background.webp", animation: "reveal", duration: 1000 },
    { type: "wait", duration: 1500 },
    { type: "text", what: "But during your last raid, you heard something...", animation: "appear" },
    { type: "wait", duration: 1500 },
    { type: "sound", what: "level1/sound_intro_dogwhining.mp3" },
    { type: "wait", duration: 1500 },
    { type: "image", what: "level1/player_1.webp", animation: "reveal", duration: 800 },
    { type: "wait", duration: 1000 },
    { type: "image", what: "level1/intro_background.webp", animation: "appear" },
    { type: "image", what: "level1/player_1.webp", animation: "appear" },
    { type: "text", what: "A puppy has been forgotten!", animation: "appear", y: 80 },
    { type: "text", what: "You decide to take him home, and name him...", animation: "appear", y: 90 },
    { type: "wait", duration: 2000 },
    { type: "fill", color: "black" },
    { type: "text", what: "Doggo", animation: "reveal", duration: 1000, fontSize: 96, background: "black", font: "display" },
    { type: "wait", duration: 1000 },
]

export const level2Cutscene = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 1000 },
    // The two opening lines sit high, just under the top letterbox bar, so the cat has the
    // middle of the frame to himself.
    { type: "text", what: "However, someone has been watching with great attention", animation: "appear", y: 23 },
    { type: "text", what: "the arrival of DOGGO...", animation: "appear", y: 31 },
    { type: "wait", duration: 2000 },
    // Nogo's own sprite surfacing out of the dark, rather than a separate pair-of-eyes asset:
    // `emerge` grows the reveal from `focus`, which is aimed at his eyes (0.36, 0.69 of the
    // sprite box - he is crouched, so his head sits low and left of centre). The eyes arrive
    // first and the rest of the cat follows, which is what the dedicated eyes image used to do
    // with an asset and a prompt of its own.
    //
    // Placement: his ink starts ~20% down its box, so with a 40%-tall box centred at 53% the
    // tail tip lands at ~41% - clear of the second line above - and the paws at 73%, leaving room
    // for the two closing lines below without touching the bottom bar.
    { type: "image", what: "level2/player_1.webp", animation: "emerge", duration: 2600, height: 40, y: 53, focus: { x: 0.36, y: 0.69 } },
    { type: "wait", duration: 2200 },
    // Both closing lines land under Nogo on one page, so the name and the threat are read with
    // the cat in view rather than over black.
    //
    // The `fill` is what clears the two earlier lines - nothing else on a black stage does, since
    // a text step only repaints the background and sprite over what is already on the canvas. But
    // `fill` also drops the sprite, so Nogo is immediately re-placed at the same size and position,
    // with `appear` rather than a fade: he is already revealed, this is the same shot continuing.
    { type: "fill", color: "black" },
    { type: "image", what: "level2/player_1.webp", animation: "appear", height: 40, y: 53 },
    { type: "text", what: "This someone's name is NOGO", animation: "appear", y: 80 },
    { type: "wait", duration: 1800 },
    { type: "text", what: "And now, he is hungry too...", animation: "appear", y: 88 },
    { type: "wait", duration: 2600 },
]

// --- Illusion arc (Levels 3-5) -----------------------------------------------------------------
// Tentative cutscenes: minimal text, with `[ ART: ... ]` text steps standing in for artwork that
// does not exist yet. Replace each placeholder with an `image` step once the asset is made; the
// grey colour and smaller size mark them as stage directions rather than narration. Each
// placeholder's target file is noted next to it; the generation prompts live in
// prompts/make_prompts.py (pipeline step 7, "Illusion arc: cutscene panels").
const artPlaceholder = (what) => ({ type: "text", what: `[ ART: ${what} ]`, animation: "appear", y: 45, color: "#8b98ab", fontSize: 28 })

export const level3Cutscene = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 800 },
    { type: "text", what: "Nogo has learned he cannot outrun Doggo.", animation: "appear", y: 40 },
    { type: "wait", duration: 2200 },
    { type: "text", what: "So he turns to trickery...", animation: "appear", y: 50 },
    { type: "wait", duration: 2200 },
    { type: "fill", color: "black" },
    artPlaceholder("the lawn at dusk, bones scattered at odd angles"), // -> level3/cutscene_bones.png
    { type: "wait", duration: 1500 },
    { type: "text", what: "Overnight, bones appear all over the lawn. None lying straight.", animation: "appear", y: 72 },
    { type: "wait", duration: 2200 },
    { type: "text", what: "Trust your eyes... if you can.", animation: "appear", y: 82 },
    { type: "wait", duration: 2400 },
]

export const level4Cutscene = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 800 },
    artPlaceholder("Nogo grinning, a spool of red ribbon in his paws"), // -> level4/cutscene_ribbon.png
    { type: "wait", duration: 1500 },
    { type: "text", what: "The tilted bones didn't fool Doggo for long.", animation: "appear", y: 72 },
    { type: "wait", duration: 2200 },
    { type: "text", what: "So Nogo raids the gift box...", animation: "appear", y: 82 },
    { type: "wait", duration: 2200 },
    { type: "fill", color: "black" },
    artPlaceholder("a bone tied with red ribbons, blades pointing every which way"), // -> level4/cutscene_bone_ribboned.png
    { type: "wait", duration: 1500 },
    { type: "text", what: "Now every bone wears a ribbon. And ribbons bend the eye.", animation: "appear", y: 75 },
    { type: "wait", duration: 2600 },
]

export const level5Cutscene = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 800 },
    { type: "text", what: "Bones didn't work. Ribbons didn't work.", animation: "appear", y: 40 },
    { type: "wait", duration: 2200 },
    { type: "text", what: "So Nogo reaches for a cat's true weapon...", animation: "appear", y: 50 },
    { type: "wait", duration: 2200 },
    { type: "fill", color: "black" },
    { type: "text", what: "YARN", animation: "reveal", duration: 1000, fontSize: 96, background: "black", font: "display" },
    { type: "wait", duration: 1200 },
    { type: "fill", color: "black" },
    artPlaceholder("Nogo in the middle of a yarn mess, winding decoy balls"), // -> level5/cutscene_yarn.png
    { type: "wait", duration: 1500 },
    { type: "text", what: "Decoys of every size, scattered around Doggo's balls.", animation: "appear", y: 72 },
    { type: "wait", duration: 2200 },
    { type: "text", what: "Ignore the yarn. Judge only the ball.", animation: "appear", y: 82 },
    { type: "wait", duration: 2400 },
]
