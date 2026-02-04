const API_BASE = "/api";
const MAX_CUSTOM_FIELDS = 20;

const map = document.getElementById("map");
const mapViewport = document.getElementById("map-viewport");
const mapLines = document.getElementById("map-lines");
const mapNodes = document.getElementById("map-nodes");

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

let canvas = { width: 0, height: 0 };
let pan = { x: 0, y: 0 };
let hasPan = false;
let positions = {};
let nodePositions = new Map();
let nodeElements = new Map();

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

function parseNodeKey(key) {
  const parts = key.split("-");
  if (parts.length !== 2) {
    return null;
  }
  const nodeType = parts[0];
  const nodeId = Number(parts[1]);
  if (!Number.isFinite(nodeId)) {
    return null;
  }
  if (nodeType !== "grid" && nodeType !== "person") {
    return null;
  }
  return { node_type: nodeType, node_id: nodeId };
}

function cleanupPositions() {
  const validKeys = new Set();
  grids.forEach((grid) => validKeys.add(`grid-${grid.id}`));
  people.forEach((person) => validKeys.add(`person-${person.id}`));
  Object.keys(positions).forEach((key) => {
    if (!validKeys.has(key)) {
      delete positions[key];
    }
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setCanvasSize() {
  if (!map) {
    return;
  }
  const rect = map.getBoundingClientRect();
  const scale = 1.6;
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  mapViewport.style.width = `${canvas.width}px`;
  mapViewport.style.height = `${canvas.height}px`;
  mapLines.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
  mapLines.setAttribute("width", canvas.width);
  mapLines.setAttribute("height", canvas.height);

  if (!hasPan) {
    pan.x = (rect.width - canvas.width) / 2;
    pan.y = (rect.height - canvas.height) / 2;
    hasPan = true;
  }
  applyPan();
}

function clampPan(x, y) {
  const rect = map.getBoundingClientRect();
  const margin = Math.min(rect.width, rect.height) * 0.15;
  const minX = rect.width - canvas.width - margin;
  const maxX = margin;
  const minY = rect.height - canvas.height - margin;
  const maxY = margin;
  return {
    x: clamp(x, minX, maxX),
    y: clamp(y, minY, maxY),
  };
}

function applyPan() {
  const clamped = clampPan(pan.x, pan.y);
  pan = clamped;
  mapViewport.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
}

function getCanvasPoint(clientX, clientY) {
  const rect = map.getBoundingClientRect();
  return {
    x: clientX - rect.left - pan.x,
    y: clientY - rect.top - pan.y,
  };
}

function polarPoint(center, radius, angle) {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

function shortLabel(text, limit = 8) {
  const safe = String(text || "").trim();
  if (safe.length <= limit) {
    return safe;
  }
  return `${safe.slice(0, limit - 1)}...`;
}

function buildCustomFieldRow(field = {}) {
  const row = document.createElement("div");
  row.className = "field-row";
  row.innerHTML = `
    <input class="field-label" type="text" placeholder="Field name" maxlength="40" />
    <input class="field-value" type="text" placeholder="Value" maxlength="80" />
    <button type="button" class="icon-button field-remove" aria-label="Remove field">x</button>
  `;
  const labelInput = row.querySelector(".field-label");
  const valueInput = row.querySelector(".field-value");
  if (labelInput && field.label) {
    labelInput.value = field.label;
  }
  if (valueInput && field.value) {
    valueInput.value = field.value;
  }
  return row;
}

function collectCustomFields(container) {
  if (!container) {
    return [];
  }
  const rows = Array.from(container.querySelectorAll(".field-row"));
  const fields = rows
    .map((row) => {
      const label = row.querySelector(".field-label")?.value.trim();
      const value = row.querySelector(".field-value")?.value.trim() || "";
      if (!label) {
        return null;
      }
      return { label, value };
    })
    .filter(Boolean);
  return fields.slice(0, MAX_CUSTOM_FIELDS);
}

function setupCustomFields(container, countEl, addBtn, initialFields = []) {
  if (!container) {
    return () => [];
  }

  const updateState = () => {
    const count = container.querySelectorAll(".field-row").length;
    if (countEl) {
      countEl.textContent = `${count}/${MAX_CUSTOM_FIELDS}`;
    }
    if (addBtn) {
      addBtn.disabled = count >= MAX_CUSTOM_FIELDS;
    }
  };

  const addRow = (field = {}) => {
    const count = container.querySelectorAll(".field-row").length;
    if (count >= MAX_CUSTOM_FIELDS) {
      return;
    }
    const row = buildCustomFieldRow(field);
    const removeBtn = row.querySelector(".field-remove");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        row.remove();
        updateState();
      });
    }
    container.appendChild(row);
    updateState();
  };

  if (Array.isArray(initialFields)) {
    initialFields.slice(0, MAX_CUSTOM_FIELDS).forEach((field) => {
      addRow(field);
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", () => addRow());
  }

  updateState();
  return () => collectCustomFields(container);
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

function getStoredPosition(key) {
  const stored = positions[key];
  if (!stored || typeof stored.x !== "number" || typeof stored.y !== "number") {
    return null;
  }
  return {
    x: stored.x * canvas.width,
    y: stored.y * canvas.height,
  };
}

function updateStoredPosition(key, pos) {
  positions[key] = {
    x: pos.x / canvas.width,
    y: pos.y / canvas.height,
  };
  savePosition(key);
}

function getNodeRadius(key) {
  if (key.startsWith("grid-")) {
    return 44;
  }
  if (key.startsWith("person-")) {
    return 20;
  }
  return 72;
}

function clampNodePosition(key, pos) {
  const radius = getNodeRadius(key);
  return {
    x: clamp(pos.x, radius, canvas.width - radius),
    y: clamp(pos.y, radius, canvas.height - radius),
  };
}

function setNodePosition(key, pos) {
  const clamped = clampNodePosition(key, pos);
  nodePositions.set(key, clamped);
  const node = nodeElements.get(key);
  if (node) {
    node.style.left = `${clamped.x}px`;
    node.style.top = `${clamped.y}px`;
  }
}

function createNode({ key, type, x, y, label, subtitle, color, emoji, title }) {
  const node = document.createElement("div");
  node.className = `node ${type}`;
  const initial = clampNodePosition(key, { x, y });
  node.style.left = `${initial.x}px`;
  node.style.top = `${initial.y}px`;
  if (color) {
    node.style.background = color;
  }
  if (title) {
    node.title = title;
  }

  if (type === "person") {
    node.textContent = emoji || "🙂";
  } else {
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
  }

  mapNodes.appendChild(node);
  nodeElements.set(key, node);
  nodePositions.set(key, { x: initial.x, y: initial.y });

  if (type !== "user") {
    attachLongPressDrag(node, key);
  }
}

function renderLines() {
  mapLines.innerHTML = "";
  const userPos = nodePositions.get("user");
  if (!userPos) {
    return;
  }

  grids.forEach((grid) => {
    const gridPos = nodePositions.get(`grid-${grid.id}`);
    if (gridPos) {
      drawLine(userPos, gridPos, "line-grid");
    }
  });

  people.forEach((person) => {
    const personPos = nodePositions.get(`person-${person.id}`);
    if (!personPos) {
      return;
    }
    const anchor = person.grid_id
      ? nodePositions.get(`grid-${person.grid_id}`)
      : userPos;
    if (!anchor) {
      return;
    }
    drawLine(
      anchor,
      personPos,
      person.grid_id ? "line-person" : "line-person line-dashed"
    );
  });
}

function renderMap() {
  if (!map) {
    return;
  }
  setCanvasSize();
  nodePositions.clear();
  nodeElements.clear();
  mapNodes.innerHTML = "";
  mapLines.innerHTML = "";

  const center = { x: canvas.width / 2, y: canvas.height / 2 };
  createNode({
    key: "user",
    type: "user",
    x: center.x,
    y: center.y,
    label: "USER",
    subtitle: tgId ? `#${String(tgId).slice(-4)}` : "",
    title: tgId ? `User ${tgId}` : "You",
  });

  const gridCount = grids.length;
  const gridRadius = Math.min(canvas.width, canvas.height) * 0.28;
  const startAngle = -Math.PI / 2;

  grids.forEach((grid, index) => {
    const angle = gridCount ? startAngle + (index / gridCount) * Math.PI * 2 : 0;
    const fallback = polarPoint(center, gridRadius, angle);
    const stored = getStoredPosition(`grid-${grid.id}`);
    const pos = stored || fallback;
    createNode({
      key: `grid-${grid.id}`,
      type: "grid",
      x: pos.x,
      y: pos.y,
      label: shortLabel(grid.title),
      subtitle: `${grid.people_count} people`,
      color: grid.color || "#f07a2a",
      title: grid.title,
    });
  });

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

  const unassignedRadius = Math.min(canvas.width, canvas.height) * 0.18;
  unassigned.forEach((person, index) => {
    const count = unassigned.length || 1;
    const angle = startAngle + (index / count) * Math.PI * 2;
    const fallback = polarPoint(center, unassignedRadius, angle);
    const stored = getStoredPosition(`person-${person.id}`);
    const pos = stored || fallback;
    const emoji = person.fields && person.fields.emoji ? person.fields.emoji : "🙂";
    createNode({
      key: `person-${person.id}`,
      type: "person",
      x: pos.x,
      y: pos.y,
      emoji,
      title: person.full_name,
    });
  });

  grids.forEach((grid) => {
    const anchor = nodePositions.get(`grid-${grid.id}`);
    if (!anchor) {
      return;
    }
    const group = peopleByGrid.get(grid.id) || [];
    const ring = clamp(56 + group.length * 6, 60, 130);
    group.forEach((person, index) => {
      const count = group.length || 1;
      const angle = startAngle + (index / count) * Math.PI * 2;
      const fallback = polarPoint(anchor, ring, angle);
      const stored = getStoredPosition(`person-${person.id}`);
      const pos = stored || fallback;
      const emoji = person.fields && person.fields.emoji ? person.fields.emoji : "🙂";
      createNode({
        key: `person-${person.id}`,
        type: "person",
        x: pos.x,
        y: pos.y,
        emoji,
        title: person.full_name,
      });
    });
  });

  renderLines();
}

function attachLongPressDrag(node, key) {
  let pressTimer = null;
  let isDragging = false;
  let startPoint = null;
  let lastPoint = null;
  let offset = { x: 0, y: 0 };
  let pointerType = "mouse";

  const clearPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const stopDragging = () => {
    clearPress();
    if (isDragging) {
      isDragging = false;
      node.classList.remove("is-dragging");
      updateStoredPosition(key, nodePositions.get(key));
    }
    startPoint = null;
    lastPoint = null;
  };

  node.addEventListener("pointerdown", (event) => {
    if (event.button && event.button !== 0) {
      return;
    }
    event.stopPropagation();
    node.setPointerCapture(event.pointerId);
    pointerType = event.pointerType || "mouse";
    startPoint = { x: event.clientX, y: event.clientY };
    lastPoint = { ...startPoint };

    const startDrag = () => {
      isDragging = true;
      node.classList.add("is-dragging");
      const canvasPoint = getCanvasPoint(lastPoint.x, lastPoint.y);
      const current = nodePositions.get(key) || canvasPoint;
      offset = {
        x: current.x - canvasPoint.x,
        y: current.y - canvasPoint.y,
      };
    };

    if (pointerType === "touch") {
      pressTimer = setTimeout(startDrag, 320);
    } else {
      startDrag();
    }
  });

  node.addEventListener("pointermove", (event) => {
    lastPoint = { x: event.clientX, y: event.clientY };

    if (!isDragging) {
      if (!startPoint) {
        return;
      }
      const dx = lastPoint.x - startPoint.x;
      const dy = lastPoint.y - startPoint.y;
      if (Math.hypot(dx, dy) > 8) {
        clearPress();
      }
      return;
    }

    const canvasPoint = getCanvasPoint(lastPoint.x, lastPoint.y);
    const nextPos = {
      x: canvasPoint.x + offset.x,
      y: canvasPoint.y + offset.y,
    };
    setNodePosition(key, nextPos);
    renderLines();
  });

  node.addEventListener("pointerup", stopDragging);
  node.addEventListener("pointercancel", stopDragging);
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

async function loadPositions() {
  if (!tgId) {
    positions = {};
    return;
  }
  try {
    const list = await fetchJson(`${API_BASE}/positions?tg_id=${tgId}`);
    positions = {};
    list.forEach((item) => {
      positions[`${item.node_type}-${item.node_id}`] = {
        x: item.x,
        y: item.y,
      };
    });
  } catch (error) {
    positions = {};
  }
}

async function savePosition(key) {
  if (!tgId) {
    return;
  }
  const parsed = parseNodeKey(key);
  const stored = positions[key];
  if (!parsed || !stored) {
    return;
  }
  try {
    await fetchJson(`${API_BASE}/positions`, {
      method: "POST",
      body: JSON.stringify({
        tg_id: tgId,
        node_type: parsed.node_type,
        node_id: parsed.node_id,
        x: stored.x,
        y: stored.y,
      }),
    });
  } catch (error) {
    // Ignore save errors for now
  }
}

async function loadGrids() {
  grids = await fetchJson(`${API_BASE}/grids?tg_id=${tgId}`);
}

async function loadPeople() {
  people = await fetchJson(`${API_BASE}/people?tg_id=${tgId}`);
}

async function refreshData() {
  await Promise.all([loadGrids(), loadPeople(), loadPositions()]);
  cleanupPositions();
  renderMap();
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
  let getCustomFields = () => [];
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
      ...grids.map(
        (grid) => `<option value="${grid.id}">${escapeHTML(grid.title)}</option>`
      ),
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
      <div class="field-group">
        <div class="field-header">
          <div class="field-title">
            <span>Custom fields</span>
            <span id="custom-fields-count" class="field-count">0/${MAX_CUSTOM_FIELDS}</span>
          </div>
          <button type="button" class="ghost compact" id="add-field">Add field</button>
        </div>
        <div id="custom-fields" class="field-list"></div>
        <p class="field-hint">
          Up to ${MAX_CUSTOM_FIELDS} fields like favorite color, job, or date of birth.
        </p>
      </div>
      <div class="sheet-actions">
        <button type="button" class="ghost" id="sheet-cancel">Cancel</button>
        <button type="submit" class="primary">Add person</button>
      </div>
    `;

    const fieldsContainer = sheetForm.querySelector("#custom-fields");
    const fieldsCount = sheetForm.querySelector("#custom-fields-count");
    const addFieldBtn = sheetForm.querySelector("#add-field");
    getCustomFields = setupCustomFields(fieldsContainer, fieldsCount, addFieldBtn);
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
        const customFields = getCustomFields();
        const fieldsPayload = {
          emoji: emojiInput || "🙂",
        };
        if (customFields.length) {
          fieldsPayload.custom_fields = customFields;
        }
        const payload = {
          tg_id: tgId,
          full_name: formData.get("full_name"),
          fields: fieldsPayload,
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
    if (typeof tg.disableVerticalSwipes === "function") {
      tg.disableVerticalSwipes();
    }
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
      await refreshData();
    };
  } else {
    await refreshData();
  }
}

const panState = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
};

map.addEventListener("pointerdown", (event) => {
  if (event.button && event.button !== 0) {
    return;
  }
  if (event.target.closest(".node")) {
    return;
  }
  panState.active = true;
  panState.pointerId = event.pointerId;
  panState.startX = event.clientX;
  panState.startY = event.clientY;
  panState.originX = pan.x;
  panState.originY = pan.y;
  map.setPointerCapture(event.pointerId);
});

map.addEventListener("pointermove", (event) => {
  if (!panState.active || event.pointerId !== panState.pointerId) {
    return;
  }
  const dx = event.clientX - panState.startX;
  const dy = event.clientY - panState.startY;
  pan.x = panState.originX + dx;
  pan.y = panState.originY + dy;
  applyPan();
});

map.addEventListener("pointerup", (event) => {
  if (event.pointerId === panState.pointerId) {
    panState.active = false;
  }
});

map.addEventListener("pointercancel", (event) => {
  if (event.pointerId === panState.pointerId) {
    panState.active = false;
  }
});

map.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

map.addEventListener(
  "touchmove",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

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

document.addEventListener(
  "gesturestart",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

document.addEventListener(
  "gesturechange",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

document.addEventListener(
  "gestureend",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

initialize();
