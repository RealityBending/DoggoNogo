/**
 * @file Cutscene step sequences, consumed by `CutsceneRunner`.
 */
export const level1Cutscene = [
    { type: "fill", color: "black" },
    {
        type: "text",
        what: "You are an investigator tasked with bringing down criminals that mistreat animals.",
        animation: "appear",
    },
    { type: "wait", duration: 3000 },
    { type: "sound", what: "level1/sound_intro_metaldoor.mp3" },
    {
        type: "image",
        what: "level1/intro_background.webp",
        animation: "reveal",
        duration: 1000,
    },
    { type: "wait", duration: 1500 },
    // High, just under the top bar: this line is still up when the puppy is revealed below it,
    // and at the default middle height it would be sitting across his head.
    {
        type: "text",
        what: "But during your last raid, you heard something...",
        animation: "appear",
        y: 27,
    },
    { type: "wait", duration: 1500 },
    { type: "sound", what: "level1/sound_intro_dogwhining.mp3" },
    { type: "wait", duration: 1500 },
    {
        type: "image",
        what: "level1/player_1.webp",
        animation: "reveal",
        duration: 800,
    },
    { type: "wait", duration: 1000 },
    {
        type: "image",
        what: "level1/intro_background.webp",
        animation: "appear",
    },
    { type: "image", what: "level1/player_1.webp", animation: "appear" },
    // Re-stating the background above turned the narration page (see `commit` in the image step,
    // game/cutscene.js), so the line about hearing something is gone and these two have the
    // bottom of the frame to themselves: the second lands UNDER the first, with the first still
    // up, and the `wait` between them is what gives each its own beat.
    {
        type: "text",
        what: "A small puppy has been forgotten!",
        animation: "appear",
        y: 80,
    },
    { type: "wait", duration: 2200 },
    {
        type: "text",
        what: "You decide to take him home, and name him...",
        animation: "appear",
        y: 88,
    },
    { type: "wait", duration: 2000 },
    { type: "fill", color: "black" },
    {
        type: "text",
        what: "Doggo",
        animation: "reveal",
        duration: 1000,
        fontSize: 96,
        background: "black",
        font: "display",
    },
    { type: "wait", duration: 1000 },
]

// Level 2 introduces Nogo on his own terms: a cut to the other side of town, not a watcher in
// Doggo's shadows. The two are deliberately not connected yet; the story brings them together
// later, and an early "someone has been watching Doggo" gave that away in the first line.
export const level2Cutscene = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 1000 },
    // The opening line sits high, just under the top letterbox bar, so the cat has the middle
    // of the frame to himself.
    {
        type: "text",
        what: "Meanwhile, on the other side of town...",
        animation: "appear",
        y: 27,
    },
    { type: "wait", duration: 2000 },
    // Nogo's own sprite surfacing out of the dark, rather than a separate pair-of-eyes asset:
    // `emerge` grows the reveal from `focus`, which is aimed at his eyes (0.36, 0.69 of the
    // sprite box - he is crouched, so his head sits low and left of centre). The eyes arrive
    // first and the rest of the cat follows, which is what the dedicated eyes image used to do
    // with an asset and a prompt of its own.
    //
    // Placement: his ink starts ~20% down its box, so with a 40%-tall box centred at 53% the
    // tail tip lands at ~41% - clear of the line above - and the paws at 73%, leaving room for
    // the two closing lines below without touching the bottom bar.
    {
        type: "image",
        what: "level2/player_1.webp",
        animation: "emerge",
        duration: 2600,
        height: 40,
        y: 53,
        focus: { x: 0.36, y: 0.69 },
    },
    { type: "wait", duration: 2200 },
    // Both closing lines land under Nogo on one page, so the name and the appetite are read with
    // the cat in view rather than over black.
    //
    // The `fill` is what clears the opening line - nothing else on a black stage does, since a
    // text step only repaints the background and sprite over what is already on the canvas. But
    // `fill` also drops the sprite, so Nogo is immediately re-placed at the same size and position,
    // with `appear` rather than a fade: he is already revealed, this is the same shot continuing.
    { type: "fill", color: "black" },
    {
        type: "image",
        what: "level2/player_1.webp",
        animation: "appear",
        height: 40,
        y: 53,
    },
    {
        type: "text",
        what: "This is NOGO, the alley cat.",
        animation: "appear",
        y: 80,
    },
    { type: "wait", duration: 1800 },
    {
        type: "text",
        what: "And tonight, he is hungry.",
        animation: "appear",
        y: 88,
    },
    { type: "wait", duration: 2600 },
]

// --- Illusion arc (Levels 3-5) -----------------------------------------------------------------
// Tentative cutscenes: minimal text, with `[ ART: ... ]` text steps standing in for artwork that
// does not exist yet. Replace each placeholder with an `image` step once the asset is made; the
// grey colour and smaller size mark them as stage directions rather than narration. Each
// placeholder's target file is noted next to it; the generation prompts live in
// art/make_prompts.py, under the step for the level they belong to.
//
// Level 3's two panels have been made and are wired in below; Levels 4 and 5 are still standing
// on placeholders.
const artPlaceholder = (what) => ({
    type: "text",
    what: `[ ART: ${what} ]`,
    animation: "appear",
    y: 45,
    color: "#8b98ab",
    fontSize: 28,
})

// Level 3 - "Bone fever": a bone thrown from a passing car, and Doggo cannot help himself.
// The level itself is his descent (terrace -> kitchen door -> kitchen, one background per
// phase), so the cutscene only has to get him out of the gate.
export const level3Cutscene = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 800 },
    {
        type: "text",
        what: "Life at the new home is good. But Doggo still has a lot to learn.",
        animation: "appear",
        y: 40,
    },
    { type: "wait", duration: 2400 },
    {
        type: "text",
        what: "Like not chasing every bone that comes his way.",
        animation: "appear",
        y: 50,
    },
    { type: "wait", duration: 1600 },
    { type: "fill", color: "black" },
    // Both panels are 16:9, so `CutsceneRunner` takes them as backgrounds and draws them
    // full-bleed (game/cutscene.js `drawBackground`). Their two narration lines stack in the
    // lower quarter the panels were composed to leave clear, at the same 80/88 as Level 2's
    // closing pair; the panel's own `fill` is what clears them again for the next shot.
    {
        type: "image",
        what: "level3/cutscene_car.webp",
        animation: "reveal",
        duration: 900,
    },
    { type: "wait", duration: 1500 },
    {
        type: "text",
        what: "One afternoon, a car speeds past the garden...",
        animation: "appear",
        y: 80,
    },
    { type: "wait", duration: 2000 },
    {
        type: "text",
        what: "...and someone throws a bone out of the window.",
        animation: "appear",
        y: 88,
    },
    { type: "wait", duration: 2200 },
    { type: "fill", color: "black" },
    {
        type: "image",
        what: "level3/cutscene_gate.webp",
        animation: "reveal",
        duration: 900,
    },
    { type: "wait", duration: 1500 },
    {
        type: "text",
        what: "Doggo doesn't think. Doggo runs.",
        animation: "appear",
        y: 80,
    },
    { type: "wait", duration: 2000 },
    {
        type: "text",
        what: "Down the street, round the corner, into the city... following the bone.",
        animation: "appear",
        y: 88,
    },
    { type: "wait", duration: 2400 },
    { type: "fill", color: "black" },
    {
        type: "text",
        what: "Then the next one.",
        animation: "reveal",
        duration: 900,
        y: 46,
    },
    { type: "wait", duration: 1400 },
    {
        type: "text",
        what: "There is always a bigger bone.",
        animation: "reveal",
        duration: 900,
        y: 56,
    },
    { type: "wait", duration: 2200 },
]

// Level 4 - Nogo intervenes: a berserk dog next to his alley is bad for business, so he
// distracts the Chef and lays a trail home. Muller-Lyer is the level's illusion.
//
// TODO (narrative rework): this sequence was written for RIBBONED BONES. The level's stimulus is
// now a tied SAUSAGE (game/stimuli.js `drawSausage`): a string knotted around each end, its loose
// ends splayed at the illusion angle. Every ribbon/bone beat below - the gift-shop raid, the
// spool of ribbon, "Ribbons bend the eye" - and the art placeholders need rewriting around
// strings of sausages (e.g. Nogo raiding the Chef's cold room). Level 5's opening line
// ("Bones didn't work. Ribbons didn't work.") follows from this and needs the same pass.
export const level4Cutscene = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 800 },
    {
        type: "text",
        what: "Next door, in the alley, someone has heard the crashing pots.",
        animation: "appear",
        y: 40,
    },
    { type: "wait", duration: 2200 },
    {
        type: "text",
        what: "A berserk dog in HIS neighbourhood? Bad for business.",
        animation: "appear",
        y: 50,
    },
    { type: "wait", duration: 2400 },
    { type: "fill", color: "black" },
    artPlaceholder(
        "Nogo grinning, a spool of red ribbon in his paws, a pile of bones beside him",
    ), // -> level4/cutscene_ribbon.webp
    { type: "wait", duration: 1500 },
    {
        type: "text",
        what: "Nogo knocks over a tray of fish. The Chef turns. Doggo doesn't.",
        animation: "appear",
        y: 72,
    },
    { type: "wait", duration: 2400 },
    {
        type: "text",
        what: "So Nogo raids the gift shop instead...",
        animation: "appear",
        y: 82,
    },
    { type: "wait", duration: 2200 },
    { type: "fill", color: "black" },
    artPlaceholder(
        "a bone tied with red ribbons, blades pointing every which way",
    ), // -> level4/cutscene_bone_ribboned.webp
    { type: "wait", duration: 1500 },
    {
        type: "text",
        what: "A trail of ribboned bones, each looking bigger than the last, all the way home.",
        animation: "appear",
        y: 72,
    },
    { type: "wait", duration: 2400 },
    {
        type: "text",
        what: "Ribbons bend the eye. Doggo follows.",
        animation: "appear",
        y: 82,
    },
    { type: "wait", duration: 2600 },
]

export const level5Cutscene = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 800 },
    {
        type: "text",
        what: "Bones didn't work. Ribbons didn't work.",
        animation: "appear",
        y: 40,
    },
    { type: "wait", duration: 2200 },
    {
        type: "text",
        what: "So Nogo reaches for a cat's true weapon...",
        animation: "appear",
        y: 50,
    },
    { type: "wait", duration: 2200 },
    { type: "fill", color: "black" },
    {
        type: "text",
        what: "YARN",
        animation: "reveal",
        duration: 1000,
        fontSize: 96,
        background: "black",
        font: "display",
    },
    { type: "wait", duration: 1200 },
    { type: "fill", color: "black" },
    artPlaceholder("Nogo in the middle of a yarn mess, winding decoy balls"), // -> level5/cutscene_yarn.webp
    { type: "wait", duration: 1500 },
    {
        type: "text",
        what: "Decoys of every size, scattered around Doggo's balls.",
        animation: "appear",
        y: 72,
    },
    { type: "wait", duration: 2200 },
    {
        type: "text",
        what: "Ignore the yarn. Judge only the ball.",
        animation: "appear",
        y: 82,
    },
    { type: "wait", duration: 2400 },
]
