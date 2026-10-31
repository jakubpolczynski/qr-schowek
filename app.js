"use strict";

const MAX_QR_BYTES = 2952;
const MAX_WIFI_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const encoder = new TextEncoder();
const $ = (selector) => document.querySelector(selector);

const textInput = $("#text-input");
const pasteButton = $("#paste-button");
const clearButton = $("#clear-button");
const clipboardMessage = $("#clipboard-message");
const byteCount = $("#byte-count");
const shareTextButton = $("#share-text");
const networkSelect = $("#network-select");
const qrImage = $("#qr-image");
const qrPlaceholder = $("#qr-placeholder");
const qrStatus = $("#qr-status");
const scanHelp = $("#scan-help");
const expandButton = $("#expand-button");
const qrDialog = $("#qr-dialog");
const dialogQr = $("#dialog-qr");
const imageFileInput = $("#image-file");
const imagePreview = $("#image-preview");
const imageMessage = $("#image-message");

const localServerOrigin = location.protocol === "http:" &&
  ["127.0.0.1", "localhost"].includes(location.hostname);
let apiState = localServerOrigin ? "loading" : "unavailable";
let serverConfig = null;
let mode = "text";
let renderTimer;
let editVersion = 0;
let imageVersion = 0;
let busy = null;
let textTransfer = null;
let imageTransfer = null;
let selectedImage = null;
let imageObjectUrl = null;

if (localServerOrigin) {
  $('input[name="text-method"][value="wifi"]').checked = true;
}

function textMethod() {
  return $('input[name="text-method"]:checked').value;
}

function isWifiMode() {
  return mode === "image" || textMethod() === "wifi";
}

function canUseWifi() {
  return apiState === "ready" && serverConfig.addresses.length > 0 && Boolean(networkSelect.value);
}

function clearPreview(status, help, isError = false) {
  qrImage.replaceChildren();
  qrPlaceholder.hidden = false;
  expandButton.disabled = true;
  qrStatus.textContent = status;
  qrStatus.classList.toggle("is-error", isError);
  scanHelp.textContent = help;
}

function makeQrSvg(qr, description) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const background = document.createElementNS(namespace, "rect");
  const path = document.createElementNS(namespace, "path");
  const border = 4;
  const size = qr.size + border * 2;
  let squares = "";

  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.dataset.modules = size;
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", description);
  background.setAttribute("width", size);
  background.setAttribute("height", size);
  background.setAttribute("fill", "white");

  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.getModule(x, y)) squares += `M${x + border},${y + border}h1v1h-1z`;
    }
  }

  path.setAttribute("d", squares);
  path.setAttribute("fill", "black");
  svg.append(background, path);
  return svg;
}

// Use whole screen pixels per QR module so dense codes remain scannable.
function fitQr(container) {
  const svg = container.querySelector("svg");
  if (!svg) return;
  const bounds = container.getBoundingClientRect();
  const modules = Number(svg.dataset.modules);
  const pixelRatio = window.devicePixelRatio || 1;
  const pixelsPerModule = Math.floor(Math.min(bounds.width, bounds.height) * pixelRatio / modules);
  if (pixelsPerModule < 1) return;
  const side = pixelsPerModule * modules / pixelRatio;
  svg.style.width = `${side}px`;
  svg.style.height = `${side}px`;
}

const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) fitQr(entry.target);
});
resizeObserver.observe(qrImage);
resizeObserver.observe(dialogQr);
window.addEventListener("resize", () => {
  fitQr(qrImage);
  fitQr(dialogQr);
});

function displayQr(qr, description, help) {
  qrImage.replaceChildren(makeQrSvg(qr, description));
  qrPlaceholder.hidden = true;
  fitQr(qrImage);
  qrStatus.textContent = "Gotowe do zeskanowania";
  qrStatus.classList.remove("is-error");
  scanHelp.textContent = help;
  expandButton.disabled = false;
}

function transferUrl(transfer) {
  return `http://${networkSelect.value}:${serverConfig.port}/p/${transfer.token}`;
}

function renderControls() {
  const wifi = isWifiMode();
  const textMode = mode === "text";
  const bytes = encoder.encode(textInput.value);
  const limit = textMethod() === "wifi" ? MAX_WIFI_TEXT_BYTES : MAX_QR_BYTES;

  $("#mode-text").setAttribute("aria-pressed", String(textMode));
  $("#mode-image").setAttribute("aria-pressed", String(!textMode));
  $("#text-editor").hidden = !textMode;
  $("#image-editor").hidden = textMode;
  $("#privacy-direct").hidden = wifi;
  $("#privacy-wifi").hidden = !wifi;
  $("#how-direct").hidden = wifi;
  $("#how-wifi-text").hidden = !textMode || !wifi;
  $("#how-wifi-image").hidden = textMode;
  $("#network-settings").hidden = !wifi || apiState !== "ready";
  $("#wifi-unavailable").hidden = !wifi || apiState === "ready";
  $("#wifi-unavailable").textContent = apiState === "loading"
    ? "Sprawdzanie sieci lokalnej…"
    : "Aby przesyłać przez Wi-Fi, uruchom plik Uruchom.bat z folderu programu.";
  $("#network-help").textContent = serverConfig?.addresses.length
    ? "Telefon i komputer muszą być w tej samej sieci. Jeśli link nie działa, wybierz inny adres."
    : "Nie znaleziono adresu w sieci lokalnej. Połącz komputer z Wi-Fi i kliknij Odśwież.";
  networkSelect.disabled = !serverConfig?.addresses.length;

  clearButton.disabled = !textInput.value;
  byteCount.textContent = `${bytes.length.toLocaleString("pl-PL")} / ${limit.toLocaleString("pl-PL")} B`;
  byteCount.classList.toggle("over-limit", bytes.length > limit);
  $("#text-help").textContent = textMethod() === "wifi"
    ? "Utwórz kod, aby udostępnić tekst w sieci."
    : "Kod tworzy się automatycznie.";
  shareTextButton.hidden = textMethod() !== "wifi";
  shareTextButton.disabled = !canUseWifi() || !textInput.value || bytes.length > limit || Boolean(busy);
  shareTextButton.textContent = textTransfer ? "Utwórz nowy kod Wi-Fi" : "Utwórz kod Wi-Fi";

  $("#paste-image").disabled = !canUseWifi() || Boolean(busy);
  $("#choose-image").disabled = !canUseWifi() || Boolean(busy);
  $("#clear-image").disabled = !selectedImage || Boolean(busy);
  $("#retry-image").hidden = !selectedImage || Boolean(imageTransfer) || Boolean(busy);
  $("#retry-image").disabled = !canUseWifi();
  $("#dialog-help").textContent = wifi
    ? "Otwórz link z kodu na telefonie."
    : "Po zeskanowaniu skopiuj tekst na telefonie.";
}

function updatePreview() {
  clearTimeout(renderTimer);
  renderControls();

  if (isWifiMode()) {
    if (apiState === "loading") {
      clearPreview("Sprawdzanie sieci…", "Za chwilę będzie można utworzyć kod.");
      return;
    }
    if (apiState !== "ready") {
      clearPreview("Uruchom program", "Otwórz plik Uruchom.bat, aby korzystać z Wi-Fi.");
      return;
    }
    if (!canUseWifi()) {
      clearPreview("Brak adresu sieciowego", "Połącz komputer z siecią i odśwież adresy.", true);
      return;
    }
    if ((mode === "text" && busy === "text") || (mode === "image" && busy === "image")) {
      clearPreview("Przygotowanie kodu…", "Za chwilę będzie gotowy do skanowania.");
      return;
    }
    if (mode === "text" && encoder.encode(textInput.value).length > MAX_WIFI_TEXT_BYTES) {
      clearPreview("Tekst jest za długi", "Skróć tekst do 1 MB lub podziel go na części.", true);
      return;
    }

    const transfer = mode === "text" ? textTransfer : imageTransfer;
    if (!transfer) {
      const status = mode === "text" ? "Czeka na tekst" : "Czeka na obraz";
      const help = mode === "text"
        ? "Wklej tekst i kliknij „Utwórz kod Wi-Fi”."
        : "Wklej obraz lub wybierz plik.";
      clearPreview(status, help);
      return;
    }
    try {
      const qr = qrcodegen.QrCode.encodeText(transferUrl(transfer), qrcodegen.QrCode.Ecc.LOW);
      displayQr(qr, "Kod QR z lokalnym linkiem do zawartości", "Otwórz link na telefonie. Jest ważny 15 minut.");
    } catch (error) {
      console.error("Nie udało się utworzyć kodu QR:", error);
      clearPreview("Nie udało się utworzyć kodu", "Spróbuj ponownie.", true);
    }
    return;
  }

  const text = textInput.value;
  const bytes = encoder.encode(text);
  if (!text) {
    clearPreview("Czeka na tekst", "Kod pojawi się, gdy wkleisz tekst.");
    return;
  }
  if (bytes.length > MAX_QR_BYTES) {
    clearPreview("Tekst jest za długi", "Skróć go, podziel na części lub wybierz Wi-Fi.", true);
    return;
  }

  clearPreview("Tworzenie kodu…", "Za chwilę będzie gotowy do skanowania.");
  renderTimer = setTimeout(() => {
    try {
      const segments = [];
      if (/[^\x00-\x7f]/.test(text)) segments.push(qrcodegen.QrSegment.makeEci(26));
      segments.push(qrcodegen.QrSegment.makeBytes(Array.from(bytes)));
      const qr = qrcodegen.QrCode.encodeSegments(segments, qrcodegen.QrCode.Ecc.LOW);
      displayQr(qr, "Kod QR zawierający wklejony tekst", bytes.length > 1000
        ? "Duży kod? Użyj przycisku „Powiększ”."
        : "Skieruj aparat lub skaner QR na kod.");
    } catch (error) {
      console.error("Nie udało się utworzyć kodu QR:", error);
      clearPreview("Nie udało się utworzyć kodu", "Spróbuj ponownie lub skróć tekst.", true);
    }
  }, 150);
}

function removeRemote(token, kind) {
  if (!localServerOrigin) return;
  fetch(`/api/transfer/${token}`, {
    method: "DELETE",
    headers: { "X-QR-Schowek": "1" },
  }).then((response) => {
    if (!response.ok) throw new Error("Removal failed");
  }).catch(() => {
    const message = "Nie udało się potwierdzić usunięcia linku. Zamknij okno programu, aby przerwać dostęp.";
    if (kind === "text") clipboardMessage.textContent = message;
    else imageMessage.textContent = message;
  });
}

function forgetTransfer(kind, removeFromServer = true) {
  const transfer = kind === "text" ? textTransfer : imageTransfer;
  if (!transfer) return;
  clearTimeout(transfer.timer);
  if (kind === "text") textTransfer = null;
  else imageTransfer = null;
  if (removeFromServer) removeRemote(transfer.token, kind);
}

function rememberTransfer(kind, data) {
  forgetTransfer(kind, false);
  const transfer = { token: data.token, expiresAt: data.expiresAt, timer: null };
  transfer.timer = setTimeout(() => {
    if ((kind === "text" ? textTransfer : imageTransfer) !== transfer) return;
    forgetTransfer(kind, false);
    if (kind === "text") clipboardMessage.textContent = "Link wygasł. Utwórz nowy kod Wi-Fi.";
    else imageMessage.textContent = "Link wygasł. Utwórz nowy kod Wi-Fi.";
    updatePreview();
  }, Math.max(0, data.expiresAt - Date.now()));
  if (kind === "text") textTransfer = transfer;
  else imageTransfer = transfer;
}

async function upload(kind, body, version) {
  if (!canUseWifi() || busy) return;
  busy = kind;
  if (kind === "image") imageMessage.textContent = "Przygotowywanie obrazu…";
  else clipboardMessage.textContent = "";
  updatePreview();

  try {
    const response = await fetch(`/api/${kind}`, {
      method: "POST",
      headers: { "X-QR-Schowek": "1", "Content-Type": "application/octet-stream" },
      body,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się przesłać danych.");
    if (!/^[A-Za-z0-9_-]{22}$/.test(result.token) || !Number.isFinite(result.expiresAt)) {
      throw new Error("Serwer zwrócił nieprawidłową odpowiedź.");
    }
    if ((kind === "text" ? editVersion : imageVersion) !== version) {
      removeRemote(result.token, kind);
      return;
    }
    rememberTransfer(kind, result);
    if (kind === "image") imageMessage.textContent = "Obraz jest gotowy do odebrania.";
  } catch (error) {
    const message = error instanceof TypeError
      ? "Brak połączenia z programem. Uruchom ponownie plik Uruchom.bat."
      : error.message;
    if (kind === "text") clipboardMessage.textContent = message;
    else imageMessage.textContent = message;
  } finally {
    busy = null;
    updatePreview();
  }
}

async function loadConfig() {
  if (!localServerOrigin) return;
  const previousAddress = networkSelect.value;
  apiState = "loading";
  updatePreview();
  try {
    const response = await fetch("/api/config", { headers: { "X-QR-Schowek": "1" }, cache: "no-store" });
    if (!response.ok) throw new Error("Config unavailable");
    const config = await response.json();
    if (!Array.isArray(config.addresses) || !Number.isInteger(config.port)) throw new Error("Invalid config");
    serverConfig = config;
    networkSelect.replaceChildren();
    if (!config.addresses.length) {
      networkSelect.add(new Option("Brak adresu w sieci lokalnej", ""));
    } else {
      for (const entry of config.addresses) {
        networkSelect.add(new Option(`${entry.name} — ${entry.address}`, entry.address));
      }
      if (config.addresses.some((entry) => entry.address === previousAddress)) {
        networkSelect.value = previousAddress;
      }
    }
    apiState = "ready";
  } catch {
    apiState = "unavailable";
    serverConfig = null;
  }
  updatePreview();
}

function textChanged() {
  editVersion += 1;
  forgetTransfer("text");
  clipboardMessage.textContent = "";
  updatePreview();
}

textInput.addEventListener("input", textChanged);
pasteButton.addEventListener("click", async () => {
  clipboardMessage.textContent = "";
  if (!navigator.clipboard?.readText) {
    clipboardMessage.textContent = "Odczyt schowka jest niedostępny. Kliknij pole i użyj Ctrl+V.";
    textInput.focus();
    return;
  }

  const versionAtClick = editVersion;
  pasteButton.disabled = true;
  try {
    const text = await navigator.clipboard.readText();
    if (editVersion !== versionAtClick) {
      clipboardMessage.textContent = "Tekst został zmieniony. Kliknij ponownie, aby wkleić schowek.";
    } else if (text === "") {
      clipboardMessage.textContent = "Schowek nie zawiera tekstu. Skopiuj tekst lub wklej go ręcznie.";
    } else {
      textInput.value = text;
      textChanged();
    }
  } catch {
    clipboardMessage.textContent = "Nie udało się odczytać schowka. Kliknij pole i użyj Ctrl+V.";
    textInput.focus();
  } finally {
    pasteButton.disabled = false;
  }
});

clearButton.addEventListener("click", () => {
  textInput.value = "";
  textChanged();
  textInput.focus();
});
shareTextButton.addEventListener("click", () => {
  if (!textInput.value || encoder.encode(textInput.value).length > MAX_WIFI_TEXT_BYTES) return;
  void upload("text", encoder.encode(textInput.value), editVersion);
});

function acceptImage(file) {
  if (!file || !canUseWifi() || busy) return;
  if (!file.size || file.size > MAX_IMAGE_BYTES) {
    imageMessage.textContent = "Wybierz obraz o rozmiarze do 15 MB.";
    return;
  }
  if (file.type && !IMAGE_TYPES.includes(file.type)) {
    imageMessage.textContent = "Wybierz obraz PNG, JPG, GIF lub WebP.";
    return;
  }
  imageVersion += 1;
  forgetTransfer("image");
  selectedImage = file;
  if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
  imageObjectUrl = URL.createObjectURL(file);
  imagePreview.src = imageObjectUrl;
  imagePreview.hidden = false;
  $("#image-empty").hidden = true;
  const size = file.size < 1024
    ? `${file.size} B`
    : file.size < 1024 * 1024
      ? `${(file.size / 1024).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} KB`
      : `${(file.size / 1024 / 1024).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} MB`;
  $("#image-detail").textContent = `${file.name || "Obraz ze schowka"} · ${size}`;
  imageFileInput.value = "";
  void upload("image", file, imageVersion);
}

$("#paste-image").addEventListener("click", async () => {
  if (!canUseWifi() || busy) return;
  if (!navigator.clipboard?.read) {
    imageMessage.textContent = "Użyj Ctrl+V albo wybierz plik z obrazem.";
    return;
  }
  busy = "clipboard";
  imageMessage.textContent = "";
  updatePreview();
  let image = null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((value) => IMAGE_TYPES.includes(value));
      if (type) {
        image = await item.getType(type);
        break;
      }
    }
    if (!image) imageMessage.textContent = "Schowek nie zawiera obsługiwanego obrazu. Użyj Ctrl+V lub wybierz plik.";
  } catch {
    imageMessage.textContent = "Nie udało się odczytać schowka. Użyj Ctrl+V albo wybierz plik.";
  } finally {
    busy = null;
    updatePreview();
  }
  if (image && mode === "image") acceptImage(image);
});

$("#choose-image").addEventListener("click", () => imageFileInput.click());
imageFileInput.addEventListener("change", () => acceptImage(imageFileInput.files[0]));
$("#retry-image").addEventListener("click", () => {
  if (selectedImage) void upload("image", selectedImage, imageVersion);
});
$("#clear-image").addEventListener("click", () => {
  imageVersion += 1;
  forgetTransfer("image");
  selectedImage = null;
  if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
  imageObjectUrl = null;
  imagePreview.removeAttribute("src");
  imagePreview.hidden = true;
  $("#image-empty").hidden = false;
  $("#image-detail").textContent = "PNG, JPG, GIF lub WebP · maks. 15 MB";
  imageMessage.textContent = "";
  imageFileInput.value = "";
  updatePreview();
});

document.addEventListener("paste", (event) => {
  if (mode !== "image") return;
  const image = Array.from(event.clipboardData?.items || [])
    .find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
  if (image) {
    event.preventDefault();
    if (busy) imageMessage.textContent = "Poczekaj na zakończenie przesyłania.";
    else if (!canUseWifi()) imageMessage.textContent = "Uruchom program i połącz komputer z siecią lokalną.";
    else acceptImage(image);
  }
});

const imageWell = $("#image-well");
for (const eventName of ["dragenter", "dragover"]) {
  imageWell.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (canUseWifi() && !busy) imageWell.classList.add("is-dragging");
  });
}
imageWell.addEventListener("dragleave", () => imageWell.classList.remove("is-dragging"));
imageWell.addEventListener("drop", (event) => {
  event.preventDefault();
  imageWell.classList.remove("is-dragging");
  acceptImage(event.dataTransfer?.files[0]);
});

$("#mode-text").addEventListener("click", () => { mode = "text"; updatePreview(); });
$("#mode-image").addEventListener("click", () => { mode = "image"; updatePreview(); });
for (const radio of document.querySelectorAll('input[name="text-method"]')) {
  radio.addEventListener("change", updatePreview);
}
networkSelect.addEventListener("change", updatePreview);
$("#refresh-network").addEventListener("click", loadConfig);

expandButton.addEventListener("click", () => {
  const svg = qrImage.querySelector("svg");
  if (!svg) return;
  dialogQr.replaceChildren(svg.cloneNode(true));
  qrDialog.showModal();
  fitQr(dialogQr);
});
$("#close-dialog").addEventListener("click", () => qrDialog.close());
qrDialog.addEventListener("click", (event) => {
  if (event.target === qrDialog) qrDialog.close();
});
qrDialog.addEventListener("close", () => dialogQr.replaceChildren());

updatePreview();
void loadConfig();
