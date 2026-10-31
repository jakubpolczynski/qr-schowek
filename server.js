"use strict";

const http = require("node:http");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { TextDecoder } = require("node:util");

const TEXT_LIMIT = 1024 * 1024;
const IMAGE_LIMIT = 15 * 1024 * 1024;
const TRANSFER_LIFETIME = 15 * 60 * 1000;
const TOKEN_PATTERN = "[A-Za-z0-9_-]{22}";

const desktopFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/vendor/qrcodegen.js": ["vendor/qrcodegen.js", "text/javascript; charset=utf-8"],
};
const phoneFiles = {
  "/phone.css": ["phone.css", "text/css; charset=utf-8"],
  "/phone.js": ["phone.js", "text/javascript; charset=utf-8"],
};

function ipv4(address) {
  return address?.startsWith("::ffff:") ? address.slice(7) : address;
}

function isLoopback(address) {
  const value = ipv4(address);
  return value === "::1" || (net.isIPv4(value) && value.startsWith("127."));
}

function isPrivateIpv4(address) {
  const value = ipv4(address);
  if (!net.isIPv4(value)) return false;
  const [first, second] = value.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function networkAddresses() {
  const addresses = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (!entry.internal && entry.family === "IPv4" && isPrivateIpv4(entry.address)) {
        addresses.push({ name, address: entry.address });
      }
    }
  }
  return addresses.sort((a, b) => {
    const wifi = (name) => /wi-?fi|wlan|wireless/i.test(name) ? 0 : 1;
    return wifi(a.name) - wifi(b.name) || a.name.localeCompare(b.name);
  });
}

function imageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return ["image/png", "png"];
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return ["image/jpeg", "jpg"];
  }
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return ["image/gif", "gif"];
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return ["image/webp", "webp"];
  }
  return null;
}

function createAppServer() {
  const transfers = new Map();
  let uploadInProgress = false;

  function forget(kind) {
    const transfer = transfers.get(kind);
    if (transfer) clearTimeout(transfer.timer);
    transfers.delete(kind);
  }

  function findTransfer(token) {
    for (const [kind, transfer] of transfers) {
      if (transfer.expiresAt <= Date.now()) {
        forget(kind);
      } else if (transfer.token === token) {
        return transfer;
      }
    }
    return null;
  }

  function send(res, status, type, body, extraHeaders = {}) {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      ...extraHeaders,
    });
    res.end(body);
  }

  function json(res, status, value) {
    send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
  }

  function localHost(req) {
    const port = server.address()?.port;
    const host = String(req.headers.host || "").toLowerCase();
    return isLoopback(req.socket.remoteAddress) &&
      (host === `127.0.0.1:${port}` || host === `localhost:${port}`);
  }

  function localApi(req) {
    if (!localHost(req) || req.headers["x-qr-schowek"] !== "1") return false;
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return false;
    const site = req.headers["sec-fetch-site"];
    return !site || site === "same-origin" || site === "none";
  }

  function serveFile(res, file) {
    fs.readFile(path.join(__dirname, file[0]), (error, data) => {
      if (error) {
        send(res, 500, "text/plain; charset=utf-8", "Nie udało się otworzyć pliku aplikacji.");
      } else {
        send(res, 200, file[1], data);
      }
    });
  }

  async function saveTransfer(req, res, kind) {
    const limit = kind === "text" ? TEXT_LIMIT : IMAGE_LIMIT;
    const contentLength = req.headers["content-length"];
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > limit)) {
      req.resume();
      json(res, 413, { error: "Plik jest za duży." });
      return;
    }
    if (uploadInProgress) {
      req.resume();
      json(res, 429, { error: "Poczekaj, aż zakończy się poprzednie przesyłanie." });
      return;
    }

    uploadInProgress = true;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new RangeError("too large");
        chunks.push(chunk);
      }
      if (!size) {
        json(res, 400, { error: "Nie wybrano zawartości do przesłania." });
        return;
      }
      const data = Buffer.concat(chunks, size);
      let mime = "text/plain; charset=utf-8";
      let extension = "txt";
      if (kind === "image") {
        const detected = imageType(data);
        if (!detected) {
          json(res, 415, { error: "Wybierz obraz PNG, JPG, GIF lub WebP." });
          return;
        }
        [mime, extension] = detected;
      } else {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(data);
        } catch {
          json(res, 400, { error: "Tekst nie jest zapisany w UTF-8." });
          return;
        }
      }

      forget(kind);
      const token = randomBytes(16).toString("base64url");
      const expiresAt = Date.now() + TRANSFER_LIFETIME;
      const timer = setTimeout(() => {
        if (transfers.get(kind)?.token === token) forget(kind);
      }, TRANSFER_LIFETIME);
      timer.unref();
      transfers.set(kind, { kind, token, data, mime, extension, expiresAt, timer });
      json(res, 201, { token, expiresAt });
    } catch (error) {
      if (!res.destroyed) {
        json(res, error instanceof RangeError ? 413 : 400, { error: "Nie udało się przesłać danych." });
      }
    } finally {
      uploadInProgress = false;
    }
  }

  const server = http.createServer((req, res) => {
    if (!isLoopback(req.socket.remoteAddress) &&
        (!isPrivateIpv4(req.socket.remoteAddress) || !isPrivateIpv4(req.socket.localAddress))) {
      send(res, 403, "text/plain; charset=utf-8", "Dostępny tylko w sieci lokalnej.");
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url, "http://local.invalid").pathname;
    } catch {
      send(res, 400, "text/plain; charset=utf-8", "Nieprawidłowy adres.");
      return;
    }

    if (pathname.startsWith("/api/")) {
      if (!localApi(req)) {
        json(res, 403, { error: "Brak dostępu." });
        return;
      }
      if (req.method === "GET" && pathname === "/api/config") {
        json(res, 200, { addresses: networkAddresses(), port: server.address().port });
        return;
      }
      if (req.method === "POST" && (pathname === "/api/text" || pathname === "/api/image")) {
        void saveTransfer(req, res, pathname.slice(5));
        return;
      }
      const remove = pathname.match(new RegExp(`^/api/transfer/(${TOKEN_PATTERN})$`));
      if (req.method === "DELETE" && remove) {
        const transfer = findTransfer(remove[1]);
        if (transfer) forget(transfer.kind);
        json(res, 200, { removed: Boolean(transfer) });
        return;
      }
      json(res, 404, { error: "Nie znaleziono." });
      return;
    }

    if (req.method === "GET" && Object.hasOwn(desktopFiles, pathname)) {
      if (!localHost(req)) {
        send(res, 403, "text/plain; charset=utf-8", "Panel jest dostępny tylko na komputerze.");
      } else {
        serveFile(res, desktopFiles[pathname]);
      }
      return;
    }
    if (req.method === "GET" && Object.hasOwn(phoneFiles, pathname)) {
      serveFile(res, phoneFiles[pathname]);
      return;
    }
    if (req.method === "GET" && new RegExp(`^/p/${TOKEN_PATTERN}$`).test(pathname)) {
      serveFile(res, ["phone.html", "text/html; charset=utf-8"]);
      return;
    }

    const match = pathname.match(new RegExp(`^/(meta|content|download)/(${TOKEN_PATTERN})$`));
    if (req.method === "GET" && match) {
      const transfer = findTransfer(match[2]);
      if (!transfer) {
        json(res, 404, { error: "Link wygasł lub został usunięty." });
      } else if (match[1] === "meta") {
        json(res, 200, { kind: transfer.kind });
      } else if (match[1] === "download" && transfer.kind !== "image") {
        json(res, 404, { error: "Nie znaleziono." });
      } else {
        const headers = match[1] === "download"
          ? { "Content-Disposition": `attachment; filename="obraz.${transfer.extension}"` }
          : {};
        send(res, 200, transfer.mime, transfer.data, headers);
      }
      return;
    }
    send(res, 404, "text/plain; charset=utf-8", "Nie znaleziono.");
  });

  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.on("close", () => {
    for (const kind of transfers.keys()) forget(kind);
  });
  return server;
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => console.log("Otwórz w przeglądarce: " + url));
  child.unref();
}

if (require.main === module) {
  const server = createAppServer();
  server.on("error", () => {
    console.error("Nie udało się uruchomić serwera. Sprawdź uprawnienia i spróbuj ponownie.");
    process.exitCode = 1;
  });
  server.listen(0, "0.0.0.0", () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log("Schowek na telefon jest uruchomiony.");
    console.log("Otwórz w przeglądarce: " + url);
    console.log("Nie zamykaj tego okna podczas przesyłania. Zamknięcie zatrzyma program.");
    if (!process.env.QR_SCHOWEK_NO_OPEN) openBrowser(url);
  });
}

module.exports = { createAppServer };
