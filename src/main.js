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
      renderDownloads(data, jsonText);
    } catch {
      status.textContent = "El enlace es inválido, está incompleto o fue alterado.";
      button.disabled = false;
      button.textContent = "Verificar y abrir descarga";
    }
  });
}

function renderDownloads(data, jsonText) {
  card(`
    <div class="verified">✓ Identidad acreditada</div>
    <h1>Entrega disponible.</h1>
    <p class="lead">Las respuestas de Rafael Toledo Navarro están listas para descarga. Elige el formato que necesites.</p>
    <div class="downloads">
      <button class="download" data-format="json"><span>JSON</span><strong>Datos estructurados</strong><small>Para sistemas y respaldo</small></button>
      <button class="download" data-format="txt"><span>TXT</span><strong>Lectura sencilla</strong><small>Documento de texto</small></button>
      <button class="download" data-format="xml"><span>XML</span><strong>Intercambio técnico</strong><small>Formato interoperable</small></button>
    </div>
    <p class="warning">Documento privado de NEXO. No compartas el archivo ni este enlace con terceros.</p>
  `);
  document.querySelectorAll("[data-format]").forEach((button) => {
    button.addEventListener("click", () => {
      const format = button.dataset.format;
      if (format === "json") download("rafael-toledo-navarro-nexo.json", JSON.stringify(JSON.parse(jsonText), null, 2), "application/json;charset=utf-8");
      if (format === "txt") download("rafael-toledo-navarro-nexo.txt", toText(data), "text/plain;charset=utf-8");
      if (format === "xml") download("rafael-toledo-navarro-nexo.xml", `<?xml version="1.0" encoding="UTF-8"?>\n${toXml(data)}\n`, "application/xml;charset=utf-8");
    });
  });
}

const hash = location.hash.slice(1);
if (hash.startsWith("v1.")) renderGate(hash);
else if (new URLSearchParams(location.search).has("preparar")) renderPrepare();
else renderGate("");
