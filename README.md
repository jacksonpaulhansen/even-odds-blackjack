# Even Odds (Blackjack Counter for Even G2)

Blackjack card-counting assistant for Even G2 / Even Hub simulator.

Disclaimer: This app is for training/educational use only. Using card-counting assistance in casinos may violate house rules or applicable state laws.

Startup behavior: The glasses display shows a mandatory 15-second disclaimer splash with a cooldown timer, then shows `OK (CLICK)` and waits for a click before count controls are enabled.

## Features

- Hi-Lo running count (`LOW +1`, `NEUTRAL 0`, `HIGH -1`)
- True count based on shoe decks and cards seen
- Decks remaining estimate
- Simple betting guidance from true count
- Undo last card and reset shoe
- Glasses-first gesture flow:
  - `Click` = Low card (2-6, `+1`)
  - `Up` = High card (10-A, `-1`)
  - `Down` = Neutral card (7-9, `0`)
  - `Double Click` = open command menu
  - Command menu supports: undo last card, new shoe, adjust decks, and cheat sheet

## On-glasses command menu

- Open with `Double Click` from the count screen
- In menu:
  - `Up/Down` navigate
  - `Click` select
  - `Double Click` close menu
- Deck adjust mode:
  - `Up` = `+0.5` decks
  - `Down` = `-0.5` decks
  - `Click` save and exit
- Cheat sheet mode:
  - Shows `+1`, `0`, and `-1` card groups
  - `Click` or `Double Click` to return

## Run locally

1. Install once:
   - `npm install`
2. Start with runner:
   - `run-even-sim.ps1`
3. Runner starts:
   - app dev server: `http://127.0.0.1:5173`
   - control server: `http://127.0.0.1:8787`
   - Even Hub simulator (if installed/found)

## Browser controls

- Setup:
  - `Shoe Decks` input (optional pre-run setup in browser)
- Keyboard gesture simulation:
  - `Enter` = Click
  - `Arrow Up` = Up
  - `Arrow Down` = Down
  - `D` = Double Click

## Debug tools

- `Publish App`
- `Build EHPK`
- Event + publish logs

Debug tools are hidden by default. Toggle with `Ctrl+Shift+D`.
