# agent-sdk-2048

Two Agent SDK (`@grok/agent-sdk` 0.5.0) players race [2048-gb](https://github.com/Sanqui/2048-gb) side by side in mGBA:

| player | project | port | who picks each move |
|---|---|---|---|
| Agent SDK (regular) | `agents/regular` | 8889 | A normal Agent SDK model turn calling `get_board` / `move`. No Jev. |
| Agent SDK (Jev) | `agents/jev` | 8890 | Jev `decide()` makes a typed choice from {up, down, left, right} via `choose_move`. `move` is a direct tool call, with no model turn per move. |

Both players use the same tools on the same game. The only difference is how each move gets decided.

## Prerequisites

- **macOS.** The emulator scripts use `open`, `osascript` and `lsof` to launch and place the mGBA windows.
- **Node >= 22.13** (`.nvmrc` pins 24).
- **mGBA 0.11 or newer** (a development build from https://mgba.io/downloads.html). 0.10.x has no `--script` flag. If it isn't at `/Applications/mGBA.app`, set `MGBA_APP=/path/to/mGBA.app`.
- **The 2048-gb ROM.** It is not included in this repo. Build it from the homebrew source:

      brew install rgbds
      git clone https://github.com/Sanqui/2048-gb
      cd 2048-gb && make clean && make
      mkdir -p /path/to/agent-sdk-2048/emu/roms
      cp 2048.gb /path/to/agent-sdk-2048/emu/roms/2048.gb

  The 2048-gb README also links a prebuilt `2048.gb` if you'd rather not build it.
- **ffmpeg** (only for `npm run clip` and the clip scripts).

## Setup

    npm install
    cp .env.example .env

Then fill in `.env` (git-ignored, never commit it):

| variable | used by | notes |
|---|---|---|
| `TYPESAFE_API_KEY` | Agent SDK (Jev) | Jev `decide()` calls. Without it the Jev player refuses to run unless you pass `--stand-in`. |
| `CURSOR_API_KEY` | Agent SDK (regular) | Model turns. Or skip it and run `npx agent-sdk login`. |
| `REGULAR_PORT` / `JEV_PORT` | both | Bridge ports, default 8889 / 8890. |

Check everything is wired up:

    npm run check       # TypeScript
    npm run validate    # agent-sdk validate for both agents
    npm run eval        # offline evals (no keys needed)

## Race

Each race is 5 minutes of wall clock from a fresh title-screen reset. The score is whatever the game shows at the buzzer.

    npm run emu            # launch and arrange both mGBA windows (race.ts also does this)
    npm run race           # both players, Jev for real
    npm run race:jev       # just Agent SDK (Jev)
    npm run race:regular   # just Agent SDK (regular)
    npm run race:standin   # harness test: the Jev player uses a heuristic stand-in, labeled as such
    npm run race:to-game-over
    npm run clip -- runs/race-<stamp>   # regular.mp4, jev.mp4, side-by-side.mp4 from recorded frames

`scripts/race.ts` launches both emulators, serves both agents from one `serve(agents, { mode: "multi" })`, resets both games at the same instant, then:

- **Agent SDK (Jev):** `get_board`, then `choose_move`, then `move` (falling back to the next-best ranked move if a press doesn't change the board) until the clock runs out.
- **Agent SDK (regular):** one HTTP session that gets nudged with "Keep playing" whenever a turn ends, stopped at the buzzer.

Output goes to `runs/race-<stamp>/` (git-ignored): `summary.json` (moves, score, max tile, moves/min, median decision ms, emulator ms, invalid presses, Jev fallbacks, session cost per player), `<player>.presses.jsonl`, `jev.moves.jsonl`, `<player>-buzzer.png`, recorded frames and `race.log`.

## Traces

    npm run dev    # agent-sdk dev --dir agents --port 3100

Open the playground and use the Trace view to see each session's spans, model turns and tool calls side by side. `scripts/trace-jev-move.ts` drives one Jev move (`get_board`, `choose_move`, `move`) against the dev server in a single trace and exports the spans to any OTLP endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT`, default `http://127.0.0.1:4318`).

## Evals

    npm run eval       # tag "offline": board fixtures through the heuristic stand-in
    npm run eval:jev   # tag "jev": the same fixtures through Jev (needs TYPESAFE_API_KEY)

Fixtures live in `agents/jev/evals/fixtures/boards.json`.

## Layout

- `agents/regular`, `agents/jev`: the two Agent SDK projects (instructions, tools, Jev extension, evals).
- `lib/`: shared code, never discovered as tools. `bridge.ts` (TCP to the mGBA Lua bridge), `game.ts` (RAM reads, exactly-once presses, settle), `sim.ts`, `policy.ts` (Jev plus the labeled heuristic stand-in), `tools.ts` (port-bound tool factories).
- `emu/`: `bridge.lua` (mGBA scripting bridge), `launch.sh`, `arrange.sh`.
- `RAM.md`: the 2048-gb RAM map the tools read the board and score from.

Port 8888 is left free for a Grok Bot instance playing the same ROM.

## License

MIT. 2048-gb is by Sanqui and is not distributed here.
