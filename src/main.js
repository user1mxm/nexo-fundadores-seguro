const CANONICAL_RECIPIENT = "IVAN PUENTES";
const MAX_ATTEMPTS = 5;
const LOCK_MS = 30_000;

const app = document.querySelector("#app");

const enc = new TextEncoder();
const dec = new TextDecoder();

function normalizeName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(token, recipient) {
  const material = await crypto.subtle.importKey("raw", enc.encode(`${token}:${recipient}`), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("NEXO-ENTREGA-IVAN-v1"), iterations: 210_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPayload(jsonText) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(24));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const token = bytesToBase64Url(tokenBytes);
  const key = await deriveKey(token, CANONICAL_RECIPIENT);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(jsonText));
  return `v1.${token}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(cipher))}`;
}

async function decryptPayload(bundle, recipient) {
  const [version, token, ivValue, cipherValue] = bundle.split(".");
  if (version !== "v1" || !token || !ivValue || !cipherValue) throw new Error("Enlace inválido");
  const key = await deriveKey(token, recipient);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivValue) },
    key,
    base64UrlToBytes(cipherValue)
  );
  return dec.decode(plain);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toText(value, depth = 0) {
  if (value === null || value === undefined) return "Sin respuesta";
  if (Array.isArray(value)) return value.map((item) => toText(item, depth)).join(", ");
  if (typeof value !== "object") return String(value);
  return Object.entries(value)
    .map(([key, item]) => `${"  ".repeat(depth)}${key}: ${typeof item === "object" && item !== null ? `\n${toText(item, depth + 1)}` : toText(item, depth + 1)}`)
    .join("\n");
}

function toXml(value, tag = "nexo-export") {
  const safeTag = String(tag).replace(/[^a-zA-Z0-9_-]/g, "-") || "item";
  if (value === null || value === undefined) return `<${safeTag} />`;
  if (Array.isArray(value)) return `<${safeTag}>${value.map((item) => toXml(item, "item")).join("")}</${safeTag}>`;
  if (typeof value === "object") return `<${safeTag}>${Object.entries(value).map(([key, item]) => toXml(item, key)).join("")}</${safeTag}>`;
  return `<${safeTag}>${escapeXml(value)}</${safeTag}>`;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function card(content) {
  app.innerHTML = `<section class="shell"><div class="card">${content}</div><p class="footnote">NEXO · Documento privado · No reenviar el enlace</p></section>`;
}

function renderPrepare() {
  card(`
    <p class="kicker">Preparar entrega</p>
    <h1>Crea el enlace privado para Iván.</h1>
    <p class="lead">Selecciona la exportación JSON completa de Rafael. El archivo se cifra en este dispositivo y no se envía a ningún servidor.</p>
    <label class="drop" for="json-file">
      <span class="drop-icon">↥</span>
      <strong>Seleccionar exportación JSON</strong>
      <small>Archivo generado desde el panel administrativo de NEXO</small>
    </label>
    <input id="json-file" type="file" accept="application/json,.json" hidden />
    <div id="prepare-result" aria-live="polite"></div>
  `);

  document.querySelector("#json-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    const result = document.querySelector("#prepare-result");
    if (!file) return;
    result.innerHTML = `<p class="status">Cifrando la entrega…</p>`;
    try {
      const text = await file.text();
      JSON.parse(text);
      const bundle = await encryptPayload(text);
      const url = `${location.origin}${location.pathname}#${bundle}`;
      result.innerHTML = `
        <div class="success"><span>✓</span><div><strong>Enlace creado</strong><small>El contenido está cifrado y sólo se abre al acreditar IVAN PUENTES.</small></div></div>
        <label class="field-label" for="share-url">Enlace exclusivo</label>
        <textarea id="share-url" class="share-url" readonly rows="4"></textarea>
        <button id="copy-link" class="primary" type="button">Copiar enlace para Iván</button>
        <p class="warning">Quien tenga el enlace y conozca el nombre podrá abrirlo. Envíalo únicamente a Iván.</p>`;
      document.querySelector("#share-url").value = url;
      document.querySelector("#copy-link").addEventListener("click", async () => {
        await navigator.clipboard.writeText(url);
        document.querySelector("#copy-link").textContent = "Enlace copiado";
      });
    } catch {
      result.innerHTML = `<p class="error">No se pudo leer el archivo. Selecciona una exportación JSON válida de NEXO.</p>`;
    }
  });
}

function attemptState() {
  const value = JSON.parse(sessionStorage.getItem("nexo-ivan-attempts") || "null");
  if (!value || typeof value !== "object") return { count: 0, lockedUntil: 0 };
  return value;
}

function saveAttemptState(value) {
  sessionStorage.setItem("nexo-ivan-attempts", JSON.stringify(value));
}

function renderGate(bundle) {
  card(`
    <p class="kicker">Entrega privada</p>
    <h1>Acredita tu identidad.</h1>
    <p class="lead">Este enlace contiene una entrega cifrada destinada exclusivamente a Iván Puentes.</p>
    <form id="access-form" novalidate>
      <label class="field-label" for="recipient">Nombre completo autorizado</label>
      <input id="recipient" class="text-field" type="text" autocomplete="name" spellcheck="false" placeholder="Escribe tu nombre completo" required />
      <button class="primary" type="submit">Verificar y abrir descarga</button>
      <p id="gate-status" class="status" aria-live="polite"></p>
    </form>
    <div class="security"><span>◆</span><p><strong>Acceso controlado</strong><br />El documento permanece cifrado hasta completar la verificación.</p></div>
  `);

  const form = document.querySelector("#access-form");
  const input = document.querySelector("#recipient");
  const status = document.querySelector("#gate-status");
  const button = form.querySelector("button");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = attemptState();
    if (Date.now() < state.lockedUntil) {
      status.textContent = "Acceso temporalmente bloqueado. Espera 30 segundos.";
      return;
    }
    const name = normalizeName(input.value);
    if (name !== CANONICAL_RECIPIENT) {
      state.count += 1;
      if (state.count >= MAX_ATTEMPTS) {
        state.count = 0;
        state.lockedUntil = Date.now() + LOCK_MS;
      }
      saveAttemptState(state);
      status.textContent = "No fue posible acreditar la identidad.";
      input.select();
      return;
    }
    button.disabled = true;
    button.textContent = "Descifrando…";
    try {
      const jsonText = await decryptPayload(bundle, name);
      const data = JSON.parse(jsonText);
      sessionStorage.removeItem("nexo-ivan-attempts");
      renderViewer(data, jsonText);
    } catch {
      status.textContent = "El enlace es inválido, está incompleto o fue alterado.";
      button.disabled = false;
      button.textContent = "Verificar y abrir descarga";
    }
  });
}

const SECTIONS = [
  { id: 1, roman: "I", title: "Información general", description: "Los datos esenciales para conocerte.", from: 1, to: 5 },
  { id: 2, roman: "II", title: "Tu historia", description: "Las experiencias que explican tu recorrido.", from: 6, to: 9 },
  { id: 3, roman: "III", title: "Experiencia", description: "Lo que sabes hacer y lo que disfrutas aportar.", from: 10, to: 14 },
  { id: 4, roman: "IV", title: "Tu relación con NEXO", description: "Tu motivación, significado e impacto esperado.", from: 15, to: 18 },
  { id: 5, roman: "V", title: "Liderazgo", description: "Cómo decides, diriges y resuelves tensiones.", from: 19, to: 23 },
  { id: 6, roman: "VI", title: "Visión", description: "El lugar que imaginas construir a largo plazo.", from: 24, to: 26 },
  { id: 7, roman: "VII", title: "Fortalezas", description: "El valor distintivo que aportas al equipo.", from: 27, to: 30 },
  { id: 8, roman: "VIII", title: "Disponibilidad", description: "Tu tiempo y los recursos que puedes sumar.", from: 31, to: 32 },
  { id: 9, roman: "IX", title: "Cultura", description: "Los principios que deben sostener la comunidad.", from: 33, to: 35 },
  { id: 10, roman: "X", title: "Reflexión final", description: "Tu rol, tus decisiones y el legado que buscas.", from: 36, to: 40 }
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function answerText(value) {
  if (value === null || value === undefined || value === "") return "Sin respuesta";
  if (Array.isArray(value)) return value.map(answerText).join(", ");
  if (typeof value !== "object") return String(value);
  return Object.values(value).map(answerText).join(" ");
}

function answerMarkup(value) {
  if (value === null || value === undefined || value === "") return `<p class="answer-empty">Sin respuesta</p>`;
  if (Array.isArray(value)) {
    return `<div class="answer-tags">${value.map((item) => `<span>${escapeHtml(answerText(item))}</span>`).join("")}</div>`;
  }
  if (typeof value === "object") {
    const labels = { choice: "Elección", reason: "Motivo", score: "Nivel", position: "Puesto" };
    return `<dl class="answer-details">${Object.entries(value).map(([key, item]) => `
      <div><dt>${escapeHtml(labels[key] || key)}</dt><dd>${escapeHtml(answerText(item))}</dd></div>`).join("")}</dl>`;
  }
  return String(value).split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function normalizedResponses(data) {
  if (Array.isArray(data.responses)) return data.responses.slice().sort((a, b) => Number(a.number) - Number(b.number));
  return Object.entries(data).map(([question, answer], index) => ({ number: index + 1, question, answer }));
}

function viewerDownloadBindings(data, jsonText) {
  document.querySelectorAll("[data-format]").forEach((button) => {
    button.addEventListener("click", () => {
      const format = button.dataset.format;
      if (format === "json") download("rafael-toledo-navarro-nexo.json", JSON.stringify(JSON.parse(jsonText), null, 2), "application/json;charset=utf-8");
      if (format === "txt") download("rafael-toledo-navarro-nexo.txt", toText(data), "text/plain;charset=utf-8");
      if (format === "xml") download("rafael-toledo-navarro-nexo.xml", `<?xml version="1.0" encoding="UTF-8"?>\n${toXml(data)}\n`, "application/xml;charset=utf-8");
    });
  });
}

function renderViewer(data, jsonText) {
  const responses = normalizedResponses(data);
  let activeSection = 1;
  let displayMode = "section";
  let compact = false;
  let query = "";

  app.innerHTML = `
    <section class="viewer" aria-label="Visor privado de respuestas">
      <aside class="viewer-rail">
        <div class="rail-progress">
          <div><span>Progreso general</span><strong>100%</strong></div>
          <i><b></b></i>
          <small>40 de 40 preguntas respondidas</small>
        </div>
        <nav class="section-nav" aria-label="Secciones del cuestionario">
          ${SECTIONS.map((section) => `<button data-section="${section.id}" class="${section.id === 1 ? "active" : ""}"><span>${section.id}</span><b>${section.title}</b><em>Completa</em></button>`).join("")}
        </nav>
        <div class="rail-note"><strong>Documento privado</strong><p>Acceso cifrado y destinado exclusivamente a Iván Puentes.</p></div>
      </aside>

      <main class="viewer-main">
        <header class="viewer-heading">
          <div>
            <p class="viewer-kicker">NEXO · Perfil fundador</p>
            <h1>Rafael Toledo Navarro</h1>
            <p>Cuestionario completo · 40 respuestas verificadas</p>
          </div>
          <div class="viewer-status"><span></span> Identidad acreditada</div>
        </header>

        <div class="mobile-tools">
          <button id="mobile-sections" type="button">Secciones</button>
          <button id="mobile-search" type="button">Buscar</button>
        </div>

        <section id="response-view" class="response-view" aria-live="polite"></section>
      </main>

      <aside class="viewer-tools">
        <div class="tools-block search-block">
          <label for="viewer-search">Buscar en las respuestas</label>
          <input id="viewer-search" type="search" placeholder="Pregunta, tema o palabra…" autocomplete="off" />
          <small id="search-count">40 respuestas disponibles</small>
        </div>
        <div class="tools-block">
          <span class="tools-label">Vista</span>
          <div class="segmented">
            <button data-mode="section" class="active">Sección</button>
            <button data-mode="all">Todas</button>
          </div>
          <label class="compact-toggle"><input id="compact-view" type="checkbox" /><span></span> Lectura compacta</label>
        </div>
        <div class="tools-block current-index">
          <span class="tools-label">En esta sección</span>
          <div id="question-index"></div>
        </div>
        <div class="tools-block export-block">
          <span class="tools-label">Descargar copia</span>
          <div class="export-buttons">
            <button data-format="json"><b>JSON</b><small>Datos</small></button>
            <button data-format="txt"><b>TXT</b><small>Lectura</small></button>
            <button data-format="xml"><b>XML</b><small>Archivo</small></button>
          </div>
        </div>
      </aside>
      <button class="drawer-backdrop" id="drawer-backdrop" aria-label="Cerrar panel"></button>
    </section>`;

  const responseView = document.querySelector("#response-view");
  const questionIndex = document.querySelector("#question-index");
  const searchInput = document.querySelector("#viewer-search");
  const searchCount = document.querySelector("#search-count");

  function visibleResponses() {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    if (normalizedQuery) {
      return responses.filter((response) => `${response.question} ${answerText(response.answer)}`.toLocaleLowerCase("es").includes(normalizedQuery));
    }
    if (displayMode === "all") return responses;
    const section = SECTIONS.find((item) => item.id === activeSection);
    return responses.filter((response) => response.number >= section.from && response.number <= section.to);
  }

  function responseCard(response) {
    return `<article class="response-card" id="question-${response.number}">
      <div class="question-number">${response.number}</div>
      <div><h2>${escapeHtml(response.question)}</h2><div class="answer">${answerMarkup(response.answer)}</div></div>
    </article>`;
  }

  function paint() {
    const section = SECTIONS.find((item) => item.id === activeSection);
    const visible = visibleResponses();
    document.querySelector(".viewer").classList.toggle("compact", compact);
    responseView.innerHTML = `
      <div class="section-heading">
        <div><span>${query ? "Búsqueda" : displayMode === "all" ? "I–X" : `${section.roman}. ${section.title}`}</span>
        <h2>${query ? `Resultados para “${escapeHtml(query)}”` : displayMode === "all" ? "Todas las respuestas" : section.description}</h2></div>
        <strong>${visible.length} ${visible.length === 1 ? "respuesta" : "respuestas"}</strong>
      </div>
      <div class="responses-list">${visible.length ? visible.map(responseCard).join("") : `<div class="empty-search"><h2>No encontramos coincidencias.</h2><p>Prueba otra palabra o vuelve a una sección.</p></div>`}</div>`;
    questionIndex.innerHTML = visible.slice(0, 8).map((response) => `<button data-jump="${response.number}"><span>${response.number}</span>${escapeHtml(response.question)}</button>`).join("");
    searchCount.textContent = query ? `${visible.length} coincidencias` : "40 respuestas disponibles";
    document.querySelectorAll("[data-section]").forEach((button) => button.classList.toggle("active", Number(button.dataset.section) === activeSection && !query));
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === displayMode));
    document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => document.querySelector(`#question-${button.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" })));
  }

  document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => {
    activeSection = Number(button.dataset.section);
    query = "";
    searchInput.value = "";
    displayMode = "section";
    closeDrawers();
    paint();
    document.querySelector(".viewer-main").scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    displayMode = button.dataset.mode;
    query = "";
    searchInput.value = "";
    paint();
  }));
  searchInput.addEventListener("input", () => { query = searchInput.value; paint(); });
  document.querySelector("#compact-view").addEventListener("change", (event) => { compact = event.target.checked; paint(); });

  const viewer = document.querySelector(".viewer");
  const backdrop = document.querySelector("#drawer-backdrop");
  function closeDrawers() { viewer.classList.remove("sections-open", "tools-open"); }
  document.querySelector("#mobile-sections").addEventListener("click", () => viewer.classList.toggle("sections-open"));
  document.querySelector("#mobile-search").addEventListener("click", () => { viewer.classList.toggle("tools-open"); setTimeout(() => searchInput.focus(), 100); });
  backdrop.addEventListener("click", closeDrawers);

  viewerDownloadBindings(data, jsonText);
  paint();
}

const hash = location.hash.slice(1);
if (hash.startsWith("v1.")) renderGate(hash);
else if (new URLSearchParams(location.search).has("preparar")) renderPrepare();
else renderGate("");
