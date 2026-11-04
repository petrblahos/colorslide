# Colorslide

A hex stack sorting puzzle that runs fully offline in the browser. Plain HTML, CSS and JavaScript. All graphics are drawn on a canvas and the fonts are system fonts, so there are no external assets.

## Run
Open `index.html` in any modern browser. No server or build step is needed.

## Install on Android
The game is a Progressive Web App (PWA). Once it's hosted over HTTPS (for example on GitHub Pages):
1. Open the page in Chrome on the phone.
2. Tap **Install app** on the start screen, or use Chrome's menu → **Install app** / **Add to Home screen**.

It then opens full-screen from its own home-screen icon and works without a connection.

When you change any game file, bump `CACHE` in `sw.js` (e.g. `colorslide-v2`) so installed copies pick up the update.

## How to play
- Press **Start game** to generate a random board. Some cells are randomly blocked.
- Drag one of the three stacks from the tray onto an empty cell. Mouse and touch both work.
- When neighbouring stacks have the same top color, those tiles slide together onto the purest stack.
- When a stack has **10 or more** tiles of one color on top, they clear and you score 1 point per tile. Chain clears within one move multiply the points.
- New colors are added as your score grows.
- The game ends when the board has no empty cells. **New Game** starts over at any time. Your best score is kept in the browser.
