# LifeOS companion animation assets

Generated on 2026-10-01 with the built-in `image_gen` tool, using the user's original mascot and seven-state design strip as local references. Mode: reference-guided raster generation; `transparent_background: true`. One native PNG containing 42 distinct poses. No third-party generation CLI or separately configured API key was used.

The atlas is preserved byte-for-byte. Its native output is 1161 × 1355; generation trimmed the outside transparent margins. `motions.json` therefore uses measured per-row crop boundaries and eye registration, rather than assuming a uniform grid. `scripts/index-companion-atlas.py` reads the PNG and writes metadata only.

Each state contains six frames on a 256 × 256 transparent stage. `animations/*.webp` are lossless animation exports of the same browser-rendered frames. Loop counts: 0 = repeat, 1 = one play. The application uses the source atlas and the shared Canvas 2D player so it can pause, respect reduced motion, and switch state deterministically.

| File | State | Duration | Playback |
| --- | --- | --- | --- |
| idle.webp | 待机：呼吸、眨眼 | 2400 ms | repeat |
| received.webp | 收到消息：轻抬、感叹号 | 360 ms | once |
| thinking.webp | 正在整理：下浮、圆点 | 1080 ms | repeat |
| searching.webp | 查找相关经历：环绕 | 1080 ms | repeat |
| answering.webp | 正在回答：发光 | 900 ms | repeat |
| complete.webp | 完成：开心小跳 | 720 ms | once |
| waiting.webp | 等待用户：悬停、气泡 | 2400 ms | repeat |

Preview: `/companion-preview.html`. Integration: `src/features/conversation/Companion.tsx` and `companion-player.ts`. Searching is available in the preview only; the current conversation remains a local scripted prototype without a retrieval or AI service.

## Exact generation prompt

```text
Create a production-ready transparent sprite animation atlas for the LifeOS pixel-art companion. This is ONE game sprite-sheet asset, NOT an infographic or UI screenshot.
Input image 1 is the character identity reference: a cute round glowing lavender-blue planet creature, two tiny dark square eyes, two short pixel feet, a small left arm, a tilted Saturn-like ring with white square orbiting beads and an upper-right antenna-loop. Preserve that exact silhouette, pixel-art palette, proportions and friendly understated character; do not redesign it.
Input image 2 is ONLY the requested seven animation concepts and their order.

OUTPUT: exactly SIX COLUMNS by SEVEN ROWS, 42 evenly spaced square frame cells, full image aspect ratio 6:7, ideally 1536 by 1792 pixels (each cell 256px). Every cell is an equal-size aligned square. Completely transparent RGBA background, no checkerboard baked in, no navy background. No labels, letters, grid lines, dividers, captions, watermarks or text anywhere. Each creature is centered at the SAME anchor in its cell with generous transparent padding. Character including ring occupies about 65 percent of the cell width and 60 percent height. No frame touches or spills into a neighbor. Consistent size/camera across all frames. Keep pixel edges crisp, soft lavender bloom only immediately around the creature.

ANIMATE each row left-to-right as SIX consecutive frames, not six unrelated poses. Subtle differences but actual readable motion. Do not repeat identical images:
ROW 1 idle: seamless gentle breathing, 2-pixel vertical bob and a small eye blink on frame 4, neutral frame 1 and 6.
ROW 2 message received: neutral, alert eyes, body lifts slightly, little purple exclamation-mark PIXEL SHAPE appears above-right, settles back, neutral. Small anticipatory gesture rather than a huge jump.
ROW 3 organizing: body dips slightly and thinks, three small square dots to the right illuminate sequentially. Head/eyes remain friendly. Smooth looping six-frame motion.
ROW 4 searching experiences: body and feet STAY STILL facing viewer, orbital beads visibly travel round the tilted ring across six frames, ring subtly changes projected tilt, bead front/back occlusion changes. This is orbital motion around the creature, NOT spinning the whole character.
ROW 5 answering: gentle brightening of the face glow, little arm motion, eyes attentive, six-frame smooth pulsing loop. Keep face identical, no big mouth.
ROW 6 complete: one happy little hop: crouch, lift off, apex with legs tucked and two tiny square sparkles, descend, land, return neutral. Within the same fixed cell framing.
ROW 7 waiting for user: quiet hovering with blink, a tiny empty speech bubble with three square dots near upper-right appears softly. Six-frame loop; restrained and patient.

Prioritize an exact aligned 6x7 grid and strict character consistency. Return only the transparent animation atlas.
```
