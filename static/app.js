const API_BASE = "/api";

const map = document.getElementById("map");
const mapLines = document.getElementById("map-lines");
const mapNodes = document.getElementById("map-nodes");
const mapEmpty = document.getElementById("map-empty");

const userBadge = document.getElementById("user-badge");
const devBanner = document.getElementById("dev-banner");
const devInput = document.getElementById("dev-tg-id");
const devContinue = document.getElementById("dev-continue");

const fab = document.getElementById("fab");
const fabMenu = document.getElementById("fab-menu");
const addGridBtn = document.getElementById("add-grid-btn");
const addPersonBtn = document.getElementById("add-person-btn");

const sheet = document.getElementById("sheet");
const sheetBackdrop = document.getElementById("sheet-backdrop");
const sheetTitle = document.getElementById("sheet-title");
const sheetForm = document.getElementById("sheet-form");
const sheetClose = document.getElementById("sheet-close");

let tgId = null;
let grids = [];
let people = [];

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

function escapeHTML(value) {
  const text = String(value ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setBadge() {
  if (!tgId) {
    userBadge.classList.add("hidden");
    return;
  }
  userBadge.textContent = `User ${tgId}`;
  userBadge.classList.remove("hidden");
}

function getTgId() {
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    return tg.initDataUnsafe.user.id;
  }
  const params = new URLSearchParams(window.location.search);
  const value = params.get("tg_id");
  if (value) {
    return Number(value);
  }
  return null;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Request failed");
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function loadGrids() {
  grids = await fetchJson(`${API_BASE}/grids?tg_id=${tgId}`);
}

async function loadPeople() {
  people = await fetchJson(`${API_BASE}/people?tg_id=${tgId}`);
}

async function refreshData() {
  await loadGrids();
  await loadPeople();
  renderMap();
}

function polarPoint(center, radius, angle) {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function shortLabel(text, limit = 8) {
  const safe = String(text || "").trim();
  if (safe.length <= limit) {
    return safe;
  }
  return `${safe.slice(0, limit - 1)}...`;
}

function drawLine(from, to, className) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", from.x);
  line.setAttribute("y1", from.y);
  line.setAttribute("x2", to.x);
  line.setAttribute("y2", to.y);
  if (className) {
    className
      .split(" ")
      .filter(Boolean)
      .forEach((name) => line.classList.add(name));
  }
  mapLines.appendChild(line);
}

function createNode({ type, x, y, label, subtitle, color, emoji, title }) {
  const node = document.createElement("div");
  node.className = `node ${type}`;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  if (color) {
    node.style.background = color;
  }
  if (title) {
    node.title = title;
  }

  if (type === "person") {
    node.textContent = emoji || "🙂";
    return node;
  }

  const titleEl = document.createElement("div");
  titleEl.className = "node-title";
  titleEl.textContent = label;
  node.appendChild(titleEl);

  if (subtitle) {
    const subEl = document.createElement("div");
    subEl.className = "node-sub";
    subEl.textContent = subtitle;
    node.appendChild(subEl);
  }

  return node;
}

function placePeopleRing(group, anchor, radius, options = {}) {
  if (!group.length) {
    return;
  }
  const startAngle = -Math.PI / 2;
  const count = group.length;
  group.forEach((person, index) => {
    const angle = startAngle + (index / count) * Math.PI * 2;
    const point = polarPoint(anchor, radius, angle);
    drawLine(anchor, point, options.lineClass || "line-person");
    const emoji = person.fields && person.fields.emoji ? person.fields.emoji : "🙂";
    const node = createNode({
      type: "person",
      x: point.x,
      y: point.y,
      emoji,
      title: person.full_name,
    });
    mapNodes.appendChild(node);
  });
}

function renderMap() {
  if (!map) {
    return;
  }
  const rect = map.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  if (!width || !height) {
    return;
  }

  mapLines.setAttribute("viewBox", `0 0 ${width} ${height}`);
  mapLines.setAttribute("width", width);
  mapLines.setAttribute("height", height);
  mapLines.innerHTML = "";
  mapNodes.innerHTML = "";

  const center = { x: width / 2, y: height / 2 };
  const userNode = createNode({
    type: "user",
    x: center.x,
    y: center.y,
    label: "USER",
    subtitle: tgId ? `#${String(tgId).slice(-4)}` : "",
    title: tgId ? `User ${tgId}` : "You",
  });
  mapNodes.appendChild(userNode);

  if (!grids.length && !people.length) {
    mapEmpty.classList.remove("hidden");
  } else {
    mapEmpty.classList.add("hidden");
  }

  const peopleByGrid = new Map();
  const unassigned = [];
  people.forEach((person) => {
    if (person.grid_id) {
      if (!peopleByGrid.has(person.grid_id)) {
        peopleByGrid.set(person.grid_id, []);
      }
      peopleByGrid.get(person.grid_id).push(person);
    } else {
      unassigned.push(person);
    }
  });

  placePeopleRing(unassigned, center, Math.min(width, height) * 0.16, {
    lineClass: "line-person line-dashed",
  });

  const gridCount = grids.length;
  const gridRadius = Math.min(width, height) * 0.28;
  const startAngle = -Math.PI / 2;

  grids.forEach((grid, index) => {
    const angle = gridCount ? startAngle + (index / gridCount) * Math.PI * 2 : 0;
    const point = polarPoint(center, gridRadius, angle);
    drawLine(center, point, "line-grid");

    const gridNode = createNode({
      type: "grid",
      x: point.x,
      y: point.y,
      label: shortLabel(grid.title),
      subtitle: `${grid.people_count} people`,
      color: grid.color || "#f07a2a",
      title: grid.title,
    });
    mapNodes.appendChild(gridNode);

    const group = peopleByGrid.get(grid.id) || [];
    if (group.length) {
      const ring = clamp(54 + group.length * 6, 58, 120);
      placePeopleRing(group, point, ring, { lineClass: "line-person" });
    }
  });
}

function setFabOpen(open) {
  if (open) {
    fabMenu.classList.remove("hidden");
    fab.classList.add("is-open");
  } else {
    fabMenu.classList.add("hidden");
    fab.classList.remove("is-open");
  }
}

function closeSheet() {
  sheet.classList.add("hidden");
  sheetBackdrop.classList.add("hidden");
  sheetForm.innerHTML = "";
}

function openSheet(type) {
  sheetTitle.textContent = type === "grid" ? "New grid" : "New person";
  if (type === "grid") {
    sheetForm.innerHTML = `
      <label>
        Title
        <input name="title" required placeholder="Gym" />
      </label>
      <label>
        Description
        <input name="description" placeholder="Friends from the gym" />
      </label>
      <label>
        Color
        <input name="color" type="color" value="#f07a2a" />
      </label>
      <div class="sheet-actions">
        <button type="button" class="ghost" id="sheet-cancel">Cancel</button>
        <button type="submit" class="primary">Create grid</button>
      </div>
    `;
  } else {
    const options = [
      `<option value="">Unassigned</option>`,
      ...grids.map((grid) => `<option value="${grid.id}">${escapeHTML(grid.title)}</option>`),
    ].join("");

    sheetForm.innerHTML = `
      <label>
        Full name
        <input name="full_name" required placeholder="New friend" />
      </label>
      <label>
        Emoji
        <input name="emoji" placeholder="🙂" maxlength="2" />
      </label>
      <label>
        Grid
        <select name="grid_id">${options}</select>
      </label>
      <div class="sheet-actions">
        <button type="button" class="ghost" id="sheet-cancel">Cancel</button>
        <button type="submit" class="primary">Add person</button>
      </div>
    `;
  }

  sheetForm.onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(sheetForm);

    try {
      if (type === "grid") {
        const payload = {
          tg_id: tgId,
          title: formData.get("title"),
          description: formData.get("description"),
          color: formData.get("color"),
        };
        await fetchJson(`${API_BASE}/grids`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        const emojiInput = String(formData.get("emoji") || "").trim();
        const gridValue = formData.get("grid_id");
        const payload = {
          tg_id: tgId,
          full_name: formData.get("full_name"),
          fields: {
            emoji: emojiInput || "🙂",
          },
          grid_id: gridValue ? Number(gridValue) : null,
        };
        await fetchJson(`${API_BASE}/people`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      closeSheet();
      await refreshData();
    } catch (error) {
      alert(error.message);
    }
  };

  const cancelBtn = sheetForm.querySelector("#sheet-cancel");
  if (cancelBtn) {
    cancelBtn.onclick = closeSheet;
  }

  sheet.classList.remove("hidden");
  sheetBackdrop.classList.remove("hidden");
}

async function initialize() {
  if (tg) {
    tg.ready();
    tg.expand();
  }
  tgId = getTgId();
  if (!tgId) {
    devBanner.classList.remove("hidden");
    devContinue.onclick = async () => {
      const value = Number(devInput.value);
      if (!value) {
        alert("Enter a valid Telegram user id.");
        return;
      }
      tgId = value;
      devBanner.classList.add("hidden");
      setBadge();
      await refreshData();
    };
  } else {
    setBadge();
    await refreshData();
  }
}

fab.addEventListener("click", (event) => {
  event.stopPropagation();
  const isOpen = !fabMenu.classList.contains("hidden");
  setFabOpen(!isOpen);
});

fabMenu.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", () => {
  setFabOpen(false);
});

addGridBtn.addEventListener("click", () => {
  setFabOpen(false);
  openSheet("grid");
});

addPersonBtn.addEventListener("click", () => {
  setFabOpen(false);
  openSheet("person");
});

sheetClose.addEventListener("click", closeSheet);

sheetBackdrop.addEventListener("click", closeSheet);

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderMap, 120);
});

initialize();
