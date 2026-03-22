// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  view: "home", // home | catalog | flashcard | progress
  catalogFilter: { category: null, searchTerm: "", onlyZ: false },
  flashcard: {
    queue: [],
    currentIndex: 0,
    mode: "de2bot", // de2bot | bot2de
    revealed: false,
    userInput: "",
    filterCategory: null,
    filterOnlyZ: false,
  },
};

// ─── Progress (localStorage) ─────────────────────────────────────────────────
const PROGRESS_KEY = "galabau_progress_v1";

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProgress(data) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
}

function markPlant(id, status) {
  // status: 'known' | 'learning' | null (reset)
  const p = loadProgress();
  if (status === null) {
    delete p[id];
  } else {
    p[id] = { status, ts: Date.now() };
  }
  saveProgress(p);
}

function getPlantStatus(id) {
  const p = loadProgress();
  return p[id]?.status || "new";
}

// ─── iNaturalist image cache ──────────────────────────────────────────────────
const imgCache = {};

async function fetchPlantImage(plant) {
  if (imgCache[plant.id] !== undefined) return imgCache[plant.id];

  // Botanischen Namen bereinigen:
  // 1. Kultivarnamen in einfachen Anführungszeichen entfernen: 'Atropurpurea'
  // 2. Das Wort "Cultivars" entfernen
  // 3. Unterart-Kürzel (ssp., var., f.) mit Rest entfernen für sauberere Suche
  let searchName = plant.botanicalName
    .replace(/\s*'[^']*'/g, "")       // 'Cultivar' entfernen
    .replace(/\s+Cultivars?$/i, "")    // "Cultivars" am Ende entfernen
    .replace(/\s+(ssp\.|subsp\.|var\.|f\.)\s+\S+/g, "") // ssp./var. entfernen
    .trim();

  // Wenn nur noch eine Wort übrig (Gattung), auf Genus-Ebene suchen
  const parts = searchName.split(/\s+/);
  const rank = parts.length === 1 ? "genus" : "species";

  try {
    const url =
      `https://api.inaturalist.org/v1/taxa` +
      `?q=${encodeURIComponent(searchName)}` +
      `&rank=${rank}` +
      `&per_page=1` +
      `&is_active=true`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("not ok");
    const data = await res.json();
    const photo = data.results?.[0]?.default_photo?.medium_url || null;
    imgCache[plant.id] = photo;
    return photo;
  } catch (_) {
    imgCache[plant.id] = null;
    return null;
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────
function navigate(view, params = {}) {
  state.view = view;
  Object.assign(state, params);
  render();
  window.scrollTo(0, 0);
}

// ─── Render dispatcher ───────────────────────────────────────────────────────
function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";
  switch (state.view) {
    case "home":
      renderHome(app);
      break;
    case "catalog":
      renderCatalog(app);
      break;
    case "plant-detail":
      renderPlantDetail(app);
      break;
    case "flashcard-setup":
      renderFlashcardSetup(app);
      break;
    case "flashcard":
      renderFlashcard(app);
      break;
    case "progress":
      renderProgress(app);
      break;
  }
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function renderHome(app) {
  const prog = loadProgress();
  const known = Object.values(prog).filter((v) => v.status === "known").length;
  const learning = Object.values(prog).filter((v) => v.status === "learning").length;
  const total = PLANTS.length;

  app.innerHTML = `
    <div class="home">
      <div class="home-header">
        <div class="logo">🌿</div>
        <h1>GaLaBau Pflanzen</h1>
        <p class="subtitle">Gesellenprüfung Niedersachsen · ${total} Pflanzen</p>
      </div>

      <div class="progress-bar-wrap">
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${Math.round((known / total) * 100)}%"></div>
        </div>
        <p class="progress-label">${known} von ${total} gelernt (${learning} in Bearbeitung)</p>
      </div>

      <div class="home-grid">
        <button class="card-btn" onclick="startFlashcardSetup()">
          <span class="card-icon">🃏</span>
          <span class="card-title">Karteikarten</span>
          <span class="card-desc">Teste dein Wissen</span>
        </button>
        <button class="card-btn" onclick="navigate('catalog')">
          <span class="card-icon">📚</span>
          <span class="card-title">Pflanzenkatalog</span>
          <span class="card-desc">Alle Pflanzen ansehen</span>
        </button>
        <button class="card-btn" onclick="navigate('progress')">
          <span class="card-icon">📊</span>
          <span class="card-title">Fortschritt</span>
          <span class="card-desc">Lernstand im Überblick</span>
        </button>
      </div>

      <div class="category-quick">
        <p class="section-label">Kategorie</p>
        ${CATEGORIES.map(
          (cat) => `
          <button class="tag-btn" onclick="navigate('catalog'); setCatalogCategory('${cat}')">
            ${cat}
          </button>`
        ).join("")}
      </div>
    </div>
  `;
}

// ─── Catalog ─────────────────────────────────────────────────────────────────
function renderCatalog(app) {
  const { category, searchTerm, onlyZ } = state.catalogFilter;
  const plants = filterPlants({ category, searchTerm, onlyZ });

  app.innerHTML = `
    <div class="catalog">
      <div class="topbar">
        <button class="back-btn" onclick="navigate('home')">←</button>
        <h2>Pflanzenkatalog</h2>
      </div>

      <div class="search-bar">
        <input
          id="search-input"
          type="search"
          placeholder="Suche nach Name…"
          value="${escHtml(searchTerm)}"
          oninput="updateCatalogSearch(this.value)"
          autocomplete="off"
        />
      </div>

      <div class="filter-row">
        <button class="tag-btn ${!category && !onlyZ ? "active" : ""}" onclick="setCatalogFilter(null, false)">Alle</button>
        ${CATEGORIES.map(
          (cat) => `
          <button class="tag-btn ${category === cat ? "active" : ""}" onclick="setCatalogCategory('${cat}')">
            ${cat}
          </button>`
        ).join("")}
        <button class="tag-btn ${onlyZ ? "active" : ""}" onclick="setCatalogOnlyZ(${!onlyZ})">
          Nur ZP
        </button>
      </div>

      <p class="result-count">${plants.length} Pflanzen</p>

      <div class="plant-list">
        ${plants
          .map(
            (p) => `
          <div class="plant-card" onclick="openPlantDetail('${p.id}')">
            <div class="plant-card-img" id="img-${p.id}">
              <div class="img-placeholder">🌱</div>
            </div>
            <div class="plant-card-info">
              <span class="plant-german">${escHtml(p.germanName)}</span>
              <span class="plant-botanical">${escHtml(p.botanicalName)}</span>
              <span class="plant-family">${escHtml(p.family)}</span>
            </div>
            <div class="plant-card-right">
              ${p.zwischenpruefung ? '<span class="badge-z">ZP</span>' : ""}
              ${statusBadge(getPlantStatus(p.id))}
            </div>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;

  // Lazy-load images
  plants.forEach((p) => lazyLoadImage(p));
}

async function lazyLoadImage(plant) {
  const container = document.getElementById(`img-${plant.id}`);
  if (!container) return;
  const url = await fetchPlantImage(plant);
  if (!url || !document.getElementById(`img-${plant.id}`)) return;
  container.innerHTML = `<img src="${url}" alt="${escHtml(plant.germanName)}" loading="lazy" />`;
}

// ─── Plant Detail ─────────────────────────────────────────────────────────────
function renderPlantDetail(app) {
  const plant = PLANTS.find((p) => p.id === state.detailId);
  if (!plant) {
    navigate("catalog");
    return;
  }
  const status = getPlantStatus(plant.id);

  app.innerHTML = `
    <div class="detail">
      <div class="topbar">
        <button class="back-btn" onclick="navigate('catalog')">←</button>
        <h2>${escHtml(plant.germanName)}</h2>
      </div>

      <div class="detail-img" id="detail-img-${plant.id}">
        <div class="img-placeholder large">🌱</div>
      </div>

      <div class="detail-body">
        <div class="detail-names">
          <p class="detail-botanical">${escHtml(plant.botanicalName)}</p>
          <p class="detail-family">Familie: ${escHtml(plant.family)}</p>
          <p class="detail-cat">${escHtml(plant.category)}${plant.zwischenpruefung ? ' · <span class="badge-z">Zwischenprüfung</span>' : ""}</p>
        </div>

        <div class="detail-desc">
          <p>${escHtml(plant.description)}</p>
        </div>

        <div class="status-buttons">
          <p class="section-label">Lernstatus</p>
          <div class="status-row">
            <button class="status-btn ${status === "known" ? "active-known" : ""}" onclick="setStatus('${plant.id}', 'known')">
              ✓ Kann ich
            </button>
            <button class="status-btn ${status === "learning" ? "active-learning" : ""}" onclick="setStatus('${plant.id}', 'learning')">
              ↺ Üben
            </button>
            <button class="status-btn ${status === "new" ? "active-new" : ""}" onclick="setStatus('${plant.id}', null)">
              ✕ Zurücksetzen
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Load detail image
  (async () => {
    const url = await fetchPlantImage(plant);
    const container = document.getElementById(`detail-img-${plant.id}`);
    if (!container || !url) return;
    container.innerHTML = `<img src="${url}" alt="${escHtml(plant.germanName)}" />`;
  })();
}

function setStatus(id, status) {
  markPlant(id, status);
  renderPlantDetail(document.getElementById("app"));
}

// ─── Flashcard Setup ─────────────────────────────────────────────────────────
function startFlashcardSetup() {
  navigate("flashcard-setup");
}

function renderFlashcardSetup(app) {
  const fc = state.flashcard;
  app.innerHTML = `
    <div class="setup">
      <div class="topbar">
        <button class="back-btn" onclick="navigate('home')">←</button>
        <h2>Karteikarten</h2>
      </div>

      <div class="setup-body">
        <div class="setup-section">
          <p class="section-label">Lernrichtung</p>
          <div class="radio-group">
            <label class="radio-label ${fc.mode === "de2bot" ? "active" : ""}">
              <input type="radio" name="mode" value="de2bot" ${fc.mode === "de2bot" ? "checked" : ""} onchange="setMode('de2bot')" />
              Deutsch → Botanisch
            </label>
            <label class="radio-label ${fc.mode === "bot2de" ? "active" : ""}">
              <input type="radio" name="mode" value="bot2de" ${fc.mode === "bot2de" ? "checked" : ""} onchange="setMode('bot2de')" />
              Botanisch → Deutsch
            </label>
          </div>
        </div>

        <div class="setup-section">
          <p class="section-label">Kategorie</p>
          <div class="filter-row">
            <button class="tag-btn ${!fc.filterCategory ? "active" : ""}" onclick="setFCCategory(null)">Alle</button>
            ${CATEGORIES.map(
              (cat) => `
              <button class="tag-btn ${fc.filterCategory === cat ? "active" : ""}" onclick="setFCCategory('${cat}')">
                ${cat}
              </button>`
            ).join("")}
          </div>
        </div>

        <div class="setup-section">
          <label class="checkbox-label">
            <input type="checkbox" ${fc.filterOnlyZ ? "checked" : ""} onchange="setFCOnlyZ(this.checked)" />
            Nur Zwischenprüfungs-Pflanzen
          </label>
        </div>

        <div class="setup-section">
          <p class="section-label">Welche Karten?</p>
          <div class="radio-group">
            <label class="radio-label ${fc.filterStatus === "all" || !fc.filterStatus ? "active" : ""}">
              <input type="radio" name="fstatus" value="all" ${!fc.filterStatus || fc.filterStatus === "all" ? "checked" : ""} onchange="setFCStatus('all')" />
              Alle Pflanzen
            </label>
            <label class="radio-label ${fc.filterStatus === "learning" ? "active" : ""}">
              <input type="radio" name="fstatus" value="learning" ${fc.filterStatus === "learning" ? "checked" : ""} onchange="setFCStatus('learning')" />
              Nur „Üben"
            </label>
            <label class="radio-label ${fc.filterStatus === "new" ? "active" : ""}">
              <input type="radio" name="fstatus" value="new" ${fc.filterStatus === "new" ? "checked" : ""} onchange="setFCStatus('new')" />
              Nur neue (noch nicht bewertet)
            </label>
          </div>
        </div>

        <button class="start-btn" onclick="startFlashcards()">
          Lernen starten
        </button>
      </div>
    </div>
  `;
}

function setMode(m) {
  state.flashcard.mode = m;
  renderFlashcardSetup(document.getElementById("app"));
}
function setFCCategory(cat) {
  state.flashcard.filterCategory = cat;
  renderFlashcardSetup(document.getElementById("app"));
}
function setFCOnlyZ(v) {
  state.flashcard.filterOnlyZ = v;
  renderFlashcardSetup(document.getElementById("app"));
}
function setFCStatus(v) {
  state.flashcard.filterStatus = v;
  renderFlashcardSetup(document.getElementById("app"));
}

function startFlashcards() {
  const fc = state.flashcard;
  const prog = loadProgress();
  let plants = filterPlants({
    category: fc.filterCategory,
    onlyZ: fc.filterOnlyZ,
  });

  if (fc.filterStatus === "learning") {
    plants = plants.filter((p) => prog[p.id]?.status === "learning");
  } else if (fc.filterStatus === "new") {
    plants = plants.filter((p) => !prog[p.id]);
  }

  if (plants.length === 0) {
    alert("Keine Pflanzen für diese Auswahl gefunden.");
    return;
  }

  // Shuffle
  const queue = [...plants].sort(() => Math.random() - 0.5);
  state.flashcard.queue = queue;
  state.flashcard.currentIndex = 0;
  state.flashcard.revealed = false;
  state.flashcard.userInput = "";
  navigate("flashcard");
}

// ─── Flashcard ───────────────────────────────────────────────────────────────
function renderFlashcard(app) {
  const fc = state.flashcard;
  const { queue, currentIndex, revealed, mode } = fc;

  if (!queue.length) {
    navigate("flashcard-setup");
    return;
  }

  const plant = queue[currentIndex];
  const total = queue.length;
  const status = getPlantStatus(plant.id);

  const questionLabel = mode === "de2bot" ? "Wie lautet der botanische Name?" : "Wie lautet der deutsche Name?";
  const questionValue = mode === "de2bot" ? plant.germanName : plant.botanicalName;
  const answerValue = mode === "de2bot" ? plant.botanicalName : plant.germanName;

  app.innerHTML = `
    <div class="flashcard-view">
      <div class="topbar">
        <button class="back-btn" onclick="navigate('flashcard-setup')">←</button>
        <span class="fc-counter">${currentIndex + 1} / ${total}</span>
        <span></span>
      </div>

      <div class="fc-progress-track">
        <div class="fc-progress-fill" style="width:${Math.round(((currentIndex) / total) * 100)}%"></div>
      </div>

      <div class="fc-card ${revealed ? "revealed" : ""}">
        <div class="fc-question-label">${questionLabel}</div>
        <div class="fc-question-value">${escHtml(questionValue)}</div>

        ${!revealed ? `
          <div class="fc-input-wrap">
            <input
              id="fc-input"
              type="text"
              placeholder="Antwort eingeben…"
              value="${escHtml(fc.userInput)}"
              oninput="state.flashcard.userInput = this.value"
              onkeydown="if(event.key==='Enter') revealCard()"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
            />
            <button class="reveal-btn" onclick="revealCard()">Auflösen</button>
          </div>
        ` : `
          <div class="fc-answer">
            <div class="fc-answer-label">Richtige Antwort:</div>
            <div class="fc-answer-value">${escHtml(answerValue)}</div>
            ${fc.userInput.trim() ? `
              <div class="fc-your-answer">
                <span class="fc-your-label">Deine Antwort:</span>
                <span class="fc-your-value">${escHtml(fc.userInput)}</span>
              </div>
            ` : ""}
          </div>

          <div class="fc-image-wrap" id="fc-img-wrap">
            <div class="img-placeholder">🌱</div>
          </div>

          <div class="fc-desc">${escHtml(plant.description)}</div>

          <div class="fc-actions">
            <p class="section-label">Wie war's?</p>
            <div class="fc-action-row">
              <button class="fc-btn fc-btn-known" onclick="fcNext('known')">✓ Kann ich</button>
              <button class="fc-btn fc-btn-learning" onclick="fcNext('learning')">↺ Nochmal</button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;

  if (!revealed) {
    const input = document.getElementById("fc-input");
    if (input) setTimeout(() => input.focus(), 100);
  } else {
    // Load image
    (async () => {
      const url = await fetchPlantImage(plant);
      const wrap = document.getElementById("fc-img-wrap");
      if (!wrap || !url) return;
      wrap.innerHTML = `<img src="${url}" alt="${escHtml(plant.germanName)}" />`;
    })();
  }
}

function revealCard() {
  state.flashcard.revealed = true;
  renderFlashcard(document.getElementById("app"));
}

function fcNext(status) {
  const fc = state.flashcard;
  markPlant(fc.queue[fc.currentIndex].id, status);
  fc.currentIndex++;
  fc.revealed = false;
  fc.userInput = "";

  if (fc.currentIndex >= fc.queue.length) {
    renderFlashcardDone(document.getElementById("app"));
  } else {
    renderFlashcard(document.getElementById("app"));
  }
}

function renderFlashcardDone(app) {
  const prog = loadProgress();
  const known = Object.values(prog).filter((v) => v.status === "known").length;
  const total = PLANTS.length;

  app.innerHTML = `
    <div class="fc-done">
      <div class="fc-done-icon">🎉</div>
      <h2>Runde abgeschlossen!</h2>
      <p>${known} von ${total} Pflanzen gelernt</p>
      <div class="fc-done-buttons">
        <button class="start-btn" onclick="startFlashcards()">Nochmal</button>
        <button class="outline-btn" onclick="navigate('flashcard-setup')">Einstellungen</button>
        <button class="outline-btn" onclick="navigate('home')">Startseite</button>
      </div>
    </div>
  `;
}

// ─── Progress ────────────────────────────────────────────────────────────────
function renderProgress(app) {
  const prog = loadProgress();
  const total = PLANTS.length;
  const known = PLANTS.filter((p) => prog[p.id]?.status === "known");
  const learning = PLANTS.filter((p) => prog[p.id]?.status === "learning");
  const newPlants = PLANTS.filter((p) => !prog[p.id]);

  const knownPct = Math.round((known.length / total) * 100);

  app.innerHTML = `
    <div class="progress-view">
      <div class="topbar">
        <button class="back-btn" onclick="navigate('home')">←</button>
        <h2>Fortschritt</h2>
        <button class="reset-link" onclick="resetProgress()">Reset</button>
      </div>

      <div class="prog-summary">
        <div class="prog-circle-wrap">
          <svg class="prog-circle" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" stroke-width="10"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#4ade80" stroke-width="10"
              stroke-dasharray="${2 * Math.PI * 40}"
              stroke-dashoffset="${2 * Math.PI * 40 * (1 - knownPct / 100)}"
              stroke-linecap="round"
              transform="rotate(-90 50 50)"
            />
            <text x="50" y="55" text-anchor="middle" class="prog-pct-text">${knownPct}%</text>
          </svg>
        </div>
        <div class="prog-stats">
          <div class="stat-row"><span class="dot dot-known"></span> Gelernt: <strong>${known.length}</strong></div>
          <div class="stat-row"><span class="dot dot-learning"></span> In Übung: <strong>${learning.length}</strong></div>
          <div class="stat-row"><span class="dot dot-new"></span> Neu: <strong>${newPlants.length}</strong></div>
          <div class="stat-row total">Gesamt: <strong>${total}</strong></div>
        </div>
      </div>

      ${CATEGORIES.map((cat) => {
        const catPlants = PLANTS.filter((p) => p.category === cat);
        const catKnown = catPlants.filter((p) => prog[p.id]?.status === "known").length;
        const catLearning = catPlants.filter((p) => prog[p.id]?.status === "learning").length;
        const pct = Math.round((catKnown / catPlants.length) * 100);
        return `
          <div class="cat-progress">
            <div class="cat-progress-header">
              <span class="cat-name">${cat}</span>
              <span class="cat-nums">${catKnown}/${catPlants.length}</span>
            </div>
            <div class="cat-bar-track">
              <div class="cat-bar-learning" style="width:${Math.round(((catKnown + catLearning) / catPlants.length) * 100)}%"></div>
              <div class="cat-bar-known" style="width:${pct}%"></div>
            </div>
          </div>
        `;
      }).join("")}

      ${known.length > 0 ? `
        <div class="prog-section">
          <p class="section-label">✓ Gelernt (${known.length})</p>
          <div class="prog-plant-list">
            ${known.map((p) => `
              <div class="prog-plant-row" onclick="openPlantDetail('${p.id}')">
                <span class="prog-plant-name">${escHtml(p.germanName)}</span>
                <span class="prog-plant-bot">${escHtml(p.botanicalName)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${learning.length > 0 ? `
        <div class="prog-section">
          <p class="section-label">↺ In Übung (${learning.length})</p>
          <div class="prog-plant-list">
            ${learning.map((p) => `
              <div class="prog-plant-row" onclick="openPlantDetail('${p.id}')">
                <span class="prog-plant-name">${escHtml(p.germanName)}</span>
                <span class="prog-plant-bot">${escHtml(p.botanicalName)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function resetProgress() {
  if (!confirm("Wirklich den gesamten Fortschritt zurücksetzen?")) return;
  localStorage.removeItem(PROGRESS_KEY);
  navigate("progress");
}

// ─── Catalog helpers ──────────────────────────────────────────────────────────
function setCatalogCategory(cat) {
  state.catalogFilter.category = cat;
  state.catalogFilter.onlyZ = false;
  navigate("catalog");
}

function setCatalogFilter(cat, onlyZ) {
  state.catalogFilter.category = cat;
  state.catalogFilter.onlyZ = onlyZ;
  navigate("catalog");
}

function setCatalogOnlyZ(v) {
  state.catalogFilter.onlyZ = v;
  if (v) state.catalogFilter.category = null;
  navigate("catalog");
}

function updateCatalogSearch(val) {
  state.catalogFilter.searchTerm = val;
  renderCatalog(document.getElementById("app"));
}

function openPlantDetail(id) {
  state.detailId = id;
  navigate("plant-detail");
}

// ─── Utils ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusBadge(status) {
  if (status === "known") return '<span class="badge badge-known">✓</span>';
  if (status === "learning") return '<span class="badge badge-learning">↺</span>';
  return "";
}

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  render();
});
