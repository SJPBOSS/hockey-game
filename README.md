# Sentinel Slapshot

Original three-on-three arcade hockey from **VELLURA Studios**. You are #19 on the Ashford Sentinels. Skate the puck, thread a pass, and beat the Kestrel North goalie across three periods. Overtime is sudden death.

The clubs, marks, and audio are original. This is not affiliated with any professional league.

## Play

The game is a static site. From this folder:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Modules need a web server; opening the file directly will not start the rink.

### Controls

- **Skate:** WASD, ZQSD, or the arrow keys. Left stick on a gamepad. On a phone, drag the left thumb stick.
- **Aim:** mouse or right stick. On touch, drag off the shoot button.
- **Wrist shot:** tap Space, left click, A / RT, or the shoot button.
- **Slapshot:** hold the shot, then release.
- **Pass:** E, right click, B / X, or the pass button.
- **Pause:** Esc or Start. **Mute:** M, or the speaker button.

Difficulty is Rookie, Pro, or Elite. The interface is in English, French, and Spanish.

## Hosting

Everything the page needs is in this folder: no CDN, no build step, no paid service. Paths are relative, so the same files work on GitHub Pages (branch root; `.nojekyll` is included) and as an itch.io HTML zip.

## Credits

- Game, original clubs, and synthesized audio: VELLURA Studios. Sound is generated in the browser with the Web Audio API.
- Rajdhani by the Indian Type Foundry, used under the [SIL Open Font License](assets/fonts/OFL.txt).

## Tests

```bash
node --test tests/sim.test.js
```
