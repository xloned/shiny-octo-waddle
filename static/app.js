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

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
const modalForm = document.getElementById("modal-form");
const modalClose = document.getElementById("modal-close");

const newGridBtn = document.getElementById("new-grid-btn");
const newPersonBtn = document.getElementById("new-person-btn");

let tgId = null;
let grids = [];
let people = [];
let currentGridId = null;
let editingGridId = null;
let editingPersonId = null;

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
        <button class="secondary" data-action="edit">Edit</button>
        <button class="ghost danger" data-action="delete">Delete</button>
      </div>
    `;
    card.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (action === "edit") {
        event.stopPropagation();
        openGridModal(grid);
        return;
      }
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
        <button class="secondary" data-action="edit">Edit</button>
        <button class="ghost danger" data-action="delete">Delete</button>
      </div>
    `;

    card.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (action === "edit") {
        event.stopPropagation();
        openPersonModal(person);
        return;
      }
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

function openModal(title) {
  modalTitle.textContent = title;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  modalForm.innerHTML = "";
  editingGridId = null;
  editingPersonId = null;
}

function openGridModal(grid = null) {
  editingGridId = grid ? grid.id : null;
  modalForm.className = "modal-form";
  modalForm.innerHTML = `
    <label>
      Title
      <input name="title" required value="${grid ? escapeHTML(grid.title) : ""}" />
    </label>
    <label>
      Description
      <textarea name="description" rows="3">${grid && grid.description ? escapeHTML(grid.description) : ""}</textarea>
    </label>
    <label>
      Color
      <input name="color" type="color" value="${grid ? grid.color : "#2d6cdf"}" />
    </label>
    <div class="modal-actions">
      <button type="button" class="ghost" id="grid-cancel">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  `;

  modalForm.onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(modalForm);
    const payload = {
      tg_id: tgId,
      title: formData.get("title"),
      description: formData.get("description"),
      color: formData.get("color"),
    };
    try {
      if (editingGridId) {
        await fetchJson(
          `${API_BASE}/grids/${editingGridId}?tg_id=${tgId}`,
          {
            method: "PUT",
            body: JSON.stringify({
              title: payload.title,
              description: payload.description,
              color: payload.color,
            }),
          }
        );
      } else {
        await fetchJson(`${API_BASE}/grids`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      await loadGrids();
      closeModal();
    } catch (error) {
      alert(error.message);
    }
  };

  document.getElementById("grid-cancel").onclick = closeModal;
  openModal(grid ? "Edit grid" : "New grid");
}

function openPersonModal(person = null) {
  editingPersonId = person ? person.id : null;
  modalForm.className = "modal-form";
  const options = [
    `<option value="">Unassigned</option>`,
    ...grids.map(
      (grid) =>
        `<option value="${grid.id}">${escapeHTML(grid.title)}</option>`
    ),
  ].join("");

  modalForm.innerHTML = `
    <label>
      Full name
      <input name="full_name" required value="${person ? escapeHTML(person.full_name) : ""}" />
    </label>
    <label>
      Grid
      <select name="grid_id">${options}</select>
    </label>
    <div class="fields-block">
      <div class="fields-header">
        <span>Extra fields</span>
        <button type="button" id="add-field-btn" class="secondary">+ Field</button>
      </div>
      <div id="fields-container"></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost" id="person-cancel">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  `;

  const gridSelect = modalForm.querySelector("select[name='grid_id']");
  if (person && person.grid_id) {
    gridSelect.value = String(person.grid_id);
  } else if (currentGridId) {
    gridSelect.value = String(currentGridId);
  }

  const fieldsContainer = modalForm.querySelector("#fields-container");
  const addFieldBtn = modalForm.querySelector("#add-field-btn");

  function addFieldRow(key = "", value = "") {
    const row = document.createElement("div");
    row.className = "field-row";
    row.innerHTML = `
      <input class="field-key" placeholder="Label" value="${escapeHTML(key)}" />
      <input class="field-value" placeholder="Value" value="${escapeHTML(value)}" />
      <button type="button" class="ghost danger" data-action="remove">Remove</button>
    `;
    row.querySelector("[data-action='remove']").onclick = () => row.remove();
    fieldsContainer.appendChild(row);
  }

  if (person && person.fields && Object.keys(person.fields).length) {
    Object.entries(person.fields).forEach(([key, value]) => addFieldRow(key, String(value)));
  } else {
    addFieldRow();
  }

  addFieldBtn.onclick = () => addFieldRow();

  modalForm.onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(modalForm);
    const gridValue = formData.get("grid_id");
    const fields = {};
    fieldsContainer.querySelectorAll(".field-row").forEach((row) => {
      const key = row.querySelector(".field-key").value.trim();
      const value = row.querySelector(".field-value").value.trim();
      if (key) {
        fields[key] = value;
      }
    });

    const payload = {
      tg_id: tgId,
      full_name: formData.get("full_name"),
      fields,
      grid_id: gridValue ? Number(gridValue) : null,
    };

    try {
      if (editingPersonId) {
        await fetchJson(
          `${API_BASE}/people/${editingPersonId}?tg_id=${tgId}`,
          {
            method: "PUT",
            body: JSON.stringify({
              full_name: payload.full_name,
              fields: payload.fields,
              grid_id: payload.grid_id,
            }),
          }
        );
      } else {
        await fetchJson(`${API_BASE}/people`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      await loadGrids();
      await loadPeople();
      closeModal();
    } catch (error) {
      alert(error.message);
    }
  };

  document.getElementById("person-cancel").onclick = closeModal;
  openModal(person ? "Edit person" : "New person");
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

modalClose.onclick = closeModal;
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

newGridBtn.onclick = () => openGridModal();
newPersonBtn.onclick = () => openPersonModal();

initialize();
