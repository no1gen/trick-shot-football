import { STATE } from './game.js';
import { SCORING, SCREEN, PALETTE as C } from './config.js';

// HTML-оверлеи: меню, HUD, результаты, шеринг.
export class UI {
  constructor(game, onStart, options = {}) {
    this.game = game;
    this.onStart = onStart;
    this.onQuality = options.onQuality || (() => {});
    this.onResetCamera = options.onResetCamera || (() => {});
    this.onPauseChange = options.onPauseChange || (() => {});
    this.menu = document.getElementById('menu');
    this.hud = document.getElementById('hud');
    this.shotBanner = document.getElementById('shot-banner');
    this.result = document.getElementById('result');
    this.pauseOverlay = document.getElementById('pause');
    this.trajectoryToggle = document.getElementById('trajectory-toggle');
    this.pauseToggle = document.getElementById('pause-toggle');
    try {
      const savedQuality = parseInt(localStorage.getItem('trickshot-quality') || '', 10);
      if (savedQuality >= 1 && savedQuality <= 6) this.game.settings.quality = savedQuality;
      const savedDifficulty = localStorage.getItem('trickshot-difficulty');
      if (['easy', 'normal', 'hard'].includes(savedDifficulty)) this.game.settings.difficulty = savedDifficulty;
    } catch { /* настройки останутся дефолтными */ }
    this.bindMenu();
    this.bindResult();
    this.bindPause();
    this.bindQuality();
    this.trajectoryToggle.addEventListener('click', () => {
      this.game.settings.trajectoryEnabled = !this.game.settings.trajectoryEnabled;
      this.syncButtons();
    });
  }

  bindMenu() {
    const g = this.game.settings;
    const $ = id => document.getElementById(id);

    const goalSize = $('opt-goal-size');
    const goalSizeVal = $('opt-goal-size-val');
    goalSize.addEventListener('input', () => {
      g.goalScale = parseFloat(goalSize.value);
      goalSizeVal.textContent = g.goalScale.toFixed(2) + 'X';
    });

    const setDifficulty = difficulty => {
      g.difficulty = difficulty;
      try { localStorage.setItem('trickshot-difficulty', difficulty); } catch { /* private mode */ }
      this.syncButtons();
    };
    $('opt-difficulty-easy').addEventListener('click', () => setDifficulty('easy'));
    $('opt-difficulty-normal').addEventListener('click', () => setDifficulty('normal'));
    $('opt-difficulty-hard').addEventListener('click', () => setDifficulty('hard'));

    $('opt-mode-any').addEventListener('click', () => { g.targetMode = 'any'; this.syncButtons(); });
    $('opt-mode-corners').addEventListener('click', () => { g.targetMode = 'corners'; this.syncButtons(); });

    $('opt-wall-toggle').addEventListener('click', () => { g.wallEnabled = !g.wallEnabled; this.syncButtons(); });

    const wallN = $('opt-wall-n');
    const wallNVal = $('opt-wall-n-val');
    wallN.addEventListener('input', () => {
      g.wallPlayers = parseInt(wallN.value, 10);
      wallNVal.textContent = g.wallPlayers;
    });

    const wallHeight = $('opt-wall-height');
    const wallHeightVal = $('opt-wall-height-val');
    wallHeight.addEventListener('input', () => {
      g.wallHeight = parseFloat(wallHeight.value);
      wallHeightVal.textContent = g.wallHeight.toFixed(2) + 'm';
    });

    const dist = $('opt-distance');
    const distVal = $('opt-distance-val');
    dist.addEventListener('input', () => {
      g.distance = parseInt(dist.value, 10);
      distVal.textContent = g.distance + 'm';
    });

    $('opt-trajectory').addEventListener('click', () => {
      g.trajectoryEnabled = !g.trajectoryEnabled;
      this.syncButtons();
    });

    $('btn-start').addEventListener('click', () => {
      this.menu.classList.add('hidden');
      this.pauseOverlay.classList.add('hidden');
      this.onStart();
    });

    this.syncButtons();
    $('menu-highscore').textContent = 'HI-SCORE: ' + this.game.loadHighScore();
  }

  syncButtons() {
    const g = this.game.settings;
    const difficultyLabels = { easy: 'SOFT ASSIST', normal: 'BALANCED', hard: 'LESS HELP' };
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const button = document.getElementById('opt-difficulty-' + difficulty);
      const active = g.difficulty === difficulty;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    document.getElementById('opt-difficulty-val').textContent = difficultyLabels[g.difficulty];
    document.getElementById('opt-mode-any').classList.toggle('active', g.targetMode === 'any');
    document.getElementById('opt-mode-corners').classList.toggle('active', g.targetMode === 'corners');
    const wt = document.getElementById('opt-wall-toggle');
    wt.textContent = g.wallEnabled ? 'WALL: ON' : 'WALL: OFF';
    wt.classList.toggle('active', g.wallEnabled);
    document.getElementById('wall-n-row').style.opacity = g.wallEnabled ? '1' : '0.35';
    document.getElementById('wall-height-row').style.opacity = g.wallEnabled ? '1' : '0.35';
    const buttons = [document.getElementById('opt-trajectory'), this.trajectoryToggle];
    for (const button of buttons) {
      button.textContent = g.trajectoryEnabled ? 'BALL TRAIL: ON' : 'BALL TRAIL: OFF';
      button.classList.toggle('active', g.trajectoryEnabled);
      button.setAttribute('aria-pressed', String(g.trajectoryEnabled));
    }
  }

  bindResult() {
    document.getElementById('btn-again').addEventListener('click', () => {
      this.result.classList.add('hidden');
      this.onStart();
    });
    document.getElementById('btn-menu').addEventListener('click', () => {
      this.result.classList.add('hidden');
      this.game.exitToMenu();
      this.onResetCamera();
      document.getElementById('menu-highscore').textContent = 'HI-SCORE: ' + this.game.loadHighScore();
      this.menu.classList.remove('hidden');
    });
    document.getElementById('btn-share').addEventListener('click', () => this.share());
  }

  bindPause() {
    this.pauseToggle.addEventListener('click', () => this.togglePause());
    document.getElementById('btn-resume').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-restart').addEventListener('click', () => {
      this.pauseOverlay.classList.add('hidden');
      this.onPauseChange();
      this.onStart();
    });
    document.getElementById('btn-exit-menu').addEventListener('click', () => {
      this.pauseOverlay.classList.add('hidden');
      this.result.classList.add('hidden');
      this.game.exitToMenu();
      this.onPauseChange();
      this.onResetCamera();
      document.getElementById('menu-highscore').textContent = 'HI-SCORE: ' + this.game.loadHighScore();
      this.menu.classList.remove('hidden');
    });
  }

  bindQuality() {
    const ranges = [document.getElementById('opt-quality'), document.getElementById('pause-quality')];
    const setQuality = value => {
      const quality = Math.max(1, Math.min(6, parseInt(value, 10) || 1));
      this.game.settings.quality = quality;
      for (const range of ranges) range.value = String(quality);
      document.getElementById('opt-quality-val').textContent = quality + 'X';
      document.getElementById('pause-quality-val').textContent = quality + 'X';
      this.onQuality(quality);
      try { localStorage.setItem('trickshot-quality', String(quality)); } catch { /* private mode */ }
    };
    for (const range of ranges) range.addEventListener('input', () => setQuality(range.value));
    setQuality(this.game.settings.quality);
  }

  togglePause() {
    if (this.game.state === STATE.PAUSED) {
      this.game.resume();
      this.onPauseChange();
      this.pauseOverlay.classList.add('hidden');
    } else if (this.game.pause()) {
      this.onPauseChange();
      this.pauseOverlay.classList.remove('hidden');
      document.getElementById('btn-resume').focus();
    }
  }

  // Вызывается каждый кадр
  update() {
    const g = this.game;
    const inGame = g.state === STATE.AIM || g.state === STATE.FLIGHT || g.state === STATE.SHOT_RESULT || g.state === STATE.PAUSED;
    this.hud.classList.toggle('hidden', !inGame);
    this.trajectoryToggle.classList.toggle('hidden', !inGame);
    this.pauseToggle.classList.toggle('hidden', !inGame || g.state === STATE.PAUSED);
    this.pauseOverlay.classList.toggle('hidden', g.state !== STATE.PAUSED);

    if (inGame) {
      document.getElementById('hud-score').textContent = 'SCORE ' + g.totalScore;
      const awaitingKick = (g.state === STATE.AIM && g.kicksThisRound > 0) || g.reboundKickReady;
      const kickNumber = awaitingKick
        ? g.kicksThisRound + 1
        : g.kicksThisRound;
      const kickLabel = kickNumber > 1 ? ' · KICK ' + kickNumber : '';
      document.getElementById('hud-shot').textContent = 'SHOT ' + Math.min(g.shotIndex + 1, SCORING.shotsPerSession) + '/' + SCORING.shotsPerSession + kickLabel;
      const comboEl = document.getElementById('hud-combo');
      if (g.combo > 0) {
        comboEl.textContent = 'COMBO x' + g.combo;
        comboEl.classList.remove('hidden');
      } else comboEl.classList.add('hidden');
    }

    // Баннер результата удара
    const resultState = g.state === STATE.SHOT_RESULT || (g.state === STATE.PAUSED && g.pausedFrom === STATE.SHOT_RESULT);
    if (resultState && g.lastShot) {
      const s = g.lastShot;
      let text;
      if (s.noCount) text = 'NOT A CORNER!';
      else if (s.points > 0) {
        text = s.corner ? 'TOP CORNER! +' + s.points : 'GOAL! +' + s.points;
        if (s.aroundWall) text += ' ★BENDER';
        if (s.fire) text += ' 🔥';
      } else text = 'MISS — ' + (s.missReason || 'TRY AGAIN');
      this.shotBanner.textContent = text;
      this.shotBanner.classList.remove('hidden', 'live');
      this.shotBanner.classList.toggle('goal', s.points > 0);
    } else if (g.state === STATE.FLIGHT && g.reboundKickReady && g.retryPromptTimer > 0) {
      this.shotBanner.textContent = 'LIVE REBOUND — KICK NOW!';
      this.shotBanner.classList.remove('hidden', 'goal');
      this.shotBanner.classList.add('live');
    } else if (g.state === STATE.AIM && g.retryPromptTimer > 0) {
      this.shotBanner.textContent = 'BALL STILL LIVE — KICK AGAIN!';
      this.shotBanner.classList.remove('hidden', 'goal');
      this.shotBanner.classList.add('live');
    } else {
      this.shotBanner.classList.add('hidden');
      this.shotBanner.classList.remove('live');
    }

    // Экран итогов сессии
    if (g.state === STATE.SESSION_RESULT && this.result.classList.contains('hidden')) {
      this.showResult();
    }
  }

  showResult() {
    const g = this.game;
    document.getElementById('result-score').textContent = String(g.totalScore);
    document.getElementById('result-record').textContent = g.isNewRecord ? 'NEW RECORD!' : 'BEST: ' + g.loadHighScore();
    const best = g.bestShot;
    document.getElementById('result-best').textContent = best
      ? 'BEST SHOT: +' + best.points + (best.corner ? ' (TOP CORNER)' : '') + (best.aroundWall ? ' (BENDER)' : '')
      : 'NO GOALS... KEEP TRYING!';
    this.result.classList.remove('hidden');
  }

  // Генерация share-картинки на отдельном канвасе
  share() {
    const g = this.game;
    const c = document.createElement('canvas');
    c.width = 480; c.height = 270;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = C.skyTop;
    ctx.fillRect(0, 0, 480, 270);
    ctx.fillStyle = C.grassDark;
    ctx.fillRect(0, 180, 480, 90);
    ctx.fillStyle = C.grassLight;
    for (let i = 0; i < 5; i++) ctx.fillRect(0, 180 + i * 18, 480, 9);

    ctx.textAlign = 'center';
    ctx.fillStyle = C.hud;
    ctx.font = '16px monospace';
    ctx.fillText('TRICK-SHOT FOOTBALL', 240, 50);
    ctx.font = 'bold 48px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(g.totalScore), 240, 130);
    ctx.font = '12px monospace';
    ctx.fillStyle = C.hud;
    const best = g.bestShot;
    ctx.fillText(best ? 'BEST SHOT +' + best.points + (best.aroundWall ? ' AROUND THE WALL' : '') : 'SCORE', 240, 160);
    ctx.fillStyle = '#888888';
    ctx.fillText('CAN YOU BEND IT?', 240, 230);

    c.toBlob(async blob => {
      const file = new File([blob], 'trickshot-score.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Trick-Shot Football', text: 'I scored ' + g.totalScore + ' in Trick-Shot Football!' });
          return;
        } catch { /* отменил — падаем в скачивание */ }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'trickshot-score.png';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
}
