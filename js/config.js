// ============================================================
// PHYSICS — главный конфиг тюнинга. Меняй цифры, перезагружай,
// чувствуй разницу. Вся "магия фила" живёт здесь.
// ============================================================
export const PHYSICS = {
  gravity: 9.81,         // притяжение вниз (м/с²)
  // Spin хранится в рад/с. Magnus и drag не зависят от частоты кадров.
  magnus: 0.00255,       // боковая сила настоящего мяча: spin × скорость вперёд
  airDrag: 0.0062,       // квадратичное сопротивление воздуха
  spinDecay: 0.11,       // плавное затухание вращения в секунду
  bounce: 0.55,          // упругость отскока от земли/штанги
  groundFriction: 0.85,  // потеря горизонтальной скорости при отскоке
  rollingFriction: 2.35, // сопротивление качению: отбитый мяч останавливается за разумное время
  minPower: 14,          // чуть дружелюбнее: слабый удар всё ещё требует силы, но не «умирает» сразу
  maxPower: 34,          // мощный удар (м/с)
  shotSideFactor: 0.50,  // полный боковой жест позволяет бить с далёкого фланга
  shotSideForwardLoss: 0.22, // диагональный удар честно теряет часть скорости вперёд
  pathStartRadius: 32,   // насколько близко к мячу можно начать рисовать путь (px канваса)
  pathMinLength: 18,     // короткий жест остаётся чеканкой, а не случайным ударом
  pathPowerBase: 14,     // минимальная скорость медленно нарисованного удара
  pathDrawSpeedScale: 13, // средняя скорость рисования (px/ms) → скорость мяча
  pathSpinPerPixel: 4.8, // изгиб нарисованной линии → вращение мяча
  pathGuideLookAhead: 1.25, // сколько метров маршрута физика видит перед мячом
  powerScale: 0.29,      // перевод пикселей оттяжки в силу
  flickPowerScale: 14.5, // сила от скорости флика (px/ms → м/с)
  aimDragX: 122,         // более широкое рабочее окно бокового прицела
  aimDragY: 138,         // высокий промах возможен, но рабочая зона стала шире
  maxSpin: 82,           // физический потолок вращения, рад/с
  spinInputWindow: 115,  // последние миллисекунды жеста формируют вращение
  spinDeadZone: 35,      // медленный боковой шум мыши не крутит мяч (px/с)
  spinSensitivity: 0.0025,
  // Aftertouch — ГЛАВНАЯ механика закрутки: ведёшь мышь во время полёта → мяч гнётся
  aftertouchWindow: 0.9, // времени достаточно для осознанной коррекции в воздухе
  aftertouchRate: 24,    // мышь заметно докручивает мяч, не превращаясь в автопилот
  aftertouchSideAccel: 2.4,
  aimAssistRate: 1.15,   // мягко спасает только совсем близкие к рамке удары
  aimAssistMarginX: 0.55,
  aimAssistMarginY: 0.38,
  fireThreshold: 0.85,   // доля maxPower, после которой мяч ГОРИТ
  // Трюки (зажат пробел)
  trickImpulseX: 3.0,    // боковой импульс мяча за трюк-флик
  trickImpulseY: 5.5,    // вертикальный импульс за трюк-флик
  trickSpinGain: 0.5,    // сколько закрутки мяч запоминает от трюка
  trickMaxVy: 9,         // потолок вертикальной скорости при трюках
  juggleZoneX: 12,       // широкая зона трюков; камера держит мяч и ворота в кадре
  rekickCarryX: 0.22,    // доля бокового импульса летящего отскока в новом ударе
  rekickCarryY: 0.18,    // доля вертикального импульса летящего отскока
  rekickCarryZ: 0.08,    // небольшой след встречной скорости без потери контроля
  targetBlockBounce: 0.52, // упругость закрытой части ворот в режиме «девятка»
  liftFactor: 1.0,       // множитель вертикальной составляющей удара
  forwardFactor: 1.0,    // множитель составляющей "вглубь"
  // Чеканка
  juggleImpulse: 5.2,    // сила подброса при чеканке (м/с вверх)
  apexWindow: 1.6,       // |vy| меньше этого у верхней точки = "идеальный тач"
  juggleMinHeight: 0.4,  // мяч должен быть выше этого для комбо-тача
};

// Игровые константы (геометрия мира, метры)
export const WORLD = {
  goalWidth: 7.32,       // базовая ширина ворот
  goalHeight: 2.44,
  postRadius: 0.12,
  ballRadius: 0.22,
  wallPlayerWidth: 0.6,
  wallPlayerHeight: 1.85,
  wallZFraction: 0.55,   // стенка на этой доле дистанции до ворот
  topCornerX: 1.6,       // зона девятки: ближе этого к штанге
  topCornerY: 0.85,      // и выше goalHeight - этого
  fieldHalfWidth: 24,    // широкая боковая страховочная граница
  fieldBack: 18,         // далеко позади старта всё ещё можно продолжить розыгрыш
};

// Камера / проекция
export const CAM = {
  focal: 240,            // фокус (px·м): ppm = focal / (z + back)
  back: 6,               // камера в 6м позади мяча
  height: 1.7,           // высота камеры
  horizonY: 96,          // горизонт на внутреннем канвасе (из 270)
};

// Внутреннее разрешение (ретро)
export const SCREEN = { w: 480, h: 270 };

// Очки
export const SCORING = {
  base: 100,
  topCornerMult: 2,
  comboMult: 0.5,        // ×(1 + combo * это)
  volleyMult: 1.25,      // удар с воздуха
  wallCurveBonus: 150,   // обвёл стенку закруткой
  curveBonusPerMeter: 30,// бонус за метр бокового изгиба траектории
  fireBonus: 75,         // гол горящим мячом (удар на максимальной силе)
  shotsPerSession: 10,
};

// Ретро-палитра (VGA-вайб)
export const PALETTE = {
  skyTop: '#1a1a2e',
  skyBottom: '#4a4a8a',
  grassDark: '#1d7a1d',
  grassLight: '#2a9a2a',
  line: '#e8e8d8',
  goalFrame: '#f0f0f0',
  net: '#c8c8c8',
  ball: '#f8f8f0',
  ballPattern: '#202020',
  shadow: 'rgba(0,0,0,0.45)',
  wallShirt: '#d02020',
  wallShorts: '#ffffff',
  wallSkin: '#e8b080',
  hud: '#f8e838',
  hudDim: '#a89828',
  aimLine: '#f8f8f8',
  power: '#f04040',
  spinArrow: '#40c0f8',
};

// Три честно различающихся режима. NORMAL сохраняет текущий баланс.
export const DIFFICULTY = {
  easy: {
    assistChance: 0.6,
    aftertouchFactor: 1.2,
    pathErrorX: 0.16,
    pathErrorY: 0.12,
    pathPowerVariance: 0.025,
    pathSpinFactor: 0.92,
    pathGuideStrength: 16,
  },
  normal: {
    assistChance: 0,
    aftertouchFactor: 1,
    pathErrorX: 0.38,
    pathErrorY: 0.25,
    pathPowerVariance: 0.06,
    pathSpinFactor: 1,
    pathGuideStrength: 10,
  },
  hard: {
    assistChance: 0,
    aftertouchFactor: 0.78,
    pathErrorX: 0.8,
    pathErrorY: 0.48,
    pathPowerVariance: 0.12,
    pathSpinFactor: 1.15,
    pathGuideStrength: 5.8,
  },
};

// Дефолтные настройки сложности
export const DEFAULT_SETTINGS = {
  difficulty: 'normal', // 'easy' | 'normal' | 'hard'
  goalScale: 1.0,        // 0.25..3.0 множитель ширины ворот
  targetMode: 'any',     // 'any' | 'corners'
  wallEnabled: true,
  wallPlayers: 3,        // 1..25
  wallHeight: WORLD.wallPlayerHeight, // 0.6..4.0 м
  distance: 16,          // метров до ворот
  trajectoryEnabled: true, // только след реального мяча; отдельного предсказателя больше нет
  quality: 3,            // уровень детализации 1x..6x; пиксели адаптируются к экрану
};
