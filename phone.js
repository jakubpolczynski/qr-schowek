"use strict";

const token = location.pathname.split("/").pop();
const loading = document.querySelector("#loading");
const textSection = document.querySelector("#text-section");
const imageSection = document.querySelector("#image-section");
const errorSection = document.querySelector("#error-section");
const receivedText = document.querySelector("#received-text");
const feedback = document.querySelector("#copy-feedback");

function showError() {
  loading.hidden = true;
  textSection.hidden = true;
  imageSection.hidden = true;
  errorSection.hidden = false;
}

async function loadTransfer() {
  try {
    const infoResponse = await fetch(`/meta/${token}`, { cache: "no-store" });
    if (!infoResponse.ok) throw new Error("Transfer unavailable");
    const info = await infoResponse.json();
    if (info.kind === "text") {
      const response = await fetch(`/content/${token}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Transfer unavailable");
      receivedText.value = await response.text();
      textSection.hidden = false;
    } else if (info.kind === "image") {
      const image = document.querySelector("#received-image");
      image.addEventListener("error", showError, { once: true });
      image.src = `/content/${token}`;
      document.querySelector("#download-image").href = `/download/${token}`;
      imageSection.hidden = false;
    } else {
      throw new Error("Unknown transfer");
    }
    loading.hidden = true;
  } catch {
    showError();
  }
}

document.querySelector("#copy-text").addEventListener("click", async () => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(receivedText.value);
      feedback.textContent = "Tekst skopiowany do schowka.";
      return;
    } catch {
      // On a local HTTP address, browser clipboard permissions may be unavailable.
    }
  }

  receivedText.focus();
  receivedText.select();
  receivedText.setSelectionRange(0, receivedText.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // The selected text remains available for the phone's manual copy action.
  }
  feedback.textContent = copied
    ? "Tekst skopiowany do schowka."
    : "Tekst jest zaznaczony. Wybierz „Kopiuj” w menu telefonu.";
});

loadTransfer();
