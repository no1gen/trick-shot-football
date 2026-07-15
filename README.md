# Trick-Shot Football

A lightweight desktop browser game about bending free kicks around the wall and into the corners.

## Features

- Curved-shot physics with spin and in-flight aftertouch
- Easy, normal, and hard difficulty modes
- Optional trajectory preview
- Ball-tracking camera and adjustable graphics quality
- Live rebounds: shoot again from wherever the ball stops
- Instant re-kicks while wall, post, and target-block rebounds are still moving
- Adjustable goal width plus walls of 1–25 players with custom height
- Top-corner mode turns the rest of the goal into a physical rebound surface
- Pause menu, scoring, streaks, and top-corner challenges

## Controls

- Drag back from the ball and release to shoot
- Curve the drag to add spin
- Move the mouse during flight for a small amount of aftertouch
- Press `Esc` or use the pause button to pause

## Run locally

Serve this folder with any static web server, then open `index.html` through it. For example:

```sh
python3 -m http.server 8765
```

Open `http://localhost:8765` in a desktop browser.

## Deploy to Vercel

Import this repository into Vercel and deploy it as a static project. No build command or output directory is required.
