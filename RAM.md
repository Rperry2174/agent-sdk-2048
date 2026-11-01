# 2048-gb RAM map

Labels from the 2048-gb source (`constants.asm`, https://github.com/Sanqui/2048-gb), confirmed by
diffing WRAM 0xC000-0xDFFF and HRAM 0xFF80-0xFFFE around single moves
and comparing the decoded board to emulator screenshots.

| Address | Label | Size | Meaning |
| --- | --- | --- | --- |
| `0xC800`-`0xC80F` | `W_2048GRID` | 16 | Board, row-major (index = row*4 + col, row 0 = top). Each byte is log2(tile): 0 empty, 1 = 2, 2 = 4, ... 11 = 2048 |
| `0xFFB0`-`0xFFB2` | `H_SCORE` | 3 | Score, big-endian packed BCD (`00 00 04` = 4) |
| `0xFFB3`-`0xFFB5` | `H_HIGHSCORE` | 3 | High score, BCD (persisted in SRAM) |
| `0xFFB6`-`0xFFB7` | `H_PLUSSCORE` | 2 | Points gained by the last move, BCD (for the "+N" animation) |
| `0xFFB8` | `H_GAMEOVER` | 1 | 0 playing, 1 no moves left, 2 reached 2048 (SELECT continues) |
| `0xFFA6` | `H_ANIMATE` | 1 | Nonzero while a slide animation is running |

Example diff for one `down` move (2s at (0,2) and (2,2) merge, new 2 spawns at (3,1)):
`0xc802:1->0 0xc80a:1->0 0xc80d:0->1 0xc80e:0->2 0xffb2:0->4` (score 0 -> 4). The other changed
bytes in 0xC000-0xC1FF are the tilemap/animation buffers, not game state.

The grid is updated and the new tile is spawned synchronously in the frame that reads the input,
before the animation plays, so the move result can be read from RAM right away.
