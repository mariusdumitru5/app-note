/* =========================================================
   common.js — funzioni condivise dalle due pagine
   ========================================================= */
(function () {
  'use strict';

  // ---- Mascotte "Dbino": un database con gli occhi, 16x16 pixel ----
  const COLORS = {
    K: '#1d1f33', // contorno
    T: '#ffd95e', // coperchio
    B: '#3a67d6', // corpo
    L: '#6d9cf4', // riflesso
    S: '#24459f', // fasce dei dischi
    W: '#ffffff', // occhi
    F: '#f0a830', // piedi
  };
  const HAPPY = [
    '....KKKKKKKK....',
    '..KKTTTTTTTTKK..',
    '.KTTTTTTTTTTTTK.',
    '.KBKKTTTTTTKKBK.',
    '.KBLBKKKKKKBBBK.',
    '.KBLBBBBBBBBBBK.',
    '.KBLWKBBBWKBBBK.',
    '.KBLKKBBBKKBBBK.',
    '.KBLBBBKKBBBBBK.',
    '.KBLBBBBBBBBBBK.',
    '.KSSSSSSSSSSSSK.',
    '.KBLBBBBBBBBBBK.',
    '.KSSSSSSSSSSSSK.',
    '..KKBBBBBBBBKK..',
    '...KKKKKKKKKK...',
    '...KFFK..KFFK...',
  ];
  const KO = HAPPY.map((row, y) => {
    if (y === 6) return '.KBLBBBBBBBBBBK.';
    if (y === 7) return '.KBLKKBBBKKBBBK.';
    if (y === 8) return '.KBLBBBBBBBBBBK.';
    if (y === 9) return '.KBLBBBKKBBBBBK.';
    return row;
  });

  function renderSprite(el, mood) {
    const rows = mood === 'ko' ? KO : HAPPY;
    let rects = '';
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (COLORS[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${COLORS[ch]}"/>`;
      });
    });
    el.innerHTML = `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  // Riavvia un'animazione CSS una tantum (salto, scossone...)
  function play(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  // ---- Box di dialogo con effetto macchina da scrivere ----
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let typingTimer = null;
  let fullText = '';

  function finishTyping() {
    const box = document.getElementById('dialog');
    clearInterval(typingTimer);
    box.querySelector('p').textContent = fullText;
    box.classList.remove('typing');
  }

  function say(text) {
    const box = document.getElementById('dialog');
    fullText = text;
    // il testo completo va subito allo screen reader, l'animazione è solo visiva
    box.querySelector('[aria-live]').textContent = text;
    clearInterval(typingTimer);
    if (reduceMotion) return finishTyping();
    const p = box.querySelector('p');
    let i = 0;
    p.textContent = '';
    box.classList.add('typing');
    typingTimer = setInterval(() => {
      i += 1;
      p.textContent = text.slice(0, i);
      if (i >= text.length) finishTyping();
    }, 22);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('dialog');
    if (box) box.addEventListener('click', finishTyping);
  });

  // ---- Chiamate alle API del server ----
  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let data = null;
    if (res.status !== 204) {
      try { data = await res.json(); } catch (_) { /* risposta senza JSON */ }
    }
    if (!res.ok) throw new Error((data && data.error) || `il server ha risposto con errore ${res.status}.`);
    return data;
  }

  // ---- Barra HP = salute della connessione al database ----
  let hooks = {};
  let lastOnline = null;

  async function refreshStatus() {
    let online = false;
    let records = null;
    try {
      const s = await api('/api/status');
      online = s.db === 'online';
      records = s.records;
    } catch (_) { online = false; }

    const fill = document.getElementById('db-hp');
    const label = document.getElementById('db-label');
    const lv = document.getElementById('rec-count');
    const sprite = document.getElementById('sprite');

    fill.style.width = online ? '100%' : '12%';
    fill.classList.toggle('low', !online);
    if (online) {
      label.textContent = records === 1 ? '1 record salvato' : `${records} record salvati`;
      lv.textContent = records;
    } else {
      label.textContent = 'Database K.O.';
    }

    if (online !== lastOnline) {
      renderSprite(sprite, online ? 'happy' : 'ko');
      sprite.classList.toggle('ko', !online);
      if (lastOnline !== null) {
        if (online && hooks.onUp) hooks.onUp();
        if (!online && hooks.onDown) hooks.onDown();
      }
    }
    lastOnline = online;
    return online;
  }

  function startStatus(h) {
    hooks = h || {};
    refreshStatus();
    setInterval(refreshStatus, 4000);
  }

  window.Game = { renderSprite, play, say, api, refreshStatus, startStatus };
})();
