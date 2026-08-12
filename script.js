'use strict';
/* ==================================================================================
   GiftCases — frontend demo logic
   ----------------------------------------------------------------------------------
   ВАЖНО (прочитай перед переносом на бэкенд):
   Сейчас баланс, инвентарь, шансы и результат кейса считаются ПРЯМО В БРАУЗЕРЕ —
   это ок для прототипа, но пользователь может открыть консоль и подделать результат.
   Места, которые обязательно нужно перенести на сервер, отмечены как:  // [SERVER TODO]
   Идея: клиент только проигрывает анимацию, а какой предмет выпал —
   присылает бэкенд (например, через Telegram WebApp initData + подписанный ответ API).
   ================================================================================== */

// ============================================================================
// 1. CONFIG — кейсы, предметы, шансы
// ============================================================================

const CASES = {
  free: {
    id: 'free',
    name: 'Бесплатный кейс',
    tag: 'FREE • 8Ч КД',
    desc: 'Открывай раз в 8 часов. Шанс на редкий подарок — 1%.',
    icon: '🎲',
    price: 0,
    currency: 'stars',
    guaranteed: false,     // есть шанс выпадения простого предмета почти всегда
    cooldownHours: 8,
    theme: 'free',
    items: [
      { id: 'f1', name: 'Счастливая монета', icon: '🪙', rarity: 'common',    weight: 99,  value: 1   },
      { id: 'f2', name: 'Плюшевый мишка',    icon: '🧸', rarity: 'uncommon', weight: 0.6, value: 25  },
      { id: 'f3', name: 'Кольцо-сюрприз',    icon: '💍', rarity: 'epic',     weight: 0.3, value: 100 },
      { id: 'f4', name: 'Золотой кубок',     icon: '🏆', rarity: 'legendary',weight: 0.1, value: 500 },
    ],
  },
  paid: {
    id: 'paid',
    name: 'Премиум кейс',
    tag: '100% ВЫИГРЫШ',
    desc: 'Гарантированный подарок в каждом кейсе. Без пустых открытий.',
    icon: '💎',
    price: 15,
    currency: 'stars',
    guaranteed: true,      // всегда что-то выпадает, "пустых" исходов нет
    cooldownHours: 0,
    theme: 'paid',
    items: [
      { id: 'p1', name: 'Роза',               icon: '🌹', rarity: 'common',    weight: 55, value: 10  },
      { id: 'p2', name: 'Праздничный торт',   icon: '🎂', rarity: 'uncommon', weight: 28, value: 15  },
      { id: 'p3', name: 'Подарочная коробка', icon: '🎁', rarity: 'rare',     weight: 12, value: 30  },
      { id: 'p4', name: 'Ракета',             icon: '🚀', rarity: 'epic',     weight: 4,  value: 80  },
      { id: 'p5', name: 'Корона',             icon: '👑', rarity: 'legendary',weight: 1,  value: 300 },
    ],
  },
};

const RARITY_LABEL = {
  common: 'ОБЫЧНЫЙ', uncommon: 'НЕОБЫЧНЫЙ', rare: 'РЕДКИЙ', epic: 'ЭПИЧНЫЙ', legendary: 'ЛЕГЕНДАРНЫЙ',
};
const RARITY_VAR = {
  common: '--r-common', uncommon: '--r-uncommon', rare: '--r-rare', epic: '--r-epic', legendary: '--r-legend-1',
};

// ============================================================================
// 2. STATE — баланс, инвентарь, настройки (демо-хранилище в localStorage)
// ============================================================================

const LS_KEY = 'giftcases_state_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return {
    balance: 100,          // [SERVER TODO] баланс звёзд должен приходить с сервера
    inventory: [],          // [SERVER TODO] инвентарь должен приходить с сервера
    lastFreeOpenTs: 0,
    soundOn: true,
    fastMode: false,
  };
}
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

const state = loadState();

// ============================================================================
// 3. TELEGRAM WEBAPP BRIDGE
// ============================================================================

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

function tgReady() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor && tg.setHeaderColor('#0a0910');
    tg.setBackgroundColor && tg.setBackgroundColor('#0a0910');
    tg.disableVerticalSwipes && tg.disableVerticalSwipes();
  } catch (e) { /* older client versions may not support all calls */ }
}
function haptic(type) {
  if (!tg || !tg.HapticFeedback) return;
  try {
    if (type === 'success' || type === 'error' || type === 'warning') {
      tg.HapticFeedback.notificationOccurred(type);
    } else {
      tg.HapticFeedback.impactOccurred(type || 'light');
    }
  } catch (e) { /* ignore */ }
}

// Отправка события боту (например запрос на вывод подарка).
// [SERVER TODO] бот должен принять web_app_data, проверить initData на подлинность
// и обработать запрос (выдать подарок / списать баланс) на своей стороне.
function sendToBot(payload) {
  if (tg && tg.sendData) {
    try { tg.sendData(JSON.stringify(payload)); return true; } catch (e) { /* ignore */ }
  }
  console.log('[demo] sendToBot()', payload);
  return false;
}

// Покупка кейса за звёзды.
// [SERVER TODO] в проде это должно быть tg.openInvoice(starsInvoiceLink, cb) —
// Stars-инвойс создаётся на бэкенде через Bot API createInvoiceLink с currency "XTR",
// и только успешный платёж должен разблокировать открытие кейса.
function chargeStars(amount) {
  if (state.balance < amount) return false;
  state.balance -= amount;
  saveState();
  updateBalanceUI();
  return true;
}

// ============================================================================
// 4. AUDIO ENGINE — синтезированные звуки через WebAudio (без внешних файлов)
// ============================================================================

const Sound = (() => {
  let ctx = null;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, gainPeak, delay, glideTo) {
    if (!state.soundOn) return;
    try {
      const c = ac();
      const t0 = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(gainPeak || 0.2, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  return {
    tick(pitch) { tone(pitch || 720, 0.045, 'square', 0.05); },
    click() { tone(300, 0.05, 'triangle', 0.08); },
    open() { tone(180, 0.18, 'sawtooth', 0.09, 0, 90); },
    error() { tone(160, 0.18, 'square', 0.12, 0); tone(110, 0.22, 'square', 0.1, 0.1); },
    coin() { tone(880, 0.09, 'square', 0.08); tone(1320, 0.12, 'square', 0.07, 0.05); },
    winCommon() { tone(520, 0.14, 'sine', 0.12); tone(780, 0.16, 'sine', 0.1, 0.06); },
    winRare() {
      [523, 659, 784].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, i * 0.07));
    },
    winEpic() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, i * 0.07));
    },
    winLegendary() {
      [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.28, 'triangle', 0.18, i * 0.06, f * 1.15));
    },
  };
})();

// ============================================================================
// 5. CONFETTI — canvas-частицы для крутых выигрышей
// ============================================================================

const Confetti = (() => {
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let raf = null;
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  addEventListener('resize', resize); resize();

  function burst(colors, count) {
    const cx = innerWidth / 2, cy = innerHeight * 0.38;
    for (let i = 0; i < count; i++) {
      const angle = (Math.random() * Math.PI) - Math.PI / 2 - Math.PI / 2;
      const speed = 4 + Math.random() * 7;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
        vy: -Math.abs(Math.sin(angle) * speed) - 3,
        w: 5 + Math.random() * 5, h: 8 + Math.random() * 6,
        rot: Math.random() * 360, vrot: (Math.random() - 0.5) * 14,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0, maxLife: 70 + Math.random() * 30,
      });
    }
    if (!raf) loop();
  }
  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.vy += 0.16; p.x += p.vx; p.y += p.vy; p.rot += p.vrot; p.life++;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    particles = particles.filter(p => p.life < p.maxLife && p.y < canvas.height + 40);
    if (particles.length) raf = requestAnimationFrame(loop);
    else { raf = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  return {
    fire(rarity) {
      const map = {
        rare: ['#35b3f0', '#7fd4ff', '#fff'],
        epic: ['#b06bff', '#7c5cff', '#e6d4ff'],
        legendary: ['#ffd166', '#ff8a3d', '#fff4d6', '#ffb020'],
      };
      const counts = { rare: 40, epic: 70, legendary: 130 };
      if (!map[rarity]) return;
      burst(map[rarity], counts[rarity]);
    },
  };
})();

// ============================================================================
// 6. UTIL
// ============================================================================

function pickWeighted(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    if (r < it.weight) return it;
    r -= it.weight;
  }
  return items[items.length - 1];
}
function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function toast(msg, kind) {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ` toast--${kind}` : '');
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
function rarityVar(rarity) { return `var(${RARITY_VAR[rarity] || '--r-common'})`; }

// ============================================================================
// 7. RENDER: экран кейсов
// ============================================================================

function renderCaseGrid() {
  const grid = document.getElementById('caseGrid');
  grid.innerHTML = '';
  Object.values(CASES).forEach(c => {
    const card = document.createElement('button');
    card.className = `case-card case-card--${c.theme}`;
    card.innerHTML = `
      <span class="case-card__tag">${c.tag}</span>
      <div class="case-card__icon">${c.icon}</div>
      <div class="case-card__name">${c.name}</div>
      <div class="case-card__desc">${c.desc}</div>
      <div class="case-card__price">
        ${c.price > 0
          ? `<svg class="icon icon-star" viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.32 6.95.7-5.2 4.72 1.53 6.86L12 17.77 5.82 21.1l1.53-6.86-5.2-4.72 6.95-.7L12 2.5z"/></svg><span>${c.price}</span>`
          : `<span id="freeCaseLabel">Бесплатно</span>`}
      </div>`;
    card.addEventListener('click', () => openCaseScreen(c.id));
    grid.appendChild(card);
  });
  updateFreeCaseAvailability();
}

function updateFreeCaseAvailability() {
  const c = CASES.free;
  const cdMs = c.cooldownHours * 3600 * 1000;
  const remain = state.lastFreeOpenTs + cdMs - Date.now();
  const label = document.getElementById('freeCaseLabel');
  if (label) label.textContent = remain > 0 ? fmtTime(remain) : 'Бесплатно';
}

// Живая лента "выигрышей" — для атмосферы (демо-данные)
const FAKE_NAMES = ['Alex', 'Nika', 'Ivan', 'Kate', 'Dmitry', 'Sasha', 'Roma', 'Vika', 'Timur', 'Olya', 'Max', 'Liza'];
function renderTickerSeed() {
  const el = document.getElementById('ticker');
  el.innerHTML = '';
  for (let i = 0; i < 6; i++) el.appendChild(makeTickerItem());
}
function makeTickerItem() {
  const pool = [...CASES.free.items, ...CASES.paid.items];
  const item = pool[(Math.random() * pool.length) | 0];
  const name = FAKE_NAMES[(Math.random() * FAKE_NAMES.length) | 0];
  const div = document.createElement('div');
  div.className = 'ticker-item';
  div.style.setProperty('--r', rarityVar(item.rarity));
  div.innerHTML = `<span class="ticker-item__icon">${item.icon}</span><span><b>${name}</b> выиграл ${item.name}</span>`;
  return div;
}
function tickTicker() {
  const el = document.getElementById('ticker');
  el.insertBefore(makeTickerItem(), el.firstChild);
  while (el.children.length > 10) el.removeChild(el.lastChild);
}
setInterval(tickTicker, 4500 + Math.random() * 3000);

// ============================================================================
// 8. OPEN-CASE SCREEN + REEL
// ============================================================================

let currentCase = null;
let isSpinning = false;

function openCaseScreen(caseId) {
  currentCase = CASES[caseId];
  haptic('light'); Sound.click();
  document.getElementById('openCaseName').textContent = currentCase.name;
  document.getElementById('openCasePrice').innerHTML = currentCase.price > 0
    ? `<svg class="icon icon-star" viewBox="0 0 24 24" style="width:12px;height:12px;fill:currentColor"><path d="M12 2.5l2.9 6.32 6.95.7-5.2 4.72 1.53 6.86L12 17.77 5.82 21.1l1.53-6.86-5.2-4.72 6.95-.7L12 2.5z"/></svg> ${currentCase.price}`
    : (currentCase.guaranteed ? '100% выигрыш' : `Бесплатно раз в ${currentCase.cooldownHours}ч`);
  renderOdds();
  buildReel(null);
  updateOpenButton();
  switchScreen('open');
}

function renderOdds() {
  const wrap = document.getElementById('oddsList');
  const total = currentCase.items.reduce((s, it) => s + it.weight, 0);
  wrap.innerHTML = currentCase.items
    .slice().sort((a, b) => b.weight - a.weight)
    .map(it => `
      <div class="odds-row">
        <span class="odds-row__icon" style="--r:${rarityVar(it.rarity)}">${it.icon}</span>
        <span class="odds-row__name">${it.name}</span>
        <span class="odds-row__pct" style="--r:${rarityVar(it.rarity)}">${(it.weight / total * 100).toFixed(it.weight / total * 100 < 1 ? 2 : 1)}%</span>
      </div>`).join('');
}

const REEL_COUNT = 76;
const WINNER_INDEX = 66;

function buildReel(forcedWinner) {
  const track = document.getElementById('reelTrack');
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  track.innerHTML = '';
  const items = [];
  for (let i = 0; i < REEL_COUNT; i++) {
    items.push(i === WINNER_INDEX ? (forcedWinner || pickWeighted(currentCase.items)) : pickWeighted(currentCase.items));
  }
  items.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'reel-item';
    el.dataset.index = i;
    el.style.setProperty('--r', rarityVar(it.rarity));
    el.innerHTML = `<div class="reel-item__glint"></div><div class="reel-item__icon">${it.icon}</div>`;
    track.appendChild(el);
  });
  // force reflow so the "reset to 0" above is committed before any future animated transform
  void track.offsetHeight;
  return items;
}

function updateOpenButton() {
  const btn = document.getElementById('openBtn');
  const label = document.getElementById('openBtnLabel');
  if (currentCase.price > 0) {
    label.textContent = `Открыть за ${currentCase.price} ⭐`;
    btn.disabled = false;
  } else {
    const cdMs = currentCase.cooldownHours * 3600 * 1000;
    const remain = state.lastFreeOpenTs + cdMs - Date.now();
    if (remain > 0) {
      label.textContent = `Доступно через ${fmtTime(remain)}`;
      btn.disabled = true;
    } else {
      label.textContent = 'Открыть бесплатно';
      btn.disabled = false;
    }
  }
}
setInterval(() => { if (currentCase) updateOpenButton(); updateFreeCaseAvailability(); }, 1000);

let tickRaf = null;
function spin() {
  if (isSpinning) return;
  if (currentCase.price > 0) {
    if (!chargeStars(currentCase.price)) { Sound.error(); haptic('error'); toast('Недостаточно звёзд ⭐', 'err'); return; }
  } else {
    const cdMs = currentCase.cooldownHours * 3600 * 1000;
    if (state.lastFreeOpenTs + cdMs - Date.now() > 0) { Sound.error(); haptic('error'); toast('Кейс ещё не готов', 'err'); return; }
    state.lastFreeOpenTs = Date.now(); saveState();
  }

  isSpinning = true;
  document.getElementById('openBtn').disabled = true;
  document.getElementById('fastToggleBtn').disabled = true;

  // [SERVER TODO] здесь клиент сам выбирает победителя. На проде — дождаться
  // ответа сервера с уже определённым предметом и просто анимировать до него.
  const winner = pickWeighted(currentCase.items);
  const items = buildReel(winner);

  Sound.open(); haptic('medium');

  const track = document.getElementById('reelTrack');
  const viewport = track.parentElement;
  requestAnimationFrame(() => {
    const firstItem = track.children[0];
    const itemW = firstItem.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(track).gap) || 10;
    const fullW = itemW + gap;
    const viewportCenter = viewport.getBoundingClientRect().width / 2;
    const jitter = (Math.random() - 0.5) * (itemW * 0.5);
    const target = viewportCenter - (WINNER_INDEX * fullW) - itemW / 2 + jitter;

    const duration = state.fastMode ? 0.9 : 5.4;
    track.style.transition = `transform ${duration}s cubic-bezier(${state.fastMode ? '.3,.9,.25,1' : '.09,.82,.13,1'})`;
    track.style.transform = `translateX(${target}px)`;

    let lastIdx = -1;
    const startTs = performance.now();
    function frame(now) {
      const style = getComputedStyle(track);
      const matrix = new DOMMatrixReadOnly(style.transform);
      const curX = matrix.m41;
      const idx = Math.round((viewportCenter - curX - itemW / 2) / fullW);
      if (idx !== lastIdx) {
        lastIdx = idx;
        const progress = Math.min(1, (now - startTs) / (duration * 1000));
        Sound.tick(620 + Math.min(1, progress) * 260);
      }
      if (now - startTs < duration * 1000 - 30) {
        tickRaf = requestAnimationFrame(frame);
      }
    }
    tickRaf = requestAnimationFrame(frame);

    track.addEventListener('transitionend', function onEnd() {
      track.removeEventListener('transitionend', onEnd);
      cancelAnimationFrame(tickRaf);
      finishSpin(winner, items);
    }, { once: true });
  });
}

function finishSpin(winner, items) {
  isSpinning = false;
  document.getElementById('fastToggleBtn').disabled = false;
  const winnerEl = document.querySelector(`.reel-item[data-index="${WINNER_INDEX}"]`);
  if (winnerEl) {
    winnerEl.classList.add('is-winner');
    if (winner.rarity === 'epic') winnerEl.classList.add('is-epic');
    if (winner.rarity === 'legendary') winnerEl.classList.add('is-legendary');
  }
  if (winner.rarity === 'legendary') { Sound.winLegendary(); Confetti.fire('legendary'); haptic('success'); }
  else if (winner.rarity === 'epic') { Sound.winEpic(); Confetti.fire('epic'); haptic('success'); }
  else if (winner.rarity === 'rare') { Sound.winRare(); Confetti.fire('rare'); haptic('success'); }
  else { Sound.winCommon(); haptic('light'); }

  setTimeout(() => showWinModal(winner), winner.rarity === 'common' ? 260 : 550);
}

// ============================================================================
// 9. WIN MODAL
// ============================================================================

let pendingWinItem = null;

function showWinModal(item) {
  pendingWinItem = item;
  document.getElementById('winRarityLabel').textContent = RARITY_LABEL[item.rarity];
  document.getElementById('winRarityLabel').style.setProperty('--r', rarityVar(item.rarity));
  document.getElementById('winIcon').textContent = item.icon;
  document.getElementById('winName').textContent = item.name;
  document.getElementById('winValue').textContent = `≈ ${item.value} ⭐`;
  document.querySelectorAll('#winModal .win-modal__glow, #winModal .win-modal__eyebrow').forEach(el => el.style.setProperty('--r', rarityVar(item.rarity)));
  document.getElementById('winOverlay').hidden = false;
}
function closeWinModal(action) {
  document.getElementById('winOverlay').hidden = true;
  if (!pendingWinItem) { resetOpenScreen(); return; }
  if (action === 'sell') {
    state.balance += pendingWinItem.value;
    saveState(); updateBalanceUI();
    Sound.coin(); toast(`Продано за ${pendingWinItem.value} ⭐`, 'ok');
  } else if (action === 'keep') {
    addToInventory(pendingWinItem);
    toast('Добавлено в инвентарь', 'ok');
  }
  pendingWinItem = null;
  resetOpenScreen();
}
function resetOpenScreen() {
  document.getElementById('openBtn').disabled = false;
  buildReel(null);
  updateOpenButton();
}

// ============================================================================
// 10. INVENTORY
// ============================================================================

function addToInventory(item) {
  state.inventory.unshift({ ...item, uid: `${item.id}_${Date.now()}_${(Math.random() * 999) | 0}` });
  saveState();
  renderInventoryBadge();
}
function renderInventoryBadge() {
  const badge = document.getElementById('invBadge');
  if (state.inventory.length > 0) { badge.hidden = false; badge.textContent = state.inventory.length > 99 ? '99+' : state.inventory.length; }
  else badge.hidden = true;
}
function renderInventory() {
  const grid = document.getElementById('invGrid');
  const empty = document.getElementById('invEmpty');
  grid.innerHTML = '';
  if (!state.inventory.length) { empty.hidden = false; grid.hidden = true; return; }
  empty.hidden = true; grid.hidden = false;
  state.inventory.forEach(it => {
    const el = document.createElement('button');
    el.className = 'inv-item';
    el.style.setProperty('--r', rarityVar(it.rarity));
    el.innerHTML = `<div class="inv-item__icon">${it.icon}</div><div class="inv-item__name">${it.name}</div><div class="inv-item__value">${it.value} ⭐</div>`;
    el.addEventListener('click', () => openItemModal(it.uid));
    grid.appendChild(el);
  });
}

let activeInvUid = null;
function openItemModal(uid) {
  const item = state.inventory.find(i => i.uid === uid);
  if (!item) return;
  activeInvUid = uid;
  document.getElementById('itemIcon').textContent = item.icon;
  document.getElementById('itemName').textContent = item.name;
  document.getElementById('itemValue').textContent = `≈ ${item.value} ⭐`;
  document.getElementById('itemGlow').style.setProperty('--r', rarityVar(item.rarity));
  document.getElementById('itemOverlay').hidden = false;
}
function closeItemModal() { document.getElementById('itemOverlay').hidden = true; activeInvUid = null; }

function withdrawActiveItem() {
  const item = state.inventory.find(i => i.uid === activeInvUid);
  if (!item) return;
  const sent = sendToBot({ action: 'withdraw_gift', itemId: item.id, name: item.name, uid: item.uid });
  state.inventory = state.inventory.filter(i => i.uid !== activeInvUid);
  saveState(); renderInventory(); renderInventoryBadge();
  closeItemModal();
  haptic('success');
  toast(sent ? 'Заявка на вывод отправлена боту' : 'Демо: заявка на вывод создана (нет связи с ботом)', 'ok');
}
function sellActiveItem() {
  const item = state.inventory.find(i => i.uid === activeInvUid);
  if (!item) return;
  state.balance += item.value;
  state.inventory = state.inventory.filter(i => i.uid !== activeInvUid);
  saveState(); updateBalanceUI(); renderInventory(); renderInventoryBadge();
  closeItemModal();
  Sound.coin(); haptic('success');
  toast(`Продано за ${item.value} ⭐`, 'ok');
}

// ============================================================================
// 11. NAVIGATION
// ============================================================================

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.dataset.screen !== name);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('is-active', b.dataset.nav === name));
  if (name === 'inventory') renderInventory();
  if (name !== 'open') currentCase = null;
  window.scrollTo(0, 0);
}

function updateBalanceUI() {
  document.getElementById('balanceValue').textContent = state.balance;
}

// ============================================================================
// 12. EVENT WIRING
// ============================================================================

document.getElementById('backBtn').addEventListener('click', () => { Sound.click(); switchScreen('cases'); });
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => { Sound.click(); switchScreen(b.dataset.nav); }));
document.getElementById('invGoBtn').addEventListener('click', () => switchScreen('cases'));

document.getElementById('openBtn').addEventListener('click', spin);

document.getElementById('fastToggleBtn').addEventListener('click', (e) => {
  state.fastMode = !state.fastMode; saveState();
  e.currentTarget.classList.toggle('is-on', state.fastMode);
  Sound.click();
});
document.getElementById('soundToggleBtn').addEventListener('click', (e) => {
  state.soundOn = !state.soundOn; saveState();
  e.currentTarget.classList.toggle('is-on', state.soundOn);
  document.getElementById('soundIcon').style.opacity = state.soundOn ? '1' : '.35';
  if (state.soundOn) Sound.click();
});

document.getElementById('oddsBtn').addEventListener('click', () => {
  const list = document.getElementById('oddsList');
  list.hidden = !list.hidden;
  document.getElementById('oddsBtn').textContent = list.hidden ? 'Показать шансы выпадения' : 'Скрыть шансы';
});

document.getElementById('winCloseBtn').addEventListener('click', () => closeWinModal('keep'));
document.getElementById('winKeepBtn').addEventListener('click', () => closeWinModal('keep'));
document.getElementById('winSellBtn').addEventListener('click', () => closeWinModal('sell'));

document.getElementById('itemCloseBtn').addEventListener('click', closeItemModal);
document.getElementById('itemWithdrawBtn').addEventListener('click', withdrawActiveItem);
document.getElementById('itemSellBtn').addEventListener('click', sellActiveItem);

document.getElementById('winOverlay').addEventListener('click', (e) => { if (e.target.id === 'winOverlay') closeWinModal('keep'); });
document.getElementById('itemOverlay').addEventListener('click', (e) => { if (e.target.id === 'itemOverlay') closeItemModal(); });

// unlock WebAudio on first user gesture (mobile browsers requirement)
document.body.addEventListener('pointerdown', function unlock() {
  try { new (window.AudioContext || window.webkitAudioContext)().resume(); } catch (e) {}
  document.body.removeEventListener('pointerdown', unlock);
}, { once: true });

// ============================================================================
// 13. INIT
// ============================================================================

function init() {
  tgReady();
  updateBalanceUI();
  renderCaseGrid();
  renderTickerSeed();
  renderInventoryBadge();
  document.getElementById('fastToggleBtn').classList.toggle('is-on', state.fastMode);
  document.getElementById('soundToggleBtn').classList.toggle('is-on', state.soundOn);
  document.getElementById('soundIcon').style.opacity = state.soundOn ? '1' : '.35';
}
init();
