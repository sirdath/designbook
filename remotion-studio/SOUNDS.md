# Design Book — sound library

47 sounds in one catalog (SFX · music beds · synth fallbacks). The video maps picks into `public/sfx/`; swap by name.

| source | dir | count | committed | licence |
|---|---|---|---|---|
| sfx | `sfx-pack/` | 34 | yes | owner-supplied — verify CC0/ownership before redistribution |
| music | `music-pack/` | 6 | no (gitignored) | Mixkit Free — free in videos, no attribution; raw files gitignored, re-fetch via music-pack/fetch.mjs |
| synth | `synth-pack/` | 7 | yes | CC0 — procedurally generated (tools/generate-sfx.mjs) |

## SFX (34) — `sfx-pack/`

### click (7)
| name | dur | slot |
|---|---|---|
| `click [complex, reverb]` | 1.37s | — |
| `click [short]` | 1.39s | — |
| `click 2 [short]` | 2.33s | — |
| `click 3 [all layers]` | 0.38s | **click** |
| `click 3 [layer 1]` | 0.38s | **key** |
| `click 3 [layer 2]` | 0.38s | — |
| `click 4` | 0.82s | — |

### counter (4)
| name | dur | slot |
|---|---|---|
| `count [all layers]` | 0.82s | **pop** |
| `count [layer 1. long]` | 1.75s | — |
| `count [layer 2]` | 0.82s | — |
| `count [layer 3]` | 1.15s | — |

### data (1)
| name | dur | slot |
|---|---|---|
| `data [long]` | 1.9s | — |

### digital (1)
| name | dur | slot |
|---|---|---|
| `digital` | 1.06s | — |

### hover (1)
| name | dur | slot |
|---|---|---|
| `hover` | 1.9s | — |

### interface (3)
| name | dur | slot |
|---|---|---|
| `interface [reverb]` | 2.33s | — |
| `interface 2 ` | 1.75s | — |
| `interface open [small]` | 1.1s | **success** |

### paper (1)
| name | dur | slot |
|---|---|---|
| `paper` | 1.63s | — |

### rise (1)
| name | dur | slot |
|---|---|---|
| `rise [reverb]` | 2.09s | **chime** |

### texture (3)
| name | dur | slot |
|---|---|---|
| `granular 1` | 1.85s | — |
| `granular 2` | 2.02s | — |
| `granular 3` | 2.26s | — |

### typing (5)
| name | dur | slot |
|---|---|---|
| `text [all layers]` | 2.26s | — |
| `text [layer1, long]` | 2.3s | — |
| `text [layer2, long]` | 1.66s | — |
| `text [layer3, long]` | 2.26s | — |
| `text [layer4, short]` | 1.06s | — |

### whoosh (7)
| name | dur | slot |
|---|---|---|
| `granular whoosh` | 2.14s | — |
| `whoosh 1` | 1.2s | — |
| `whoosh 2` | 0.96s | — |
| `whoosh 3` | 0.77s | **whoosh** |
| `whoosh 4` | 2.33s | — |
| `whoosh 5` | 0.96s | — |
| `whoosh 6` | 1.9s | — |

## Music beds (6) — `music-pack/` · gitignored, `node music-pack/set-bed.mjs <name>`

| name | genre | dur | mood |
|---|---|---|---|
| `digital-clouds` | Chillout | 101s | tech-chill, modern, gentle — strongest SaaS fit |
| `other-world` | Electronica | 95s | modern electronic, airy |
| `tides-turning` | Electropop | 120s | gentle forward motion, optimistic |
| `close-up` | Corporate Music | 95s | clean corporate, confident |
| `serene-moments` | Chillout | 119s | calm, soft, unobtrusive |
| `valley-sunset` | Ambient | 134s | warm ambient, slow |

## Synth fallbacks (7) — `synth-pack/` · CC0, `node tools/generate-sfx.mjs`

| name | dur |
|---|---|
| `synth-chime` | 0.5s |
| `synth-click` | 0.06s |
| `synth-key` | 0.04s |
| `synth-music` | 16s |
| `synth-pop` | 0.16s |
| `synth-success` | 0.6s |
| `synth-whoosh` | 0.4s |

Regenerate: `node tools/build-sound-index.mjs`
