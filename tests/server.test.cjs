"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createAppServer } = require("../server.js");

let server;
let base;
const headers = { "X-QR-Schowek": "1" };
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a2QAAAAASUVORK5CYII=", "base64");

before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function upload(kind, body) {
  return fetch(`${base}/api/${kind}`, { method: "POST", headers, body });
}

test("local panel and API reject untrusted origins and missing headers", async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/api/config`)).status, 403);
  assert.equal((await fetch(`${base}/api/config`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/text`, {
    method: "POST", headers: { ...headers, Origin: "https://evil.example" }, body: "blocked",
  })).status, 403);
  assert.equal((await fetch(`${base}/api/text`, {
    method: "POST", headers: { ...headers, "Sec-Fetch-Site": "cross-site" }, body: "blocked",
  })).status, 403);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
});

test("text and image links remain independent and serve exact content", async () => {
  const text = "  Zażółć 🦊\n<script>alert('x')</script>  ";
  const textResponse = await upload("text", text);
  assert.equal(textResponse.status, 201);
  const textLink = await textResponse.json();
  assert.match(textLink.token, /^[A-Za-z0-9_-]{22}$/);
  const imageResponse = await upload("image", tinyPng);
  assert.equal(imageResponse.status, 201);
  const imageLink = await imageResponse.json();
  assert.notEqual(textLink.token, imageLink.token);

  const textContent = await fetch(`${base}/content/${textLink.token}`);
  assert.equal(textContent.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(textContent.headers.get("cache-control"), "no-store");
  assert.equal(textContent.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await textContent.text(), text);
  assert.equal((await (await fetch(`${base}/meta/${textLink.token}`)).json()).kind, "text");
  assert.equal((await (await fetch(`${base}/meta/${imageLink.token}`)).json()).kind, "image");

  const image = await fetch(`${base}/download/${imageLink.token}`);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.match(image.headers.get("content-disposition"), /attachment/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), tinyPng);
  assert.equal((await fetch(`${base}/p/${imageLink.token}`)).status, 200);

  const rejected = await upload("image", Buffer.from("<svg onload=alert(1)>"));
  assert.equal(rejected.status, 415);
  assert.equal((await fetch(`${base}/meta/${imageLink.token}`)).status, 200);

  const replaced = await (await upload("text", "nowy tekst")).json();
  assert.equal((await fetch(`${base}/meta/${textLink.token}`)).status, 404);
  assert.equal((await fetch(`${base}/meta/${imageLink.token}`)).status, 200);
  assert.equal((await fetch(`${base}/api/transfer/${replaced.token}`, { method: "DELETE", headers })).status, 200);
  assert.equal((await fetch(`${base}/meta/${replaced.token}`)).status, 404);
});

test("server enforces upload size and expiry", async () => {
  const tooLarge = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/image`, {
      method: "POST", headers: { ...headers, "Content-Length": 15 * 1024 * 1024 + 1 },
    }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on("error", reject);
    request.write("x");
  });
  assert.equal(tooLarge, 413);

  const transfer = await (await upload("text", "wygasa")).json();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 16 * 60 * 1000;
    assert.equal((await fetch(`${base}/meta/${transfer.token}`)).status, 404);
  } finally {
    Date.now = realNow;
  }
});
