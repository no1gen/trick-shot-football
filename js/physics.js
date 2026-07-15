import { PHYSICS as P, WORLD } from './config.js';

// Мяч: позиция (x — вбок, y — вверх, z — вглубь к воротам), скорости, spin.
export function createBall() {
  return {
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    spin: 0,
    resting: true,
    trajectory: [],      // точки полёта для расчёта кривизны/отрисовки
    goalCrossing: null,  // где мяч пересёк плоскость ворот — для честной подсказки промаха
  };
}

export function resetBall(ball) {
  ball.x = 0; ball.y = 0; ball.z = 0;
  ball.vx = 0; ball.vy = 0; ball.vz = 0;
  ball.spin = 0;
  ball.spinPhase = 0;
  ball.onFire = false;
  ball.resting = true;
  ball.trajectory = [];
  ball.goalCrossing = null;
}

// Раскладка параметров удара в стартовые скорости.
// Единственное место маппинга — использует и реальный удар, и превью.
export function shotVelocity({ power, dirX, dirY, spin }) {
  const shotSpeed = Math.max(P.minPower, Math.min(P.maxPower, power));
  const lift = Math.max(0, Math.min(1, dirY));
  const powerMix = (shotSpeed - P.minPower) / (P.maxPower - P.minPower);
  return {
    // Полный боковой жест теперь действительно может увести мяч мимо ворот.
    vx: shotSpeed * dirX * 0.27,
    // Низ, рабочее окно и удар выше перекладины — всё определяется высотой жеста.
    vy: (2.1 + lift * 7.4) * (0.87 + powerMix * 0.13) * P.liftFactor,
    vz: shotSpeed * (0.76 + lift * 0.24) * P.forwardFactor,
    spin,
  };
}

// Превью траектории при прицеливании: симулируем полёт на клоне мяча
// до previewFraction дистанции (дальше игрок должен угадывать сам).
export function simulatePreview(params, env, origin) {
  const v = shotVelocity(params);
  const start = origin || { x: 0, y: 0, z: 0, vx: 0, spin: 0 };
  const clone = {
    x: start.x, y: start.y, z: start.z,
    vx: (start.vx || 0) + v.vx,
    vy: v.vy,
    vz: v.vz,
    spin: Math.max(-P.maxSpin, Math.min(P.maxSpin, v.spin + (start.spin || 0) * 0.6)),
    resting: false,
    trajectory: [{ x: start.x, y: start.y, z: start.z }],
    goalCrossing: null,
  };
  const cutoffZ = start.z + (env.goalZ - start.z) * (env.previewFraction ?? P.previewFraction);
  for (let i = 0; i < 240; i++) {
    const event = stepBall(clone, 1 / 60, env);
    // Прогноз заканчивается на первом контакте и больше не рисует ломаные
    // отскоки от стенки/штанги поверх линии прицеливания.
    if (event) {
      clone.trajectory[clone.trajectory.length - 1] = { x: clone.x, y: clone.y, z: clone.z };
      break;
    }
    if (clone.resting || clone.z >= cutoffZ) break;
  }
  return clone.trajectory.filter(p => p.z <= cutoffZ + 0.01);
}

// Один тик физики (dt в секундах, фиксированный 1/60).
// Возвращает событие: null | 'goal' | 'topCorner' | 'post' | 'wall' | 'miss' | 'stopped'
export function stepBall(ball, dt, env) {
  if (ball.resting) return null;

  const prevZ = ball.z;
  const prevX = ball.x;
  const prevY = ball.y;

  // 1. Эффект Магнуса. Перпендикулярная сила плавно поворачивает вектор
  // скорости: положительный spin гнёт вправо, отрицательный — влево.
  const oldVx = ball.vx;
  const oldVz = ball.vz;
  const horizontalSpeed = Math.hypot(oldVx, oldVz);
  if (horizontalSpeed > 0.1) {
    ball.vx += ball.spin * P.magnus * oldVz * dt;
    ball.vz -= ball.spin * P.magnus * oldVx * dt;
  }

  // 2. Гравитация и физическое квадратичное сопротивление воздуха.
  ball.vy -= P.gravity * dt;
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  const drag = Math.max(0, 1 - P.airDrag * speed * dt);
  ball.vx *= drag;
  ball.vy *= drag;
  ball.vz *= drag;

  // 3. Вращение затухает одинаково при любой частоте кадров.
  ball.spin *= Math.exp(-P.spinDecay * dt);

  // 4. Интеграция
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  ball.trajectory.push({ x: ball.x, y: ball.y, z: ball.z });

  let event = null;

  // --- Земля ---
  if (ball.y <= 0 && ball.vy < 0) {
    ball.y = 0;
    ball.vy = -ball.vy * P.bounce;
    ball.vx *= P.groundFriction;
    ball.vz *= P.groundFriction;
    ball.spin *= 0.8;
    if (Math.abs(ball.vy) < 0.8) ball.vy = 0;
  }

  // --- Стенка (плоскость z = wallZ) ---
  if (env.wall && prevZ < env.wall.z && ball.z >= env.wall.z) {
    const t = (env.wall.z - prevZ) / (ball.z - prevZ);
    const ix = prevX + (ball.x - prevX) * t;
    const iy = prevY + (ball.y - prevY) * t;
    if (Math.abs(ix) <= env.wall.halfWidth + WORLD.ballRadius && iy <= env.wall.height + WORLD.ballRadius) {
      // Блок: мяч отлетает назад
      ball.z = env.wall.z - 0.01;
      ball.x = ix; ball.y = iy;
      ball.vz = -ball.vz * P.bounce * 0.6;
      ball.vx *= 0.4;
      ball.spin *= 0.3;
      event = 'wall';
    }
  }

  // --- Плоскость ворот (z = goalZ) ---
  if (prevZ < env.goalZ && ball.z >= env.goalZ) {
    const t = (env.goalZ - prevZ) / (ball.z - prevZ);
    const ix = prevX + (ball.x - prevX) * t;
    const iy = prevY + (ball.y - prevY) * t;
    const hw = env.goalHalfWidth;
    const gh = WORLD.goalHeight;
    const pr = WORLD.postRadius + WORLD.ballRadius;

    if (!ball.goalCrossing) ball.goalCrossing = { x: ix, y: iy };

    const hitPost = (Math.abs(Math.abs(ix) - hw) < pr && iy < gh + pr);
    const hitBar = (Math.abs(iy - gh) < pr && Math.abs(ix) < hw + pr);
    // Аркадное правило: если хотя бы край мяча вошёл в проём, это гол.
    // Так «миллиметровое» попадание внутрь не отскакивает от невидимой рамки.
    const overlapsOpening = Math.abs(ix) - WORLD.ballRadius < hw
      && iy - WORLD.ballRadius < gh
      && iy + WORLD.ballRadius > 0;

    if (overlapsOpening) {
      const corner = (hw - Math.min(Math.abs(ix), hw) < WORLD.topCornerX * env.goalScale)
        && (gh - Math.min(iy, gh) < WORLD.topCornerY);
      ball.x = ix; ball.y = Math.max(0, iy); ball.z = env.goalZ + 0.4;
      ball.vx = 0; ball.vy = 0; ball.vz = 0;
      ball.resting = true;
      event = corner ? 'topCorner' : 'goal';
    } else if (hitPost || hitBar) {
      ball.z = env.goalZ - 0.01;
      ball.x = ix; ball.y = iy;
      ball.vz = -ball.vz * P.bounce;
      if (hitPost) ball.vx = -ball.vx * P.bounce;
      if (hitBar) ball.vy = -ball.vy * P.bounce;
      event = 'post';
    } else {
      event = 'miss'; // мимо ворот, летит дальше
    }
  }

  // --- Мяч улетел далеко мимо или остановился ---
  if (ball.z > env.goalZ + 6 || Math.abs(ball.x) > 30) {
    ball.resting = true;
    if (!event) event = 'miss';
  }
  const totalV = Math.hypot(ball.vx, ball.vy, ball.vz);
  if (ball.y <= 0.01 && totalV < 0.5 && !ball.resting) {
    ball.resting = true;
    ball.vx = 0; ball.vy = 0; ball.vz = 0;
    event = event || 'stopped';
  }

  return event;
}

// Чеканка/трюки: физика без оси z — мяч прыгает, дрейфует вбок, крутится.
export function stepJuggle(ball, dt) {
  const grounded = ball.y <= 0 && ball.vy <= 0;
  if (grounded && Math.abs(ball.vx) < 0.05) {
    ball.y = 0; ball.vy = 0; ball.vx = 0;
    return;
  }
  ball.vy -= P.gravity * dt;
  ball.y += ball.vy * dt;
  ball.x += ball.vx * dt;
  ball.vx *= 0.995;
  ball.spin *= Math.exp(-P.spinDecay * dt);
  ball.spinPhase = (ball.spinPhase || 0) + ball.spin * dt * 0.12;
  // Не даём укатиться из зоны трюков
  if (Math.abs(ball.x) > P.juggleZoneX) {
    ball.x = Math.sign(ball.x) * P.juggleZoneX;
    ball.vx = -ball.vx * 0.5;
  }
  if (ball.y <= 0 && ball.vy < 0) {
    ball.y = 0;
    ball.vy = -ball.vy * P.bounce;
    ball.vx *= P.groundFriction;
    if (Math.abs(ball.vy) < 1.2) ball.vy = 0;
  }
}

// Кривизна траектории: макс. отклонение x от прямой старт→финиш.
export function maxCurveDeviation(traj) {
  if (traj.length < 3) return 0;
  const a = traj[0], b = traj[traj.length - 1];
  const dz = b.z - a.z;
  if (Math.abs(dz) < 0.01) return 0;
  let max = 0;
  for (const p of traj) {
    const t = (p.z - a.z) / dz;
    const lineX = a.x + (b.x - a.x) * t;
    const dev = Math.abs(p.x - lineX);
    if (dev > max) max = dev;
  }
  return max;
}

// Обводка стенки: в плоскости стенки мяч был сбоку от неё, но гол пришёл в раму.
export function wentAroundWall(traj, wall) {
  if (!wall) return false;
  for (let i = 1; i < traj.length; i++) {
    if (traj[i - 1].z < wall.z && traj[i].z >= wall.z) {
      const t = (wall.z - traj[i - 1].z) / (traj[i].z - traj[i - 1].z);
      const ix = traj[i - 1].x + (traj[i].x - traj[i - 1].x) * t;
      const iy = traj[i - 1].y + (traj[i].y - traj[i - 1].y) * t;
      // Прошёл сбоку (не над) стенки
      return Math.abs(ix) > wall.halfWidth && iy < wall.height + 0.5;
    }
  }
  return false;
}
