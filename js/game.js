import { PHYSICS as P, WORLD, SCORING, DEFAULT_SETTINGS, DIFFICULTY } from './config.js';
import { createBall, resetBall, stepBall, stepJuggle, maxCurveDeviation, wentAroundWall, shotVelocity } from './physics.js';

export const STATE = {
  MENU: 'menu',
  AIM: 'aim',           // прицеливание + чеканка
  FLIGHT: 'flight',
  SHOT_RESULT: 'shotResult',
  SESSION_RESULT: 'sessionResult',
  PAUSED: 'paused',
};

export class Game {
  constructor(sound) {
    this.sound = sound;
    this.settings = { ...DEFAULT_SETTINGS };
    this.ball = createBall();
    this.state = STATE.MENU;
    this.env = null;
    this.resetSession();
  }

  resetSession() {
    this.shotIndex = 0;
    this.totalScore = 0;
    this.bestShot = null;   // {points, curve, combo, corner, aroundWall, fire}
    this.lastShot = null;
    this.combo = 0;
    this.volley = false;
    this.shotResultTimer = 0;
    this.flightTime = 0;
    this.aftertouchVelX = 0; // скорость мыши, подаётся из main каждый кадр
    this.easyAssistActive = false;
    this.pausedFrom = null;
  }

  buildEnv() {
    const s = this.settings;
    const goalHalfWidth = (WORLD.goalWidth / 2) * s.goalScale;
    const wall = s.wallEnabled ? {
      z: s.distance * WORLD.wallZFraction,
      players: s.wallPlayers,
      halfWidth: (s.wallPlayers * WORLD.wallPlayerWidth) / 2,
      height: WORLD.wallPlayerHeight,
    } : null;
    this.env = {
      goalZ: s.distance,
      goalHalfWidth,
      goalScale: s.goalScale,
      targetMode: s.targetMode,
      difficulty: s.difficulty,
      previewFraction: DIFFICULTY[s.difficulty].previewFraction,
      wall,
    };
  }

  startSession() {
    this.buildEnv();
    this.resetSession();
    resetBall(this.ball);
    this.pausedFrom = null;
    this.state = STATE.AIM;
    this.sound.whistle();
  }

  pause() {
    if (![STATE.AIM, STATE.FLIGHT, STATE.SHOT_RESULT].includes(this.state)) return false;
    this.pausedFrom = this.state;
    this.state = STATE.PAUSED;
    this.aftertouchVelX = 0;
    return true;
  }

  resume() {
    if (this.state !== STATE.PAUSED || !this.pausedFrom) return false;
    this.state = this.pausedFrom;
    this.pausedFrom = null;
    return true;
  }

  exitToMenu() {
    this.pausedFrom = null;
    this.aftertouchVelX = 0;
    resetBall(this.ball);
    this.state = STATE.MENU;
  }

  // --- Чеканка (в состоянии AIM) ---
  juggleTap() {
    if (this.state !== STATE.AIM) return;
    const b = this.ball;
    // Комбо: тач у верхней точки полёта
    if (b.y > P.juggleMinHeight && Math.abs(b.vy) < P.apexWindow) {
      this.combo++;
      this.sound.tap();
    } else if (b.y <= 0.05) {
      this.sound.tap();
    }
    b.vy = P.juggleImpulse;
    b.resting = false;
    if (b.y < 0) b.y = 0;
  }

  // --- Трюк (зажат пробел): подброс/подкрут мяча вместо удара ---
  trick(params) {
    if (this.state !== STATE.AIM) return;
    const b = this.ball;
    b.resting = false;
    b.vx += params.dirX * P.trickImpulseX;
    b.vy = Math.min(Math.max(b.vy, 0) + Math.max(params.dirY, 0.25) * P.trickImpulseY, P.trickMaxVy);
    b.spin += params.spin * P.trickSpinGain;
    b.spin = Math.max(-P.maxSpin, Math.min(P.maxSpin, b.spin));
    if (b.y < 0.01) b.y = 0.01;
    this.combo++;
    this.sound.trick(this.combo);
  }

  // --- Основной удар ---
  shoot(params) {
    if (this.state !== STATE.AIM) return;
    const b = this.ball;
    this.volley = b.y > 0.15; // удар с воздуха
    b.resting = false;
    b.trajectory = [{ x: b.x, y: b.y, z: b.z }];
    const v = shotVelocity(params);
    const difficulty = this.settings.difficulty;
    const tuning = DIFFICULTY[difficulty];
    this.easyAssistActive = false;
    b.vz = v.vz;

    // EASY: помощь срабатывает в момент удара и лишь частично подправляет
    // начальный импульс. После этого никакого скрытого самонаведения нет.
    if (difficulty === 'easy' && Math.random() < tuning.assistChance) {
      const side = Math.sign(v.vx) || (Math.random() < 0.5 ? -1 : 1);
      const cornerMode = this.env.targetMode === 'corners';
      const targetX = cornerMode
        ? side * (this.env.goalHalfWidth - WORLD.topCornerX * this.env.goalScale * 0.48)
        : (Math.random() * 2 - 1) * this.env.goalHalfWidth * 0.38;
      const targetY = cornerMode
        ? WORLD.goalHeight - WORLD.topCornerY * 0.5
        : 0.68 + Math.random() * 0.82;
      const travelTime = Math.max(0.35, (this.env.goalZ - b.z) / Math.max(5, b.vz));
      const rawVx = b.vx + v.vx;
      const rawVy = v.vy;
      const idealVx = (targetX - b.x) / travelTime;
      const idealVy = (targetY - b.y + 0.5 * P.gravity * travelTime * travelTime) / travelTime;
      const blend = cornerMode ? 0.36 : 0.3;
      // Ограничение поправки принципиально: очень плохой удар всё ещё промахнётся.
      const correctionX = Math.max(-1.8, Math.min(1.8, (idealVx - rawVx) * blend));
      const correctionY = Math.max(-1.3, Math.min(1.3, (idealVy - rawVy) * blend));
      b.vx = rawVx + correctionX;
      b.vy = rawVy + correctionY;
      this.easyAssistActive = true;

      // Со стенкой даём только небольшой ранний подъём, но не гарантируем обход.
      if (this.env.wall) {
        const wallTime = Math.max(0.08, (this.env.wall.z - b.z) / Math.max(5, b.vz));
        const predictedAtWall = b.y + b.vy * wallTime - 0.5 * P.gravity * wallTime * wallTime;
        const clearance = this.env.wall.height + WORLD.ballRadius + 0.12;
        if (predictedAtWall < clearance) {
          b.vy += Math.min(1.15, ((clearance - predictedAtWall) / wallTime) * 0.45);
        }
      }
    } else {
      const hardSideFactor = difficulty === 'hard' ? 1.14 : 1;
      const hardHeightFactor = difficulty === 'hard'
        ? 1 + Math.max(-0.08, Math.min(0.12, (params.dirY - 0.52) * 0.22))
        : 1;
      b.vy = v.vy * hardHeightFactor;
      b.vx += v.vx * hardSideFactor; // дрейф от трюков сохраняется
    }
    const spinFactor = difficulty === 'easy' && this.easyAssistActive ? 0.82 : difficulty === 'hard' ? 1.08 : 1;
    b.spin = Math.max(-P.maxSpin, Math.min(P.maxSpin, (v.spin + b.spin * 0.6) * spinFactor)); // закрутка из воздуха переносится в удар
    b.spinPhase = 0;
    b.onFire = params.power >= P.maxPower * P.fireThreshold;
    this.flightTime = 0;
    this.state = STATE.FLIGHT;
    if (b.onFire) this.sound.fireKick();
    else this.sound.kick(params.power / P.maxPower);
  }

  // --- Тик (dt фиксированный) ---
  update(dt) {
    const b = this.ball;

    if (this.state === STATE.AIM) {
      stepJuggle(b, dt);
      // Мяч упал и лежит → комбо сгорает
      if (b.y <= 0 && b.vy === 0 && this.combo > 0 && this._wasAirborne) {
        this.combo = 0;
      }
      this._wasAirborne = b.y > 0.05;
      return;
    }

    if (this.state === STATE.FLIGHT) {
      // Aftertouch: первые aftertouchWindow секунд мяч слушается мыши —
      // ведёшь вбок → докручиваешь его в полёте
      this.flightTime += dt;
      if (this.flightTime < P.aftertouchWindow && Math.abs(this.aftertouchVelX) > 0.05) {
        const aftertouchFactor = DIFFICULTY[this.settings.difficulty].aftertouchFactor;
        b.spin += this.aftertouchVelX * P.aftertouchRate * aftertouchFactor * dt;
        b.spin = Math.max(-P.maxSpin * 1.2, Math.min(P.maxSpin * 1.2, b.spin));
        b.vx += Math.max(-2.5, Math.min(2.5, this.aftertouchVelX)) * P.aftertouchSideAccel * aftertouchFactor * dt;
      }
      if (this.settings.difficulty === 'normal') this.applyAimAssist(dt);
      b.spinPhase = (b.spinPhase || 0) + b.spin * dt * 0.12 + b.vz * dt * 0.5;
      const event = stepBall(b, dt, this.env);
      if (event === 'post') this.sound.post();
      if (event === 'wall') {
        this.sound.miss();
      }
      if (event === 'goal' || event === 'topCorner') {
        this.finishShot(event === 'topCorner');
      } else if (b.resting) {
        this.finishShot(null); // мимо / застрял
      }
      return;
    }

    if (this.state === STATE.SHOT_RESULT) {
      this.shotResultTimer -= dt;
      // Мяч в сетке пусть висит; таймер выводит на следующий удар
      if (this.shotResultTimer <= 0) this.nextShot();
    }
  }

  // Небольшая помощь только у самой рамки. Плохой удар она не исправляет,
  // зато близкий промах на несколько сантиметров мягко возвращает в створ.
  applyAimAssist(dt) {
    const b = this.ball;
    const remaining = this.env.goalZ - b.z;
    if (remaining <= 0 || b.vz <= 2) return;
    const time = Math.max(0.08, Math.min(1.2, remaining / b.vz));
    const predictedX = b.x + b.vx * time;
    const xEdge = this.env.goalHalfWidth + WORLD.ballRadius * 0.35;
    const absX = Math.abs(predictedX);
    if (absX > xEdge && absX < xEdge + P.aimAssistMarginX) {
      const targetX = Math.sign(predictedX) * (xEdge - 0.08);
      const correctionVx = (targetX - predictedX) / time;
      b.vx += correctionVx * Math.min(1, P.aimAssistRate * dt);
    }

    const predictedY = b.y + b.vy * time - 0.5 * P.gravity * time * time;
    const yEdge = WORLD.goalHeight + WORLD.ballRadius * 0.35;
    if (predictedY > yEdge && predictedY < yEdge + P.aimAssistMarginY) {
      const correctionVy = (WORLD.goalHeight - 0.08 - predictedY) / time;
      b.vy += correctionVy * Math.min(1, P.aimAssistRate * dt);
    }
  }

  finishShot(topCorner) {
    const b = this.ball;
    const scored = topCorner !== null;
    let points = 0;
    let details = null;

    if (scored) {
      const countsAsGoal = this.env.targetMode === 'any' || topCorner;
      if (countsAsGoal) {
        const curve = maxCurveDeviation(b.trajectory);
        const around = wentAroundWall(b.trajectory, this.env.wall);
        points = SCORING.base;
        if (topCorner) points *= SCORING.topCornerMult;
        points *= (1 + this.combo * SCORING.comboMult);
        if (this.volley) points *= SCORING.volleyMult;
        if (around) points += SCORING.wallCurveBonus;
        if (b.onFire) points += SCORING.fireBonus;
        points += Math.round(curve * SCORING.curveBonusPerMeter);
        points = Math.round(points);
        details = { points, curve, combo: this.combo, volley: this.volley, corner: !!topCorner, aroundWall: around, fire: !!b.onFire };
        this.sound.goal();
      } else {
        // Попал в ворота, но режим "только девятка" — не считается
        details = { points: 0, noCount: true };
        this.sound.miss();
      }
    } else {
      const crossing = b.goalCrossing;
      let missReason = 'BLOCKED OR SHORT';
      if (crossing) {
        if (crossing.y > WORLD.goalHeight) missReason = 'TOO HIGH';
        else if (crossing.x < -this.env.goalHalfWidth) missReason = 'WIDE LEFT';
        else if (crossing.x > this.env.goalHalfWidth) missReason = 'WIDE RIGHT';
        else missReason = 'OFF TARGET';
      }
      details = { points: 0, missReason };
      this.sound.miss();
    }

    this.totalScore += points;
    this.lastShot = details;
    if (points > 0 && (!this.bestShot || points > this.bestShot.points)) this.bestShot = details;

    this.state = STATE.SHOT_RESULT;
    this.shotResultTimer = scored ? 2.0 : 2.25;
  }

  nextShot() {
    this.shotIndex++;
    this.combo = 0;
    this.volley = false;
    this.easyAssistActive = false;
    if (this.shotIndex >= SCORING.shotsPerSession) {
      this.state = STATE.SESSION_RESULT;
      this.saveHighScore();
      this.sound.whistle();
    } else {
      resetBall(this.ball);
      this.state = STATE.AIM;
    }
  }

  // --- Рекорды ---
  loadHighScore() {
    try { return parseInt(localStorage.getItem('trickshot-highscore') || '0', 10); }
    catch { return 0; }
  }

  saveHighScore() {
    try {
      const hs = this.loadHighScore();
      this.isNewRecord = this.totalScore > hs;
      if (this.isNewRecord) localStorage.setItem('trickshot-highscore', String(this.totalScore));
    } catch { this.isNewRecord = false; }
  }
}
