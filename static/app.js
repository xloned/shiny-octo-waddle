const API_BASE = "/api";

const gridsList = document.getElementById("grids-list");
const peopleList = document.getElementById("people-list");
const emptyState = document.getElementById("empty-state");
const peopleTitle = document.getElementById("people-title");
const peopleSubtitle = document.getElementById("people-subtitle");
const userBadge = document.getElementById("user-badge");
const devBanner = document.getElementById("dev-banner");
const devInput = document.getElementById("dev-tg-id");
const devContinue = document.getElementById("dev-continue");

let tgId = null;
let grids = [];
let people = [];
let currentGridId = null;

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
  if (currentGridId && !grids.find((grid) => grid.id === currentGridId)) {
    currentGridId = null;
  }
  if (!currentGridId && grids.length) {
    currentGridId = grids[0].id;
  }
  renderGrids();
  updatePeopleHeader();
}

async function loadPeople() {
  if (!currentGridId) {
    people = [];
    renderPeople();
    return;
  }
  people = await fetchJson(
    `${API_BASE}/people?tg_id=${tgId}&grid_id=${currentGridId}`
  );
  renderPeople();
}

function renderGrids() {
  gridsList.innerHTML = "";
  if (!grids.length) {
    gridsList.innerHTML = "<p class=\"muted\">No grids yet.</p>";
    emptyState.classList.remove("hidden");
    return;
  }

  grids.forEach((grid) => {
    const card = document.createElement("div");
    card.className = "grid-card";
    if (grid.id === currentGridId) {
      card.classList.add("active");
    }
    card.innerHTML = `
      <div class="grid-card-header">
        <div class="grid-color" style="background:${grid.color}"></div>
        <div>
          <div class="grid-title">${escapeHTML(grid.title)}</div>
          <div class="grid-meta">${grid.people_count} people</div>
        </div>
      </div>
      <div class="grid-actions">
        <button class="ghost danger" data-action="delete">Delete</button>
      </div>
    `;
    card.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (action === "delete") {
        event.stopPropagation();
        deleteGrid(grid.id);
        return;
      }
      selectGrid(grid.id);
    });
    gridsList.appendChild(card);
  });
}

function renderPeople() {
  peopleList.innerHTML = "";
  if (!currentGridId) {
    emptyState.classList.remove("hidden");
    updatePeopleHeader();
    return;
  }
  emptyState.classList.add("hidden");

  if (!people.length) {
    peopleList.innerHTML = "<p class=\"muted\">No people yet.</p>";
    return;
  }

  people.forEach((person) => {
    const card = document.createElement("div");
    card.className = "person-card";

    const fields = person.fields || {};
    const fieldItems = Object.keys(fields)
      .map(
        (key) =>
          `<div>${escapeHTML(key)}: ${escapeHTML(String(fields[key]))}</div>`
      )
      .join("");

    card.innerHTML = `
      <div class="person-name">${escapeHTML(person.full_name)}</div>
      <div class="field-list">${fieldItems || "No extra fields"}</div>
      <div class="person-actions">
        <button class="ghost danger" data-action="delete">Delete</button>
      </div>
    `;

    card.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (action === "delete") {
        event.stopPropagation();
        deletePerson(person.id);
      }
    });

    peopleList.appendChild(card);
  });
}

function selectGrid(gridId) {
  currentGridId = gridId;
  updatePeopleHeader();
  loadPeople();
  renderGrids();
}

function updatePeopleHeader() {
  const selectedGrid = grids.find((grid) => grid.id === currentGridId);
  if (selectedGrid) {
    peopleTitle.textContent = selectedGrid.title;
    peopleSubtitle.textContent =
      selectedGrid.description || "People in this grid";
  } else {
    peopleTitle.textContent = "People";
    peopleSubtitle.textContent = "Pick a grid to see who is inside.";
  }
}

async function deleteGrid(gridId) {
  if (!confirm("Delete this grid? People will be unassigned.")) {
    return;
  }
  try {
    await fetchJson(`${API_BASE}/grids/${gridId}?tg_id=${tgId}`, {
      method: "DELETE",
    });
    if (currentGridId === gridId) {
      currentGridId = null;
    }
    await loadGrids();
    await loadPeople();
  } catch (error) {
    alert(error.message);
  }
}

async function deletePerson(personId) {
  if (!confirm("Delete this person?")) {
    return;
  }
  try {
    await fetchJson(`${API_BASE}/people/${personId}?tg_id=${tgId}`, {
      method: "DELETE",
    });
    await loadGrids();
    await loadPeople();
  } catch (error) {
    alert(error.message);
  }
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
      await loadGrids();
      await loadPeople();
    };
  } else {
    setBadge();
    await loadGrids();
    await loadPeople();
  }
}

initialize();
