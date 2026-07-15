import { PHYSICS as P, SCREEN } from './config.js';

// Drag & flick + буфер движения мыши для расчёта закрутки.
// Отдаёт колбэки: onShot({power, dirX, dirY, spin}), onJuggleTap()
export class Input {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.dragging = false;
    this.dragStart = null;   // {x, y} внутренние координаты канваса
    this.dragCurrent = null;
    this.trail = [];         // [{x, y, t}] последние позиции мыши
    // canAim() спрашиваем в момент события, а не по флагу из кадра —
    // rAF может стоять на паузе (фоновая вкладка), флаг будет протухшим
    this.canAim = callbacks.canAim || (() => true);
    this.isTrickMode = callbacks.isTrickMode || (() => false);
    // Глобальный буфер движения мыши — для aftertouch во время полёта
    this.moves = [];
    window.addEventListener('mousemove', e => {
      const now = performance.now();
      this.moves.push({ x: e.clientX, t: now });
      while (this.moves.length > 2 && now - this.moves[0].t > 150) this.moves.shift();
    });

    canvas.addEventListener('mousedown', e => this.onDown(e));
    window.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('mouseup', e => this.onUp(e));
    // Трекпад/тач на всякий случай
    canvas.addEventListener('touchstart', e => { e.preventDefault(); this.onDown(e.touches[0]); }, { passive: false });
    window.addEventListener('touchmove', e => { if (this.dragging) e.preventDefault(); this.onMove(e.touches[0]); }, { passive: false });
    window.addEventListener('touchend', e => this.onUp(e.changedTouches[0]));
  }

  toCanvas(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * SCREEN.w,
      y: (e.clientY - r.top) / r.height * SCREEN.h,
    };
  }

  onDown(e) {
    if (!this.canAim()) return;
    const p = this.toCanvas(e);
    this.dragging = true;
    this.dragStart = p;
    this.dragCurrent = p;
    this.trail = [{ ...p, t: performance.now() }];
  }

  onMove(e) {
    if (!this.dragging) return;
    const p = this.toCanvas(e);
    this.dragCurrent = p;
    this.trail.push({ ...p, t: performance.now() });
    if (this.trail.length > 300) this.trail.shift(); // весь путь оттяжки, с запасом
  }

  onUp(e) {
    if (!this.dragging) return;
    this.dragging = false;
    const end = e ? this.toCanvas(e) : this.dragCurrent;
    const start = this.dragStart;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);

    if (len < 8) {
      // Короткий тап/флик = чеканка
      this.cb.onJuggleTap && this.cb.onJuggleTap();
      return;
    }

    const params = this.computeShotParams(end);
    if (this.isTrickMode()) {
      this.cb.onTrick && this.cb.onTrick(params);
    } else {
      this.cb.onShot && this.cb.onShot(params);
    }
  }

  // Скорость мыши по горизонтали за последние ~80мс (px/ms) — aftertouch
  getRecentVelX() {
    const now = performance.now();
    const recent = this.moves.filter(m => now - m.t <= 80);
    if (recent.length < 2) return 0;
    const dt = recent[recent.length - 1].t - recent[0].t;
    if (dt < 5) return 0;
    return (recent[recent.length - 1].x - recent[0].x) / dt;
  }

  clearMotion() {
    this.dragging = false;
    this.dragStart = null;
    this.dragCurrent = null;
    this.trail = [];
    this.moves = [];
  }

  // Параметры удара из текущей оттяжки (общее для onUp и превью)
  computeShotParams(end) {
    const start = this.dragStart;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.max(Math.hypot(dx, dy), 0.001);
    // Рогатка: направление удара = ОТ точки отпускания К точке захвата
    const pullX = -dx;   // тянул вправо → бьёшь влево
    const pullY = dy;    // тянул вниз (dy>0) → бьёшь вверх
    // Сила = длина оттяжки ИЛИ скорость флика — что больше.
    // Резкий дёрг = пушечный удар, даже на коротком экране.
    const flickSpeed = this.getFlickSpeed();
    const power = Math.min(P.maxPower, Math.max(
      P.minPower,
      len * P.powerScale,
      flickSpeed * P.flickPowerScale,
    ));
    return {
      power,
      // Оси независимы: можно отдельно выбрать створ и высоту полёта.
      // Поэтому сильный удар больше не получает «безопасное» направление сам.
      dirX: Math.max(-1, Math.min(1, pullX / P.aimDragX)),
      dirY: Math.max(0, Math.min(1, pullY / P.aimDragY)),
      spin: this.computeSpin(),
    };
  }

  // Скорость движения мыши в конце оттяжки (px/ms)
  getFlickSpeed() {
    const n = this.trail.length;
    if (n < 2) return 0;
    const now = this.trail[n - 1].t;
    let i = n - 2;
    while (i > 0 && now - this.trail[i].t < 60) i--;
    const a = this.trail[i], b = this.trail[n - 1];
    const dt = b.t - a.t;
    if (dt < 5) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y) / dt;
  }

  // Закрутка берётся из боковой скорости в самом конце жеста.
  // Свежие отрезки весят больше: быстрый хлёст вправо/влево даёт чистый spin,
  // а медленное дрожание руки отсекается dead zone.
  computeSpin() {
    const now = this.trail.length ? this.trail[this.trail.length - 1].t : performance.now();
    const recent = this.trail.filter(sample => sample.t >= now - P.spinInputWindow);
    if (recent.length < 2) return 0;

    let weightedVelocity = 0;
    let weightTotal = 0;
    for (let i = 1; i < recent.length; i++) {
      const dt = recent[i].t - recent[i - 1].t;
      if (dt <= 0) continue;
      const age = now - recent[i].t;
      const weight = Math.max(0.18, Math.min(1, 1 - age / P.spinInputWindow));
      weightedVelocity += ((recent[i].x - recent[i - 1].x) / dt) * 1000 * weight;
      weightTotal += weight;
    }
    const velocity = weightTotal > 0 ? weightedVelocity / weightTotal : 0;
    if (Math.abs(velocity) < P.spinDeadZone) return 0;

    const normalized = Math.sign(velocity)
      * Math.pow(Math.abs(velocity) * P.spinSensitivity, 0.82);
    return Math.max(-P.maxSpin, Math.min(P.maxSpin, normalized * P.maxSpin));
  }

  // Для отрисовки прицела
  getDragState() {
    if (!this.dragging || !this.dragStart) return null;
    return {
      start: this.dragStart,
      current: this.dragCurrent,
      trail: this.trail,
      spin: this.computeSpin(),
      params: this.computeShotParams(this.dragCurrent),
    };
  }
}
