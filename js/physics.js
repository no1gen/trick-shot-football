import { PHYSICS as P, WORLD } from './config.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Мяч: позиция (x — вбок, y — вверх, z — вглубь к воротам), скорости, spin.
export function createBall() {
  return {
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    spin: 0,
    resting: true,
    trajectory: [],      // точки полёта для расчёта кривизны/отрисовки
    guidePath: null,     // нарисованный игроком маршрут наземного удара
    guideStrength: 0,
    guideSpeed: 0,
    goalCrossing: null,  // где мяч пересёк плоскость ворот — для честной подсказки промаха
    outReason: null,
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
  ball.guidePath = null;
  ball.guideStrength = 0;
  ball.guideSpeed = 0;
  ball.goalCrossing = null;
  ball.outReason = null;
}

// Раскладка параметров старого воздушного/повторного флика в стартовые скорости.
export function shotVelocity({ power, dirX, dirY, spin }) {
  const shotSpeed = Math.max(P.minPower, Math.min(P.maxPower, power));
  const lift = Math.max(0, Math.min(1, dirY));
  const powerMix = (shotSpeed - P.minPower) / (P.maxPower - P.minPower);
  const side = Math.max(-1, Math.min(1, dirX));
  return {
    // Широкий сектор удара позволяет возвращать мяч к воротам даже с фланга.
    vx: shotSpeed * side * P.shotSideFactor,
    // Низ, рабочее окно и удар выше перекладины — всё определяется высотой жеста.
    vy: (2.1 + lift * 7.4) * (0.87 + powerMix * 0.13) * P.liftFactor,
    vz: shotSpeed * (0.76 + lift * 0.24)
      * (1 - Math.abs(side) * P.shotSideForwardLoss) * P.forwardFactor,
    spin,
  };
}

function samplePathAtZ(path, z) {
  if (!path?.length) return null;
  if (z <= path[0].z) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (z <= path[i].z) {
      const a = path[i - 1], b = path[i];
      const span = Math.max(0.001, b.z - a.z);
      const t = clamp((z - a.z) / span, 0, 1);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      };
    }
  }
  return path[path.length - 1];
}

// Начальный импульс направлен по первому участку рисунка. Дальше обычные
// силы остаются активны, а мягкое физическое наведение следует всему пути.
export function pathShotVelocity({ power, targetX, targetY, spin, guidePath }, origin, env) {
  const start = origin || { x: 0, y: 0, z: 0 };
  const shotSpeed = clamp(power, P.minPower, P.maxPower);
  if (guidePath?.length > 1) {
    const firstTarget = samplePathAtZ(
      guidePath,
      Math.min(env.goalZ, start.z + P.pathGuideLookAhead * 1.35),
    );
    const dx = firstTarget.x - start.x;
    const dy = firstTarget.y - start.y;
    const dz = Math.max(0.1, firstTarget.z - start.z);
    const length = Math.max(0.001, Math.hypot(dx, dy, dz));
    return {
      vx: shotSpeed * dx / length,
      vy: shotSpeed * dy / length,
      vz: shotSpeed * dz / length,
      spin: clamp(spin, -P.maxSpin, P.maxSpin),
    };
  }
  const distance = Math.max(0.5, env.goalZ - start.z);
  const travelTime = clamp(distance / Math.max(8, shotSpeed * 0.82), 0.38, 2.4);
  const vz = (distance / travelTime) * 1.055;
  const magnusAccel = spin * P.magnus * vz;
  return {
    vx: (targetX - start.x) / travelTime - magnusAccel * travelTime * 0.52,
    vy: (targetY - start.y + 0.5 * P.gravity * travelTime * travelTime) / travelTime,
    vz,
    spin: clamp(spin, -P.maxSpin, P.maxSpin),
  };
}

function applyPathGuide(ball, dt) {
  const path = ball.guidePath;
  if (!path?.length || ball.guideStrength <= 0 || ball.vz <= 0.1) return;
  const last = path[path.length - 1];
  if (ball.z >= last.z - 0.03) return;

  const targetZ = Math.min(last.z, ball.z + P.pathGuideLookAhead);
  const target = samplePathAtZ(path, targetZ);
  if (!target) return;
  const dx = target.x - ball.x;
  const dy = target.y - ball.y;
  const dz = Math.max(0.05, target.z - ball.z);
  const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
  const currentSpeed = Math.hypot(ball.vx, ball.vy, ball.vz);
  const desiredSpeed = Math.max(currentSpeed, ball.guideSpeed * 0.68, P.minPower * 0.6);
  const lookTime = distance / Math.max(5, desiredSpeed);
  const desiredVx = desiredSpeed * dx / distance;
  const desiredVy = desiredSpeed * dy / distance + P.gravity * lookTime * 0.42;
  const desiredVz = desiredSpeed * dz / distance;
  const blend = 1 - Math.exp(-ball.guideStrength * dt);
  ball.vx += (desiredVx - ball.vx) * blend;
  ball.vy += (desiredVy - ball.vy) * blend;
  ball.vz += (desiredVz - ball.vz) * blend;
}

// Один тик физики (dt в секундах, фиксированный 1/60).
// Возвращает событие: null | 'goal' | 'topCorner' | 'post' | 'wall' | 'targetBlock' | 'miss' | 'out' | 'stopped'
export function stepBall(ball, dt, env) {
  if (ball.resting) return null;

  const prevZ = ball.z;
  const prevX = ball.x;
  const prevY = ball.y;

  // Рисунок не телепортирует мяч по координатам. Он мягко поворачивает
  // вектор скорости, поэтому гравитация, сопротивление, вращение и удары
  // о препятствия продолжают работать как раньше.
  applyPathGuide(ball, dt);

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

  // Когда прыжки закончились, мяч катится с отдельным сопротивлением.
  // Без него слабый отскок мог скользить почти бесконечно.
  if (ball.y <= 0.001 && ball.vy === 0) {
    const rolling = Math.exp(-P.rollingFriction * dt);
    ball.vx *= rolling;
    ball.vz *= rolling;
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
      if (env.targetMode === 'corners' && !corner) {
        // В режиме «только девятка» остальной створ — физическая стенка.
        // Она возвращает мяч в поле и сразу открывает возможность нового удара.
        ball.x = ix; ball.y = Math.max(0, iy); ball.z = env.goalZ - 0.02;
        ball.vz = -Math.abs(ball.vz) * P.targetBlockBounce;
        ball.vx *= 0.68;
        ball.vy *= 0.62;
        ball.spin *= 0.65;
        event = 'targetBlock';
      } else {
        ball.x = ix; ball.y = Math.max(0, iy); ball.z = env.goalZ + 0.4;
        ball.vx = 0; ball.vy = 0; ball.vz = 0;
        ball.resting = true;
        event = corner ? 'topCorner' : 'goal';
      }
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

  // --- Границы поля ---
  if (Math.abs(ball.x) > WORLD.fieldHalfWidth || ball.z < -WORLD.fieldBack) {
    ball.resting = true;
    ball.outReason = Math.abs(ball.x) > WORLD.fieldHalfWidth
      ? (ball.x < 0 ? 'OUT LEFT' : 'OUT RIGHT')
      : 'OUT BEHIND';
    event = 'out';
  }
  const totalV = Math.hypot(ball.vx, ball.vy, ball.vz);
  if (ball.y <= 0.01 && totalV < 0.5 && !ball.resting) {
    ball.resting = true;
    ball.vx = 0; ball.vy = 0; ball.vz = 0;
    event = event || 'stopped';
  }

  if (event || ball.resting) {
    ball.guidePath = null;
    ball.guideStrength = 0;
    ball.guideSpeed = 0;
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
