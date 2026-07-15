import { CAM, SCREEN, PALETTE as C, WORLD, PHYSICS as P } from './config.js';

// ---- Камера (двигается стрелками) ----
export const camera = { x: 0, y: CAM.height, z: 0 };

export function resetCamera() {
  camera.x = 0;
  camera.y = CAM.height;
  camera.z = 0;
}

// ---- 2.5D проекция ----
// px/м на глубине z (камера в CAM.back метрах позади мяча)
export function ppm(z) {
  return CAM.focal / Math.max(0.65, z - camera.z + CAM.back);
}

// Мировая точка (x вбок, y вверх, z вглубь) → экран
export function project(x, y, z) {
  const s = ppm(z);
  return {
    x: SCREEN.w / 2 + (x - camera.x) * s,
    y: CAM.horizonY + (camera.y - y) * s,
    s,
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = 0;
    this.lastDrawMs = 0;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.setQuality(1);
  }

  setQuality(value) {
    const quality = Math.max(1, Math.min(6, Math.round(value || 1)));
    const cssWidth = this.canvas.getBoundingClientRect().width || SCREEN.w;
    const displayScale = Math.ceil((cssWidth / SCREEN.w) * Math.min(window.devicePixelRatio || 1, 2));
    // 6X остаётся уровнем детализации, но игровой буфер ограничен 3X.
    // 1440×810 уже немного выше полного экрана игры, а прежние 1920×1080
    // заставляли ноутбук перерисовывать вдвое больше пикселей на каждом кадре.
    const renderScale = Math.max(1, Math.min(quality, displayScale, 3));
    if (quality === this.quality
      && renderScale === this.renderScale
      && this.canvas.width === SCREEN.w * renderScale) return;
    this.quality = quality;
    this.renderScale = renderScale;
    this.canvas.width = SCREEN.w * renderScale;
    this.canvas.height = SCREEN.h * renderScale;
    this.ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    this.ctx.imageSmoothingEnabled = quality > 1;
    this.canvas.classList.toggle('smooth-render', quality > 1);
    this.canvas.closest('#stage')?.classList.toggle('high-quality', quality >= 3);
  }

  draw(state) {
    const drawStartedAt = performance.now();
    const ctx = this.ctx;
    this.drawSky(ctx);
    this.drawField(ctx, state.env);
    this.drawGoal(ctx, state.env);

    const ball = state.ball;
    const wall = state.env.wall;
    const ballBehindWall = wall && ball.z > wall.z;

    if (state.showTrajectory && ball.trajectory.length > 1) this.drawTrajectory(ctx, ball.trajectory);

    if (!ballBehindWall) {
      if (wall) this.drawWall(ctx, wall);
      this.drawShadow(ctx, ball);
      this.drawBall(ctx, ball);
    } else {
      this.drawShadow(ctx, ball);
      this.drawBall(ctx, ball);
      if (wall) this.drawWall(ctx, wall);
    }

    if (state.drag) this.drawAim(ctx, state.drag, ball, state.preview);

    // Индикатор трюк-режима (зажат пробел)
    if (state.trickMode) {
      ctx.fillStyle = '#40f080';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('★ TRICK MODE — FLICK THE BALL ★', SCREEN.w / 2, SCREEN.h - 10);
    }

    // Подсказка aftertouch: мяч ещё слушается мыши
    if (state.aftertouch) {
      ctx.fillStyle = C.spinArrow;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('◄ MOVE MOUSE TO BEND ►', SCREEN.w / 2, SCREEN.h - 10);
    }
    this.lastDrawMs = performance.now() - drawStartedAt;
  }

  drawSky(ctx) {
    const horizon = CAM.horizonY;
    const grad = ctx.createLinearGradient(0, 0, 0, horizon);
    grad.addColorStop(0, C.skyTop);
    grad.addColorStop(1, C.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SCREEN.w, horizon);
    // Пиксельные звёзды/огни стадиона
    ctx.fillStyle = '#f8f858';
    for (let i = 0; i < 12; i++) {
      const x = ((i * 137 + 40) % SCREEN.w);
      const y = 8 + (i * 53) % (horizon - 30);
      ctx.fillRect(x, y, 2, 2);
    }
  }

  drawField(ctx, env) {
    const horizon = CAM.horizonY;
    ctx.fillStyle = C.grassDark;
    ctx.fillRect(0, horizon, SCREEN.w, SCREEN.h - horizon);

    // Полосы газона по глубине
    const nearZ = camera.z - CAM.back + 0.5;
    for (let i = 0; i < 10; i++) {
      const z0 = env.goalZ + 4 - i * (env.goalZ + 8) / 10;
      const z1 = z0 - (env.goalZ + 8) / 20;
      if (z1 < nearZ) continue;
      const y0 = project(0, 0, Math.max(z0, nearZ)).y;
      const y1 = project(0, 0, Math.max(z1, nearZ)).y;
      if (i % 2 === 0) {
        ctx.fillStyle = C.grassLight;
        ctx.fillRect(0, Math.min(y0, y1), SCREEN.w, Math.abs(y1 - y0) + 1);
      }
    }

    // Штрафная линия у ворот
    const lz = env.goalZ - 0.1;
    const lp = project(0, 0, lz);
    ctx.fillStyle = C.line;
    const halfLine = 11 * ppm(lz);
    ctx.fillRect(lp.x - halfLine, lp.y, halfLine * 2, 1);

    // Сходящиеся боковые линии усиливают глубину без тяжёлого WebGL.
    ctx.strokeStyle = 'rgba(232,232,216,0.34)';
    ctx.lineWidth = 1;
    for (const side of [-1, 1]) {
      const near = project(side * 10, 0, Math.max(0, nearZ + 0.2));
      const far = project(side * 6, 0, env.goalZ);
      ctx.beginPath();
      ctx.moveTo(near.x, near.y);
      ctx.lineTo(far.x, far.y);
      ctx.stroke();
    }
  }

  drawGoal(ctx, env) {
    const hw = env.goalHalfWidth;
    const gh = WORLD.goalHeight;
    const z = env.goalZ;
    const tl = project(-hw, gh, z);
    const tr = project(hw, gh, z);
    const bl = project(-hw, 0, z);
    const br = project(hw, 0, z);
    // Глубина сетки
    const backZ = z + 1.5;
    const btl = project(-hw * 0.9, gh * 0.9, backZ);
    const btr = project(hw * 0.9, gh * 0.9, backZ);
    const bbl = project(-hw * 0.9, 0, backZ);
    const bbr = project(hw * 0.9, 0, backZ);

    // Сетка (за рамой)
    ctx.strokeStyle = C.net;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    const netN = this.quality >= 4 ? 12 : 8;
    for (let i = 0; i <= netN; i++) {
      const t = i / netN;
      // вертикальные нити задней стенки
      const x0 = btl.x + (btr.x - btl.x) * t;
      const x1 = bbl.x + (bbr.x - bbl.x) * t;
      ctx.beginPath(); ctx.moveTo(x0, btl.y); ctx.lineTo(x1, bbl.y); ctx.stroke();
      // горизонтальные
      const y0 = btl.y + (bbl.y - btl.y) * t;
      ctx.beginPath(); ctx.moveTo(btl.x, y0); ctx.lineTo(btr.x, y0); ctx.stroke();
    }
    // боковые сетки
    ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(btl.x, btl.y); ctx.lineTo(bbl.x, bbl.y); ctx.lineTo(bl.x, bl.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tr.x, tr.y); ctx.lineTo(btr.x, btr.y); ctx.lineTo(bbr.x, bbr.y); ctx.lineTo(br.x, br.y); ctx.stroke();
    ctx.globalAlpha = 1;

    // Объёмная рама: тёмная подложка + светлая труба.
    const drawFrame = (color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bl.x, bl.y);
      ctx.lineTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.stroke();
    };
    drawFrame('rgba(0,0,0,0.55)', 4);
    drawFrame(C.goalFrame, 2.2);
    if (this.quality >= 3) drawFrame('rgba(255,255,255,0.72)', 0.7);

    // Зоны девятки (если режим corners)
    if (env.targetMode === 'corners') {
      ctx.strokeStyle = C.hud;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      const cx = WORLD.topCornerX * env.goalScale;
      const cy = WORLD.topCornerY;
      for (const side of [-1, 1]) {
        const a = project(side * hw, gh, z);
        const b = project(side * (hw - cx), gh, z);
        const c = project(side * (hw - cx), gh - cy, z);
        const d = project(side * hw, gh - cy, z);
        ctx.fillStyle = 'rgba(248,232,56,0.12)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  drawWall(ctx, wall) {
    const n = wall.players;
    const w = WORLD.wallPlayerWidth;
    const h = wall.height;
    for (let i = 0; i < n; i++) {
      const cx = -wall.halfWidth + w / 2 + i * w;
      const foot = project(cx, 0, wall.z);
      const head = project(cx, h, wall.z);
      const pw = Math.max(3, w * ppm(wall.z));
      const bodyH = foot.y - head.y;
      // Тень игрока
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y + 1, pw * 0.7, pw * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      // Ноги (шорты+ноги)
      ctx.fillStyle = C.wallShorts;
      ctx.fillRect(foot.x - pw / 2 + 1, head.y + bodyH * 0.55, pw - 2, bodyH * 0.2);
      ctx.fillStyle = C.wallSkin;
      ctx.fillRect(foot.x - pw / 2 + 1, head.y + bodyH * 0.75, pw - 2, bodyH * 0.25);
      // Торс
      ctx.fillStyle = C.wallShirt;
      ctx.fillRect(foot.x - pw / 2, head.y + bodyH * 0.18, pw, bodyH * 0.37);
      // Голова
      ctx.fillStyle = C.wallSkin;
      const headR = pw * 0.32;
      ctx.fillRect(foot.x - headR, head.y, headR * 2, bodyH * 0.18);
    }
  }

  drawShadow(ctx, ball) {
    if (ball.z < camera.z - CAM.back + 0.5) return;
    const p = project(ball.x, 0, ball.z);
    const r = WORLD.ballRadius * p.s;
    const shrink = Math.max(0.4, 1 - ball.y * 0.06);
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * 1.1 * shrink, r * 0.4 * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBall(ctx, ball) {
    if (ball.z < camera.z - CAM.back + 0.5) return;
    const p = project(ball.x, ball.y, ball.z);
    const r = Math.max(1.5, WORLD.ballRadius * p.s);

    // Огненный хвост при ударе на максимальной силе
    if (ball.onFire && !ball.resting && ball.trajectory.length > 1) {
      const tail = ball.trajectory.slice(-14);
      for (let i = 0; i < tail.length; i++) {
        const t = i / tail.length; // 0 = хвост, 1 = у мяча
        const tp = project(tail[i].x, tail[i].y, tail[i].z);
        const tr = Math.max(1, r * (0.3 + t * 0.8));
        ctx.globalAlpha = 0.15 + t * 0.45;
        ctx.fillStyle = t > 0.66 ? '#f8e838' : t > 0.33 ? '#f08020' : '#c03010';
        const jitterX = Math.sin(i * 12.7 + (ball.spinPhase || 0)) * 0.9;
        const jitterY = Math.cos(i * 8.3 + (ball.spinPhase || 0)) * 0.9;
        ctx.beginPath();
        ctx.arc(tp.x + jitterX, tp.y + jitterY, tr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Ореол вокруг мяча
      ctx.strokeStyle = '#f8a030';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.quality >= 3 && r > 2.5) {
      const ballShade = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      ballShade.addColorStop(0, '#ffffff');
      ballShade.addColorStop(0.72, C.ball);
      ballShade.addColorStop(1, '#b8b8b0');
      ctx.fillStyle = ballShade;
    } else {
      ctx.fillStyle = C.ball;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Пятна как у классического мяча — вращаются от spin
    if (r > 2.5) {
      const rot = (ball.spinPhase || 0);
      ctx.fillStyle = C.ballPattern;
      for (let i = 0; i < 3; i++) {
        const a = rot + i * (Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * r * 0.5, p.y + Math.sin(a) * r * 0.5, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = C.ballPattern;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawTrajectory(ctx, traj) {
    const points = traj
      .filter(pt => pt.z >= camera.z - CAM.back + 0.5)
      .map(pt => project(pt.x, pt.y, pt.z));
    if (points.length < 2) return;

    const stroke = (color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    };
    stroke('rgba(0,0,0,0.48)', 3);
    stroke('rgba(248,232,56,0.92)', 1.25);

    ctx.fillStyle = 'rgba(248,232,56,0.9)';
    for (let i = 0; i < points.length; i += 9) {
      ctx.fillRect(Math.round(points[i].x) - 1, Math.round(points[i].y) - 1, 2, 2);
    }
  }

  drawAim(ctx, drag, ball, preview) {
    const bp = project(ball.x, ball.y, ball.z);

    // Стабильный прогноз: одна чистая линия без отскоков и «синих зигзагов».
    if (preview && preview.length > 1) {
      const previewPoints = preview
        .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z))
        .map(pt => project(pt.x, pt.y, pt.z));
      const strokePreview = (color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(previewPoints[0].x, previewPoints[0].y);
        for (let i = 1; i < previewPoints.length; i++) ctx.lineTo(previewPoints[i].x, previewPoints[i].y);
        ctx.stroke();
      };
      strokePreview('rgba(0,0,0,0.52)', 3.2);
      strokePreview('rgba(72,204,248,0.92)', 1.35);
      // Один спокойный маркер обрыва. Россыпь точек и пустое кольцо раньше
      // визуально складывались в «петлю» на конце сильной закрутки.
      const lp = previewPoints[previewPoints.length - 1];
      ctx.fillStyle = 'rgba(180,238,255,0.96)';
      ctx.beginPath();
      ctx.arc(lp.x, lp.y, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // Путь оттяжки: показывает "банан", который рисует игрок
    if (drag.trail && drag.trail.length > 2) {
      ctx.strokeStyle = 'rgba(248,248,248,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(drag.trail[0].x, drag.trail[0].y);
      for (const t of drag.trail) ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }

    // Линия оттяжки (хорда)
    ctx.strokeStyle = C.aimLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bp.x, bp.y);
    ctx.lineTo(drag.current.x, drag.current.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Индикатор силы
    const power = Math.min(drag.params.power, P.maxPower) / P.maxPower;
    ctx.fillStyle = '#303030';
    ctx.fillRect(bp.x - 20, bp.y + 14, 40, 4);
    ctx.fillStyle = C.power;
    ctx.fillRect(bp.x - 20, bp.y + 14, 40 * power, 4);

    // Индикатор закрутки: стрелки
    if (Math.abs(drag.spin) > 5) {
      ctx.fillStyle = C.spinArrow;
      const dir = Math.sign(drag.spin);
      const mag = Math.min(3, Math.ceil(Math.abs(drag.spin) / (P.maxSpin / 3)));
      for (let i = 0; i < mag; i++) {
        const ax = bp.x + dir * (12 + i * 7);
        const ay = bp.y - 14;
        ctx.beginPath();
        ctx.moveTo(ax, ay - 4);
        ctx.lineTo(ax + dir * 5, ay);
        ctx.lineTo(ax, ay + 4);
        ctx.fill();
      }
    }
  }
}
