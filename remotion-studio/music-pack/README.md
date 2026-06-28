# Design Book — music beds

Background-music beds for SaaS-style videos (the `MusicBed` that plays under the SFX).

## Licence (read this)

These tracks are from **Mixkit** under the **[Mixkit Free License](https://mixkit.co/license/#musicFree)**:
free to use in your videos (personal **and** commercial), **no attribution**, no signup —
but you **may not redistribute the raw audio files** standalone or make them downloadable.

So the `.mp3` files are **gitignored, not committed**. This folder commits only the
`manifest.json` (catalog + source URLs), `fetch.mjs`, and `set-bed.mjs`. The committed
video default (`public/sfx/music.mp3`) is a **synthesized pad** (licence-clean) so a fresh
clone still renders. If you need a *committable* bed, use a CC0 / public-domain track instead.

## Use

```sh
node fetch.mjs              # re-download all beds locally (from manifest.json)
node set-bed.mjs <name>     # duck one into public/sfx/music.mp3 for renders
```

## Beds (`node set-bed.mjs <name>`)

| name | genre | dur | mood |
|---|---|---|---|
| `digital-clouds` | Chillout | 101s | tech-chill, modern — **current pick** |
| `other-world` | Electronica | 95s | modern electronic, airy |
| `tides-turning` | Electropop | 120s | gentle forward motion, optimistic |
| `close-up` | Corporate | 95s | clean corporate, confident |
| `serene-moments` | Chillout | 119s | calm, soft, unobtrusive |
| `valley-sunset` | Ambient | 134s | warm ambient, slow |

Source: [mixkit.co/free-stock-music](https://mixkit.co/free-stock-music/). Add more by
appending to `manifest.json` (name, file, mixkitId, genre, durationSec, mood, url).
