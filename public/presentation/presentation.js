const slides = [...document.querySelectorAll(".slide")];
const deck = document.querySelector("#deck");
const progressBar = document.querySelector("#deck-progress-bar");
const slideLabel = document.querySelector("#deck-step-label");
const revealIndicator = document.querySelector("#reveal-indicator");
const announcer = document.querySelector("#deck-announcer");
const clickHint = document.querySelector("#click-hint");

const notesPanel = document.querySelector("#notes-panel");
const notesButton = document.querySelector("#notes-button");
const notesClose = document.querySelector("#notes-close");
const notesTitle = document.querySelector("#notes-title");
const notesCopy = document.querySelector("#notes-copy");

const helpOverlay = document.querySelector("#help-overlay");
const helpButton = document.querySelector("#help-button");
const helpClose = document.querySelector("#help-close");
const fullscreenButton = document.querySelector("#fullscreen-button");
const previousButton = document.querySelector("#prev-button");
const nextButton = document.querySelector("#next-button");

const parsedHash = window.location.hash.match(/^#slide-(\d+)(?:-(\d+))?$/);
let slideIndex = parsedHash
  ? Math.min(Math.max(Number(parsedHash[1]) - 1, 0), slides.length - 1)
  : 0;
let revealStep = 0;
let hasInteracted = false;
let touchStartX = null;
let lastRenderedSlide = -1;
let scenarioTimer = null;

function maxRevealFor() { return 0; }

function totalProgress() {
  const completedSlides = slides
    .slice(0, slideIndex)
    .reduce((total, slide) => total + maxRevealFor(slide) + 1, 0);
  const totalSteps = slides.reduce((total, slide) => total + maxRevealFor(slide) + 1, 0);
  return ((completedSlides + revealStep + 1) / totalSteps) * 100;
}

function render({ announce = true } = {}) {
  const activeSlide = slides[slideIndex];
  revealStep = 0;

  slides.forEach((slide, index) => {
    const isActive = index === slideIndex;
    slide.classList.toggle("is-active", isActive);
    slide.classList.toggle("is-before", index < slideIndex);
    slide.setAttribute("aria-hidden", String(!isActive));

    slide.querySelectorAll("[data-reveal]").forEach((item, order) => {
      item.style.setProperty("--reveal-order", order);
      item.classList.toggle("is-visible", isActive);
    });
  });

  progressBar.style.width = `${totalProgress()}%`;
  slideLabel.textContent = `${String(slideIndex + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
  revealIndicator.textContent = `${slideIndex + 1} / ${slides.length} 화면`;
  notesTitle.textContent = activeSlide.dataset.title || `${slideIndex + 1}번째 화면`;
  notesCopy.textContent = activeSlide.dataset.notes || "";
  previousButton.disabled = slideIndex === 0;
  nextButton.disabled = slideIndex === slides.length - 1;

  if (hasInteracted) clickHint.style.opacity = "0";

  const hash = `#slide-${slideIndex + 1}-${revealStep}`;
  if (window.location.hash !== hash) history.replaceState(null, "", hash);

  if (announce) {
    announcer.textContent = `${slideIndex + 1}번째 화면, ${activeSlide.dataset.title}`;
  }

  if (lastRenderedSlide !== slideIndex) {
    lastRenderedSlide = slideIndex;
    if (scenarioTimer) clearTimeout(scenarioTimer);
    const scenarioStage = activeSlide.querySelector(".scenario-stage");
    if (scenarioStage) {
      setScenarioMode(scenarioStage, "normal");
      const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 950;
      scenarioTimer = window.setTimeout(() => setScenarioMode(scenarioStage, "delay"), delay);
    }
  }
}

function next() {
  hasInteracted = true;
  if (slideIndex < slides.length - 1) {
    slideIndex += 1;
  }
  render();
}

function previous() {
  hasInteracted = true;
  if (slideIndex > 0) {
    slideIndex -= 1;
  }
  render();
}

function jumpTo(index) {
  slideIndex = Math.min(Math.max(index, 0), slides.length - 1);
  revealStep = 0;
  hasInteracted = true;
  render();
}

function setNotes(open) {
  notesPanel.classList.toggle("is-open", open);
  notesPanel.setAttribute("aria-hidden", String(!open));
  notesPanel.inert = !open;
  notesButton.setAttribute("aria-pressed", String(open));
  notesButton.setAttribute("aria-label", open ? "발표자 메모 닫기" : "발표자 메모 열기");
}

function setHelp(open) {
  helpOverlay.classList.toggle("is-open", open);
  helpOverlay.setAttribute("aria-hidden", String(!open));
  helpOverlay.inert = !open;
  if (open) helpClose.focus();
  else helpButton.focus({ preventScroll: true });
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    announcer.textContent = "브라우저에서 전체 화면을 허용하지 않았습니다.";
  }
}

deck.addEventListener("click", (event) => {
  if (event.target.closest("button, a, input, .notes-panel, .help-dialog")) return;
  next();
});

nextButton.addEventListener("click", next);
previousButton.addEventListener("click", previous);
notesButton.addEventListener("click", () => setNotes(!notesPanel.classList.contains("is-open")));
notesClose.addEventListener("click", () => setNotes(false));
helpButton.addEventListener("click", () => setHelp(true));
helpClose.addEventListener("click", () => setHelp(false));
helpOverlay.addEventListener("click", (event) => {
  if (event.target === helpOverlay) setHelp(false);
});
fullscreenButton.addEventListener("click", toggleFullscreen);

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = Boolean(document.fullscreenElement);
  fullscreenButton.textContent = isFullscreen ? "×" : "⌗";
  fullscreenButton.setAttribute("aria-label", isFullscreen ? "전체 화면 끝내기" : "전체 화면으로 보기");
});

function setScenarioMode(stage, mode) {
  stage.dataset.mode = mode;
  stage.closest(".slide").querySelectorAll("[data-scenario]").forEach((button) => {
    const isSelected = button.dataset.scenario === mode;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    const stage = button.closest(".slide").querySelector(".scenario-stage");
    if (scenarioTimer) clearTimeout(scenarioTimer);
    setScenarioMode(stage, button.dataset.scenario);
  });
});

document.addEventListener("keydown", (event) => {
  const tagName = event.target.tagName;
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(tagName)) return;

  if (event.key === "Escape") {
    if (helpOverlay.classList.contains("is-open")) setHelp(false);
    else if (notesPanel.classList.contains("is-open")) setNotes(false);
    return;
  }

  if (helpOverlay.classList.contains("is-open")) return;

  if (["ArrowRight", "PageDown", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    next();
  } else if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) {
    event.preventDefault();
    previous();
  } else if (event.key === "Home") {
    event.preventDefault();
    jumpTo(0);
  } else if (event.key === "End") {
    event.preventDefault();
    jumpTo(slides.length - 1);
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    toggleFullscreen();
  } else if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    setNotes(!notesPanel.classList.contains("is-open"));
  } else if (event.key === "?" || event.key === "/") {
    event.preventDefault();
    setHelp(true);
  }
});

deck.addEventListener("touchstart", (event) => {
  touchStartX = event.changedTouches[0]?.clientX ?? null;
}, { passive: true });

deck.addEventListener("touchend", (event) => {
  if (touchStartX === null) return;
  const touchEndX = event.changedTouches[0]?.clientX ?? touchStartX;
  const distance = touchEndX - touchStartX;
  touchStartX = null;
  if (Math.abs(distance) < 55) return;
  if (distance < 0) next();
  else previous();
}, { passive: true });

window.addEventListener("hashchange", () => {
  const match = window.location.hash.match(/^#slide-(\d+)(?:-(\d+))?$/);
  if (!match) return;
  jumpTo(Number(match[1]) - 1);
});

slides.forEach((slide) => {
  slide.querySelectorAll("img").forEach((image) => {
    image.addEventListener("error", () => image.classList.add("is-missing"), { once: true });
  });
});

notesPanel.inert = true;
helpOverlay.inert = true;
render({ announce: false });
