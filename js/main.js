import { SCREEN, CAM, PHYSICS as P } from './config.js';
import { Game, STATE } from './game.js';
import { simulatePreview } from './physics.js';
import { Renderer, camera, resetCamera } from './render.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';

const canvas = document.getElementById('game');
canvas.width = SCREEN.w;
canvas.height = SCREEN.h;

const sound = new Sound();
const game = new Game(sound);
const renderer = new Renderer(canvas);
let ui;

// Клавиатура: стрелки — камера, пробел — режим трюков
const keys = new Set();
let spaceHeld = false;
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Escape'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (!e.repeat) ui?.togglePause();
    return;
  }
  if (e.code === 'Space') spaceHeld = true;
  else keys.add(e.code);
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') spaceHeld = false;
  else keys.delete(e.code);
});

const input = new Input(canvas, {
  onShot: params => game.shoot(params),
  onTrick: params => game.trick(params),
  onJuggleTap: () => game.juggleTap(),
  canAim: () => game.state === STATE.AIM,
  isTrickMode: () => spaceHeld,
});

ui = new UI(game, () => {
  resetCamera();
  game.startSession();
}, {
  onQuality: quality => renderer.setQuality(quality),
  onResetCamera: () => resetCamera(),
  onPauseChange: () => input.clearMotion(),
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && [STATE.AIM, STATE.FLIGHT, STATE.SHOT_RESULT].includes(game.state)) {
    ui.togglePause();
  }
});

window.addEventListener('resize', () => renderer.setQuality(game.settings.quality));

// Game loop: fixed timestep 60Hz, рендер по rAF
const DT = 1 / 60;
let acc = 0;
let last = performance.now();
let lastRenderAt = 0;
let lastUiAt = 0;
let previousVisualState = STATE.MENU;

function updateCameraTracking(dt, visualState, env) {
  if (game.state === STATE.PAUSED) return;
  if (visualState === STATE.FLIGHT) {
    const follow = 1 - Math.exp(-5.2 * dt);
    const targetX = game.ball.x * 0.62;
    const targetY = Math.max(1.45, Math.min(2.55, CAM.height + game.ball.y * 0.18));
    const targetZ = Math.min(game.ball.z * 0.34, env.goalZ * 0.3);
    camera.x += (targetX - camera.x) * follow;
    camera.y += (targetY - camera.y) * follow;
    camera.z += (targetZ - camera.z) * follow;
    return;
  }

  if (visualState === STATE.AIM && keys.size === 0) {
    const settle = 1 - Math.exp(-3.5 * dt);
    camera.x += (0 - camera.x) * settle;
    camera.y += (CAM.height - camera.y) * settle;
    camera.z += (0 - camera.z) * settle;
  }
}

function frame(now) {
  acc += Math.min((now - last) / 1000, 0.1);
  last = now;

  // Aftertouch: скорость мыши подаётся в игру каждый кадр
  game.aftertouchVelX = game.state === STATE.FLIGHT ? input.getRecentVelX() : 0;

  while (acc >= DT) {
    game.update(DT);
    acc -= DT;
  }

  const visualState = game.state === STATE.PAUSED ? game.pausedFrom : game.state;
  const env = game.env || fallbackEnv();

  // Между ударами камера сразу возвращается на точку подачи. Раньше она
  // несколько секунд ползла назад поверх тяжёлого 6X-кадра и выглядела как лаг.
  const newShotStarted = previousVisualState === STATE.SHOT_RESULT && visualState === STATE.AIM;
  if (newShotStarted) resetCamera();
  previousVisualState = visualState;

  // Камера стрелками в режиме прицеливания; после удара включается автотрекинг.
  const camSpeed = 7 * DT;
  if (visualState === STATE.AIM && game.state !== STATE.PAUSED) {
    if (keys.has('ArrowLeft')) camera.x -= camSpeed;
    if (keys.has('ArrowRight')) camera.x += camSpeed;
    if (keys.has('ArrowUp')) camera.y += camSpeed * 0.6;
    if (keys.has('ArrowDown')) camera.y -= camSpeed * 0.6;
  }
  camera.x = Math.max(-6, Math.min(6, camera.x));
  camera.y = Math.max(0.8, Math.min(4, camera.y));
  if (!newShotStarted) updateCameraTracking(DT, visualState, env);

  const drag = game.state === STATE.AIM ? input.getDragState() : null;
  const cameraMoving = visualState === STATE.AIM && keys.size === 0 && (
    Math.abs(camera.x) > 0.015
    || Math.abs(camera.y - CAM.height) > 0.015
    || Math.abs(camera.z) > 0.015
  );
  const activeMotion = visualState === STATE.FLIGHT || game.ball.y > 0.02 || !!drag || keys.size > 0 || cameraMoving;
  const idleInterval = game.settings.quality >= 5 ? 80 : 100;
  // Если конкретный компьютер не успевает рисовать кадр дешевле 12 мс,
  // автоматически держим стабильные 30 FPS вместо рваных случайных пропусков.
  const motionInterval = renderer.lastDrawMs > 12 ? 1000 / 30 : 0;
  const renderInterval = activeMotion ? motionInterval : idleInterval;
  if (now - lastRenderAt >= renderInterval) {
    renderer.draw({
      ball: game.ball,
      env,
      drag,
      preview: game.settings.trajectoryEnabled && drag && drag.params.power >= 3
        ? simulatePreview(drag.params, env, game.ball) : null,
      trickMode: spaceHeld && game.state === STATE.AIM,
      aftertouch: game.state === STATE.FLIGHT && game.flightTime < P.aftertouchWindow,
      showTrajectory: game.settings.trajectoryEnabled
        && (visualState === STATE.FLIGHT || visualState === STATE.SHOT_RESULT),
    });
    lastRenderAt = now;
  }

  // HUD не меняется 60 раз в секунду — не заставляем браузер зря пересчитывать DOM.
  if (now - lastUiAt >= 80) {
    ui.update();
    lastUiAt = now;
  }
  requestAnimationFrame(frame);
}

// Фоновая сцена для меню (до первого старта env нет)
let _fallback = null;
function fallbackEnv() {
  if (!_fallback) {
    game.buildEnv();
    _fallback = game.env;
    game.env = null;
  }
  return _fallback;
}

requestAnimationFrame(frame);

// Отладка из консоли
window.__game = game;
window.__input = input;
