# Team radio overlay verification

The current overlay displays and narrates ChatGPT's call only. The images and two-speaker measurements below document the earlier comparison with the Shanghai broadcast.

[Full-feed comparison](artifacts/radio-verification/full-feed.jpg) · [Close-ups with the `6bf270d` baseline](artifacts/radio-verification/nameplate-detail.jpg) · [Waveform at seven frame offsets](artifacts/radio-verification/waveform-frames.jpg)

The comparison uses Hamilton’s two-speaker Ferrari exchange on the 2025 Chinese GP World Feed at 1280 × 720 and 25 fps. The Melbourne recording is the audio-only cross-check and decodes at 50 fps. The game captures use the built MCP widget, Monza’s 3D onboard view and a fixture with the same engineer and driver lines. [Shanghai footage](https://www.dailymotion.com/video/x9zkjc8) · [Melbourne footage](https://www.dailymotion.com/video/x9zkijq)

## Nameplate and lettering

Measurements below are relative to the top-left corner of the 720p feed. Colour values for the surname, label and plate come from the settled exchange frame. The numeral bounds use the quiet frame cropped above the waveform, where the red graphics can be distinguished.

| Detail | Shanghai | Game |
| --- | --- | --- |
| Nameplate bounds | About `(1055, 310)` at `165 × 88` px | `(1054.7, 310.0)` at `165.1 × 88.1` px. The captions grow downward and the complete exchange stays above the minimap. |
| Plate and Ferrari accent | Charcoal sample `#1f2027`, surname red `#d63129` | Both sampled colours match. The team-colour driver reply uses a fill sampled at `#bf7378`. The waveform has its own brighter red. |
| HAMILTON | `(1088, 316)`, `126 × 16` px | `(1088, 316)`, `125 × 16` px |
| RADIO | `(1138, 337)`, `76 × 15` px, `#f2f5f7` | Same position and fill, at `75 × 15` px |
| Driver number 44 | `(1060, 358)`, `44 × 28` px in the quiet crop | Same bounds after tightening the horizontal scale. Mean red pixels in the quiet crop are RGB `(169, 53, 74)` against `(171, 53, 75)` in Shanghai. |
| Ferrari crest | `(1189, 365)`, `17 × 21` px | `(1188, 365)`, `17 × 20` px. The adjusted yellow differs by at most one RGB level on the tested swatch. |

The earlier comparison of seven available fonts selected Oxanium. This pass tested 18 combinations of painted stroke and ink. The selected rendering is **14.5 px Oxanium at weight 525**, with **16.1 px line spacing**, **−0.17 px tracking**, **113% horizontal scale** and a **0.39 px optical trim**. It preserves the three engineer lines and two right-aligned reply lines while moving the engineer text to the reference baseline. In the completed engineer caption, the three Shanghai rows contain **225, 507 and 205** light pixels above the measurement threshold. The `6bf270d` baseline had **330, 718 and 317**. The new frame has **226, 507 and 204**. [Oxanium source and license](https://github.com/google/fonts/tree/main/ofl/oxanium)

The game matches the measured label registration, caption wrapping and stroke coverage. At close zoom the native glyph outlines, especially the figure `4` and quotes, and their antialiasing still differ from the compressed broadcast lettering. The second engineer row and first reply row start 1 px below the sampled broadcast rows. Melbourne has no on-screen caption in this clip and supplies no lowercase or x-height comparison.

## Entry, typing, hold and exit

Times below use each excerpt’s last clear frame as the start of entrance. The captured Shanghai comparison uses frames **58, 111, 119 and 288** for entry, typing, the completed engineer line and exit. Frame 179 shows the complete exchange. The game reproduces the narrow diagonal at +160 ms, types the same partial word at +200 ms into the caption, and fades in place with both captions visible at +80 ms into the exit.

| Phase | Shanghai captioned graphic | Game |
| --- | --- | --- |
| Entrance | Last clear at 2.16 s, settled at 2.72 s | 560 ms diagonal reveal, with the photographed narrow strip at +160 ms |
| Engineer caption | First glyph at 4.24 s, full by 4.76 s | Starts at +2.08 s and takes about 528 ms for the reference line |
| Driver caption | 6.60–7.12 s | A queued reply begins 1.84 s after the engineer finishes and takes about 528 ms for the reference reply. Later replies appear once the pause has elapsed. |
| Hold and exit | Complete reply holds 4.32 s. Fade from 11.44 to 11.60 s. | 4.32 s hold and 160 ms stationary fade with measured intermediate opacity stops |

Melbourne’s audio-only take has a **roughly 400 ms entrance** from 6.22 to 6.62 s and a **120 ms fade** from 20.52 to 20.64 s. The game follows Shanghai’s captioned timing. In-game narration is cued separately so the local voice can start near the text reveal.

## Waveform

The repeating 2.04-second broadcast waveform uses the 51-frame, 25 fps cycle already identified in both clips. The new pass adjusts the early rise and peak from their corresponding Shanghai frames, compensates for the last partially painted row and softens the edges of the 96 teeth. It uses the same waveform phase for sound and muted playback. Speech events lightly brighten the active waveform, with a corresponding cue from the caption clock when muted.

The 85th-percentile red-pixel height in the central 66 × 36 px crop now **matches all seven Shanghai frames**. The clean central bands are measured directly. The game estimates the bands partly hidden by the numeral and crest. The remaining close-up difference is the video’s red bleed and compression around those edges and the thin floor, which the new edge filter approximates.

| Shanghai offset | Phase | World Feed | Game |
| --- | --- | ---: | ---: |
| 1.64 s | Quiet | 6 px | 6 px |
| 2.08 s | First rise | 10 px | 10 px |
| 2.12 s | Second rise | 18 px | 18 px |
| 2.28 s | Peak | 28 px | 28 px |
| 3.32 s | Decay shelf | 24 px | 24 px |
| 3.56 s | Final decay | 16 px | 16 px |
| 3.68 s | Quiet again | 6 px | 6 px |

## Regression checks

The desktop suite checks all seven painted 720p waveform heights against the Shanghai samples with a one-pixel tolerance. During the caption-scroll update, the canvas pixels and bounds matched before and after at every sample. The final composited screenshot rounded three bar heights down by one pixel relative to Shanghai. The suite also checks the label, Ferrari accent, reference layout, caption weight and trim, line breaks, animation timings, reduced motion and suppression of duplicate snapshots. The desktop and Worker browser tests check that a driver reply in the race state does not add a second caption, including after a spectator reload. A headed Chromium run with the real local voice matched muted playback at all nine sample offsets.

Captions reveal in reading order, with composed characters kept together. Long calls scroll within the caption area as new lines appear. The driver nameplate stays fixed above it, and the viewer can scroll back to the beginning while the radio is still visible. Reduced-motion playback reveals the full caption immediately and starts at the top.
