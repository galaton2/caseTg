// Простой менеджер звука. Уважает системный тумблер "звук выключен" через localStorage-флаг,
// который переключается кнопкой в интерфейсе (см. app.js).
const Sounds = (() => {
  const files = {
    click: "assets/sounds/click.wav",
    tick: "assets/sounds/tick.wav",
    purchase: "assets/sounds/purchase.wav",
    win_common: "assets/sounds/win_common.wav",
    win_rare: "assets/sounds/win_rare.wav",
    win_epic: "assets/sounds/win_epic.wav",
    win_legendary: "assets/sounds/win_legendary.wav",
  };

  const cache = {};
  let enabled = true;

  function preload() {
    Object.entries(files).forEach(([key, src]) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      cache[key] = audio;
    });
  }

  function setEnabled(val) {
    enabled = val;
  }

  function play(key, { volume = 1 } = {}) {
    if (!enabled || !cache[key]) return;
    try {
      const node = cache[key].cloneNode();
      node.volume = volume;
      node.play().catch(() => {});
    } catch (e) {
      /* ignore autoplay restrictions */
    }
  }

  return { preload, play, setEnabled };
})();
