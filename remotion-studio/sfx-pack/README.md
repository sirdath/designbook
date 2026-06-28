# Design Book — SFX library

34 sound effects, indexed by name. Source: owner-supplied pack.
Provenance/licence: supplied by the project owner — verify CC0/ownership before redistributing outside this repo.

The video pipeline maps picks into `remotion-studio/public/sfx/` (the 7 slots: whoosh·click·key·pop·chime·success + synth `music` bed). To swap, point a slot at any `name` below.

## click (7)

| name | dur | role | mapped slot |
|---|---|---|---|
| `click [complex, reverb]` | 1.37s | UI click — button / select / pointer | — |
| `click [short]` | 1.39s | UI click — button / select / pointer | — |
| `click 2 [short]` | 2.33s | UI click — button / select / pointer | — |
| `click 3 [all layers]` | 0.38s | UI click — button / select / pointer | **click** |
| `click 3 [layer 1]` | 0.38s | UI click — button / select / pointer | **key** |
| `click 3 [layer 2]` | 0.38s | UI click — button / select / pointer | — |
| `click 4` | 0.82s | UI click — button / select / pointer | — |

## counter (4)

| name | dur | role | mapped slot |
|---|---|---|---|
| `count [all layers]` | 0.82s | number count-up / metric tick (StatBurst) | **pop** |
| `count [layer 1. long]` | 1.75s | number count-up / metric tick (StatBurst) | — |
| `count [layer 2]` | 0.82s | number count-up / metric tick (StatBurst) | — |
| `count [layer 3]` | 1.15s | number count-up / metric tick (StatBurst) | — |

## data (1)

| name | dur | role | mapped slot |
|---|---|---|---|
| `data [long]` | 1.9s | data / number reveal | — |

## digital (1)

| name | dur | role | mapped slot |
|---|---|---|---|
| `digital` | 1.06s | digital confirm / blip | — |

## hover (1)

| name | dur | role | mapped slot |
|---|---|---|---|
| `hover` | 1.9s | pointer hover / cursor-arrives | — |

## interface (3)

| name | dur | role | mapped slot |
|---|---|---|---|
| `interface [reverb]` | 2.33s | interface open / confirm | — |
| `interface 2 ` | 1.75s | interface open / confirm | — |
| `interface open [small]` | 1.1s | interface open / confirm | **success** |

## paper (1)

| name | dur | role | mapped slot |
|---|---|---|---|
| `paper` | 1.63s | paper / soft reveal | — |

## rise (1)

| name | dur | role | mapped slot |
|---|---|---|---|
| `rise [reverb]` | 2.09s | rising confirmation (CTA landing) | **chime** |

## texture (3)

| name | dur | role | mapped slot |
|---|---|---|---|
| `granular 1` | 1.85s | ambient/granular texture (loopable bed candidate) | — |
| `granular 2` | 2.02s | ambient/granular texture (loopable bed candidate) | — |
| `granular 3` | 2.26s | ambient/granular texture (loopable bed candidate) | — |

## typing (5)

| name | dur | role | mapped slot |
|---|---|---|---|
| `text [all layers]` | 2.26s | typing / text-reveal (per-key or one-shot sweep) | — |
| `text [layer1, long]` | 2.3s | typing / text-reveal (per-key or one-shot sweep) | — |
| `text [layer2, long]` | 1.66s | typing / text-reveal (per-key or one-shot sweep) | — |
| `text [layer3, long]` | 2.26s | typing / text-reveal (per-key or one-shot sweep) | — |
| `text [layer4, short]` | 1.06s | typing / text-reveal (per-key or one-shot sweep) | — |

## whoosh (7)

| name | dur | role | mapped slot |
|---|---|---|---|
| `granular whoosh` | 2.14s | transition — textured swish | — |
| `whoosh 1` | 1.2s | transition — scene-to-scene swish | — |
| `whoosh 2` | 0.96s | transition — scene-to-scene swish | — |
| `whoosh 3` | 0.77s | transition — scene-to-scene swish | **whoosh** |
| `whoosh 4` | 2.33s | transition — scene-to-scene swish | — |
| `whoosh 5` | 0.96s | transition — scene-to-scene swish | — |
| `whoosh 6` | 1.9s | transition — scene-to-scene swish | — |


Regenerate: `node tools/build-sfx-index.mjs`
