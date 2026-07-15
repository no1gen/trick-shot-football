import { SCREEN, WORLD, PHYSICS as P } from './config.js';
import { Game, STATE } from './game.js';
import { Renderer, camera, resetCamera, trackingCameraTarget, project, unprojectAtZ } from './render.js';
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
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function mapPathGesture(gesture) {
  const env = game.env;
  if (!env) return gesture;
  const target = unprojectAtZ(gesture.end.x, gesture.end.y, env.goalZ);
  const maxTargetX = Math.max(8, env.goalHalfWidth * 1.7);
  const targetX = clamp(target.x, -maxTargetX, maxTargetX);
  const targetY = clamp(target.y, 0.08, WORLD.goalHeight + 2.8);
  return {
    targetX,
    targetY,
    spin: clamp(-gesture.curvePx * P.pathSpinPerPixel, -P.maxSpin, P.maxSpin),
  };
}

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
  canAim: () => game.canKick(),
  isTrickMode: () => spaceHeld && game.state === STATE.AIM,
  getShotMode: () => game.usesPathShot() ? 'path' : 'flick',
  getBallScreen: () => {
    const point = project(game.ball.x, game.ball.y, game.ball.z);
    return { x: point.x, y: point.y };
  },
  mapPathGesture,
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
  if (game.state === STATE.PAUSED || ![STATE.AIM, STATE.FLIGHT].includes(visualState)) return false;
  if (visualState === STATE.AIM && keys.size > 0) return true;

  const target = trackingCameraTarget(game.ball, env);
  const positionFollow = 1 - Math.exp(-(visualState === STATE.FLIGHT ? 8.5 : 6.5) * dt);
  // Отъезжаем быстрее, чем приближаемся: мяч не успевает выскочить за кадр,
  // а возврат не создаёт тяжёлого визуального рывка.
  const zoomFollow = 1 - Math.exp(-(target.zoom < camera.zoom ? 14 : 4.5) * dt);
  const beforeX = camera.x, beforeY = camera.y, beforeZ = camera.z, beforeZoom = camera.zoom;
  camera.x += (target.x - camera.x) * positionFollow;
  camera.y += (target.y - camera.y) * positionFollow;
  camera.z += (target.z - camera.z) * positionFollow;
  camera.zoom += (target.zoom - camera.zoom) * zoomFollow;
  return Math.abs(camera.x - beforeX) + Math.abs(camera.y - beforeY)
    + Math.abs(camera.z - beforeZ) + Math.abs(camera.zoom - beforeZoom) > 0.0008;
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
  camera.x = Math.max(-WORLD.fieldHalfWidth, Math.min(WORLD.fieldHalfWidth, camera.x));
  camera.y = Math.max(0.8, Math.min(24, camera.y));
  const cameraChanged = !newShotStarted && updateCameraTracking(DT, visualState, env);

  const drag = game.canKick() ? input.getDragState() : null;
  const activeMotion = visualState === STATE.FLIGHT || game.ball.y > 0.02 || !!drag || keys.size > 0 || cameraChanged;
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
