(() => {
  "use strict";

  // --------------------------------------------------------------------
  // Telegram WebApp init
  // --------------------------------------------------------------------
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#0a0c12");
      tg.setBackgroundColor("#0a0c12");
    } catch (e) {}
  }

  function haptic(kind) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (kind === "light" || kind === "medium" || kind === "heavy") {
        tg.HapticFeedback.impactOccurred(kind);
      } else {
        tg.HapticFeedback.notificationOccurred(kind); // 'success' | 'warning' | 'error'
      }
    } catch (e) {}
  }

  // --------------------------------------------------------------------
  // API helper
  // --------------------------------------------------------------------
  async function api(path, options = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      options.headers || {}
    );
    if (tg && tg.initData) headers["X-Telegram-Init-Data"] = tg.initData;

    const res = await fetch(`/api${path}`, { ...options, headers });
    if (!res.ok) {
      let msg = `Ошибка ${res.status}`;
      try {
        const data = await res.json();
        msg = data.detail || msg;
      } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }

  // --------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------
  const state = {
    cases: [],
    rarityColors: {},
    balance: 0,
    freeReadyIn: 0,
    inventory: [],
  };

  // --------------------------------------------------------------------
  // DOM refs
  // --------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const caseGrid = $("#caseGrid");
  const balanceValue = $("#balanceValue");
  const balancePill = $("#balancePill");
  const invBadge = $("#invBadge");
  const inventoryList = $("#inventoryList");
  const invEmpty = $("#invEmpty");
  const toastEl = $("#toast");

  const overlay = $("#openOverlay");
  const overlayClose = $("#overlayClose");
  const overlayCaseName = $("#overlayCaseName");
  const reelViewport = $("#reelViewport");
  const reelTrack = $("#reelTrack");
  const spinBtn = $("#spinBtn");
  const resultPanel = $("#resultPanel");
  const resultIcon = $("#resultIcon");
  const resultName = $("#resultName");
  const resultRarity = $("#resultRarity");
  const resultSellBtn = $("#resultSellBtn");
  const resultSellValue = $("#resultSellValue");
  const resultWithdrawBtn = $("#resultWithdrawBtn");
  const resultCloseBtn = $("#resultCloseBtn");

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  }

  // --------------------------------------------------------------------
  // Tabs
  // --------------------------------------------------------------------
  document.querySelectorAll(".tabs__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs__btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const tab = btn.dataset.tab;
      $("#screen-cases").hidden = tab !== "cases";
      $("#screen-inventory").hidden = tab !== "inventory";
      Sounds.play("click", { volume: 0.5 });
    });
  });

  // --------------------------------------------------------------------
  // Rendering: case grid
  // --------------------------------------------------------------------
  function fmtCountdown(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function renderCaseGrid() {
    caseGrid.innerHTML = "";
    state.cases.forEach((c) => {
      const card = document.createElement("div");
      card.className = "case-card" + (c.is_free ? "" : " case-card--paid");

      const iconSrc = c.is_free ? "assets/icons/case_free.svg" : "assets/icons/case_paid.svg";
      const btnDisabled = c.is_free && state.freeReadyIn > 0;
      const btnLabel = c.is_free
        ? btnDisabled
          ? fmtCountdown(state.freeReadyIn)
          : "Открыть бесплатно"
        : `Открыть за ${c.price_stars}`;

      card.innerHTML = `
        <img class="case-card__icon" src="${iconSrc}" alt="">
        <div class="case-card__name">${c.name}</div>
        <div class="case-card__subtitle">${c.subtitle}</div>
        <button class="case-card__cta ${c.is_free ? "case-card__cta--free" : "case-card__cta--paid"}"
                data-case-id="${c.id}" ${btnDisabled ? "disabled" : ""}>
          ${c.is_free ? "" : '<img src="assets/icons/star.svg" alt="">'}${btnLabel}
        </button>
      `;
      caseGrid.appendChild(card);
    });

    caseGrid.querySelectorAll(".case-card__cta").forEach((btn) => {
      btn.addEventListener("click", () => onCaseButtonClick(btn.dataset.caseId));
    });
  }

  let countdownInterval = null;
  function startCountdownTicker() {
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      if (state.freeReadyIn > 0) {
        state.freeReadyIn -= 1;
        renderCaseGrid();
      }
    }, 1000);
  }

  // --------------------------------------------------------------------
  // Rendering: inventory
  // --------------------------------------------------------------------
  function rarityIcon(itemKeyOrRarity) {
    const map = {
      common: "box_common.svg",
      uncommon: "box_uncommon.svg",
      rare: "box_rare.svg",
      epic: "box_epic.svg",
      legendary: "box_legendary.svg",
    };
    return `assets/icons/${map[itemKeyOrRarity] || "box_common.svg"}`;
  }

  function renderInventory() {
    inventoryList.querySelectorAll(".inv-item").forEach((el) => el.remove());
    invEmpty.hidden = state.inventory.length > 0;
    invBadge.hidden = state.inventory.length === 0;

    state.inventory.forEach((item) => {
      const row = document.createElement("div");
      row.className = "inv-item";
      row.style.borderLeftColor = state.rarityColors[item.rarity] || "#8b93a8";
      row.innerHTML = `
        <img class="inv-item__icon" src="${rarityIcon(item.rarity)}" alt="">
        <div class="inv-item__info">
          <div class="inv-item__name">${item.name}</div>
          <div class="inv-item__meta">${item.value_gc} GC · ${labelRarity(item.rarity)}</div>
        </div>
        <div class="inv-item__actions">
          <button class="inv-btn-sell" data-action="sell" data-id="${item.id}">Продать</button>
          <button class="inv-btn-withdraw" data-action="withdraw" data-id="${item.id}" ${item.withdrawable ? "" : "disabled title=\"Пока недоступно\""}>Вывести</button>
        </div>
      `;
      inventoryList.appendChild(row);
    });

    inventoryList.querySelectorAll('[data-action="sell"]').forEach((b) =>
      b.addEventListener("click", () => sellItem(b.dataset.id))
    );
    inventoryList.querySelectorAll('[data-action="withdraw"]').forEach((b) =>
      b.addEventListener("click", () => withdrawItem(b.dataset.id))
    );
  }

  async function sellItem(id) {
    haptic("light");
    try {
      const data = await api(`/inventory/${id}/sell`, { method: "POST" });
      setBalance(data.balance_gc);
      toast("Продано!");
      await loadInventory();
      renderInventory();
    } catch (e) {
      toast(e.message);
    }
  }

  async function withdrawItem(id) {
    haptic("light");
    try {
      await api(`/inventory/${id}/withdraw`, { method: "POST" });
      toast("Подарок отправлен ботом!");
      await loadInventory();
      renderInventory();
    } catch (e) {
      toast(e.message);
    }
  }

  function labelRarity(r) {
    const labels = { common: "Обычный", uncommon: "Необычный", rare: "Редкий", epic: "Эпический", legendary: "Легендарный" };
    return labels[r] || r;
  }

  function bumpBalance() {
    balancePill.classList.add("is-bump");
    setTimeout(() => balancePill.classList.remove("is-bump"), 200);
  }

  function setBalance(v) {
    state.balance = v;
    balanceValue.textContent = v;
    bumpBalance();
  }

  // --------------------------------------------------------------------
  // Загрузка данных
  // --------------------------------------------------------------------
  async function loadCases() {
    const data = await api("/cases");
    state.cases = data.cases;
    state.rarityColors = data.rarity_colors;
  }

  async function loadMe() {
    const data = await api("/me");
    setBalance(data.balance_gc);
    state.freeReadyIn = data.free_case_ready_in;
  }

  async function loadInventory() {
    const data = await api("/inventory");
    state.inventory = data.items;
  }

  async function refreshAll() {
    await Promise.all([loadCases(), loadMe(), loadInventory()]);
    renderCaseGrid();
    renderInventory();
    startCountdownTicker();
  }

  // --------------------------------------------------------------------
  // Открытие кейса
  // --------------------------------------------------------------------
  let currentCase = null;
  let currentInventoryId = null;

  function onCaseButtonClick(caseId) {
    const c = state.cases.find((x) => x.id === caseId);
    if (!c) return;
    haptic("light");
    Sounds.play("click", { volume: 0.6 });

    if (c.is_free) {
      openFreeFlow(c);
    } else {
      buyFlow(c);
    }
  }

  function openOverlayFor(c) {
    currentCase = c;
    overlayCaseName.textContent = c.name;
    resultPanel.hidden = true;
    spinBtn.hidden = false;
    spinBtn.disabled = false;
    spinBtn.textContent = "Крутить";
    overlay.hidden = false;
  }

  overlayClose.addEventListener("click", () => {
    overlay.hidden = true;
  });

  async function openFreeFlow(c) {
    openOverlayFor(c);
    spinBtn.onclick = async () => {
      spinBtn.disabled = true;
      spinBtn.textContent = "Крутим...";
      try {
        const data = await api("/cases/free/open", { method: "POST" });
        currentInventoryId = data.inventory_id;
        runReel(c, data.item);
      } catch (e) {
        toast(e.message);
        spinBtn.disabled = false;
        spinBtn.textContent = "Крутить";
      }
    };
  }

  async function buyFlow(c) {
    if (!tg || !tg.openInvoice) {
      toast("Оплата доступна только внутри Telegram");
      return;
    }
    try {
      const data = await api(`/cases/${c.id}/buy`, { method: "POST" });
      tg.openInvoice(data.invoice_link, async (status) => {
        if (status !== "paid") {
          if (status === "failed") toast("Оплата не прошла");
          return;
        }
        Sounds.play("purchase", { volume: 0.7 });
        haptic("success");
        openOverlayFor(c);
        spinBtn.textContent = "Открываем...";
        spinBtn.disabled = true;

        // Сервер уже разыграл приз в момент successful_payment — забираем результат
        const item = await pollInvoiceResult(data.payload);
        if (item) {
          currentInventoryId = item.id;
          spinBtn.disabled = false;
          runReel(c, item);
        } else {
          toast("Не получилось получить результат, загляни в инвентарь");
          overlay.hidden = true;
        }
        await loadMe();
      });
    } catch (e) {
      toast(e.message);
    }
  }

  async function pollInvoiceResult(payload, attempts = 15) {
    for (let i = 0; i < attempts; i++) {
      const data = await api(`/invoices/${payload}`);
      if (data.status === "opened" && data.item) return data.item;
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  }

  // --------------------------------------------------------------------
  // Рулетка
  // --------------------------------------------------------------------
  const GAP = 10;
  const REEL_LENGTH = 60;
  const TARGET_INDEX = 52;

  function weightedRandomFiller(pool) {
    const total = pool.reduce((s, i) => s + i.weight, 0);
    let r = Math.random() * total;
    for (const it of pool) {
      r -= it.weight;
      if (r <= 0) return it;
    }
    return pool[pool.length - 1];
  }

  function buildReelItems(caseDef, winningItem) {
    const arr = [];
    for (let i = 0; i < REEL_LENGTH; i++) {
      if (i === TARGET_INDEX) {
        arr.push(winningItem);
      } else {
        arr.push(weightedRandomFiller(caseDef.items));
      }
    }
    return arr;
  }

  function renderReel(items) {
    reelTrack.style.transition = "none";
    reelTrack.style.transform = "translateY(-50%) translateX(0px)";
    reelTrack.innerHTML = items
      .map(
        (it) => `
      <div class="reel-item reel-item--${it.rarity}">
        <img src="assets/icons/${it.icon}" alt="">
        <div class="reel-item__label">${it.name}</div>
      </div>`
      )
      .join("");
    // force reflow so the "no transition" reset is applied before animating
    void reelTrack.offsetWidth;
  }

  function runReel(caseDef, winningItem) {
    spinBtn.hidden = true;
    const items = buildReelItems(caseDef, winningItem);
    renderReel(items);

    requestAnimationFrame(() => {
      const viewportWidth = reelViewport.clientWidth;
      const itemEl = reelTrack.children[0];
      const itemWidth = itemEl.getBoundingClientRect().width;
      const itemStep = itemWidth + GAP;

      const jitter = (Math.random() - 0.5) * itemWidth * 0.55;
      const shift = TARGET_INDEX * itemStep + itemWidth / 2 + jitter;

      const DURATION = 5.2; // секунды
      reelTrack.style.transition = `transform ${DURATION}s cubic-bezier(0.11, 0.83, 0.16, 1)`;
      requestAnimationFrame(() => {
        reelTrack.style.transform = `translateY(-50%) translateX(${-shift}px)`;
      });

      animateTicks(itemStep, shift, DURATION);

      setTimeout(() => {
        revealResult(winningItem);
      }, DURATION * 1000 + 80);
    });
  }

  function animateTicks(itemStep, totalShift, duration) {
    const start = performance.now();
    let lastIndex = 0;
    let lastTickTime = 0;

    function frame(now) {
      const t = Math.min(1, (now - start) / (duration * 1000));
      // должно совпадать с cubic-bezier(0.11, 0.83, 0.16, 1) достаточно близко для тиков
      const eased = 1 - Math.pow(1 - t, 3);
      const currentShift = eased * totalShift;
      const currentIndex = Math.floor(currentShift / itemStep);

      if (currentIndex !== lastIndex && now - lastTickTime > 35) {
        Sounds.play("tick", { volume: Math.max(0.08, 0.35 * (1 - t)) });
        if (t < 0.7) haptic("light");
        lastIndex = currentIndex;
        lastTickTime = now;
      }
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function spawnBurst() {
    const burst = document.createElement("div");
    burst.className = "burst";
    const colors = ["#ffe28a", "#ff5f4d", "#ffb02e"];
    for (let i = 0; i < 24; i++) {
      const p = document.createElement("span");
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 90;
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      p.style.setProperty("--rot", `${Math.random() * 360}deg`);
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${Math.random() * 0.1}s`;
      burst.appendChild(p);
    }
    resultPanel.appendChild(burst);
    setTimeout(() => burst.remove(), 1100);
  }

  function revealResult(item) {
    resultPanel.hidden = false;
    resultPanel.dataset.rarity = item.rarity;
    resultIcon.src = `assets/icons/${item.icon}`;
    resultName.textContent = item.name;
    resultRarity.textContent = labelRarity(item.rarity);
    resultSellValue.textContent = item.value_gc;
    resultWithdrawBtn.disabled = !item.real_gift_id && !item.withdrawable;

    const soundByRarity = {
      common: "win_common",
      uncommon: "win_common",
      rare: "win_rare",
      epic: "win_epic",
      legendary: "win_legendary",
    };
    Sounds.play(soundByRarity[item.rarity] || "win_common", { volume: 0.8 });

    if (item.rarity === "epic" || item.rarity === "legendary") {
      overlay.querySelector(".overlay__panel").classList.add("shake");
      setTimeout(() => overlay.querySelector(".overlay__panel").classList.remove("shake"), 500);
      spawnBurst();
      haptic("heavy");
    } else {
      haptic("success");
    }
  }

  resultSellBtn.addEventListener("click", async () => {
    if (!currentInventoryId) return;
    try {
      const data = await api(`/inventory/${currentInventoryId}/sell`, { method: "POST" });
      setBalance(data.balance_gc);
      toast("Продано!");
      overlay.hidden = true;
      await loadInventory();
      renderInventory();
    } catch (e) {
      toast(e.message);
    }
  });

  resultWithdrawBtn.addEventListener("click", async () => {
    if (!currentInventoryId) return;
    resultWithdrawBtn.disabled = true;
    try {
      await api(`/inventory/${currentInventoryId}/withdraw`, { method: "POST" });
      toast("Подарок отправлен ботом!");
      overlay.hidden = true;
      await loadInventory();
      renderInventory();
    } catch (e) {
      toast(e.message);
      resultWithdrawBtn.disabled = false;
    }
  });

  resultCloseBtn.addEventListener("click", async () => {
    overlay.hidden = true;
    await loadInventory();
    renderInventory();
  });

  // --------------------------------------------------------------------
  // Старт
  // --------------------------------------------------------------------
  Sounds.preload();
  refreshAll().catch((e) => toast(e.message));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      loadMe().then(renderCaseGrid).catch(() => {});
    }
  });
})();
