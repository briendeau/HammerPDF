// Set PDF.js worker path
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.12.313/pdf.worker.min.js";

// DOM elements
const uploadContainer = document.getElementById("upload-container");
const viewerContainer = document.getElementById("viewer-container");
const uploadArea = document.getElementById("upload-area");
const fileInput = document.getElementById("file-input");
const closeBtn = document.getElementById("close-btn");
const pdfViewer = document.getElementById("pdf-viewer");
const pdfContainer = document.getElementById("pdf-container");
const loadingOverlay = document.getElementById("loading-overlay");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const documentTitle = document.getElementById("document-title");
const exitFullscreenBtn = document.getElementById("exit-fullscreen-btn");

// Toolbar elements
const fullscreenBtn = document.getElementById("fullscreen-btn");
const rotateBtn = document.getElementById("rotate-btn");
const pacerBtn = document.getElementById("pacer-btn");
const colorBtn = document.getElementById("color-btn");
const colorPanel = document.getElementById("color-panel");
const colorOptions = document.querySelectorAll(".color-option");
const brightnessSlider = document.getElementById("brightness-slider");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomLevel = document.getElementById("zoom-level");
const pacerHighlighter = document.getElementById("pacer-highlighter");

// State variables
let pdfDoc = null;
let isFullscreen = false;
let isPacerActive = false;
let currentRotation = 0;
let currentScale = 1.0;
let currentFileName = "Untitled Document";
let renderedPages = [];
let currentPage = 1;
let scrollPosition = 0;
let pageVisibility = {};
let fullscreenPage = null;

// Initialize
function init() {
  // File input handling
  fileInput.addEventListener("change", handleFileSelect);

  // Drag and drop handling
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    uploadArea.addEventListener(eventName, preventDefaults, false);
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    uploadArea.addEventListener(eventName, highlight, false);
  });
  ["dragleave", "drop"].forEach((eventName) => {
    uploadArea.addEventListener(eventName, unhighlight, false);
  });
  uploadArea.addEventListener("drop", handleFileDrop, false);

  // Toolbar events
  closeBtn.addEventListener("click", closePDF);
  fullscreenBtn.addEventListener("click", toggleFullscreen);
  exitFullscreenBtn.addEventListener("click", toggleFullscreen);
  rotateBtn.addEventListener("click", rotateDocument);
  pacerBtn.addEventListener("click", togglePacer);
  colorBtn.addEventListener("click", toggleColorPanel);
  zoomInBtn.addEventListener("click", () => adjustZoom(0.1));
  zoomOutBtn.addEventListener("click", () => adjustZoom(-0.1));

  // Color panel events
  colorOptions.forEach((option) => {
    option.addEventListener("click", () => {
      colorOptions.forEach((opt) => opt.classList.remove("active"));
      option.classList.add("active");
      applyColorFilter(option.dataset.color);
    });
  });

  brightnessSlider.addEventListener("input", updateBrightness);

  // Document events
  document.addEventListener("keydown", handleKeyDown);
  pdfContainer.addEventListener("mousemove", handlePacerMovement);
  pdfContainer.addEventListener("scroll", trackCurrentPage, { passive: true });

  // Fullscreen change listener
  document.addEventListener("fullscreenchange", handleFullscreenChange);

  // Hide color panel when clicking outside
  document.addEventListener("click", (e) => {
    if (!colorBtn.contains(e.target) && !colorPanel.contains(e.target)) {
      colorPanel.classList.remove("active");
    }
  });
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function highlight() {
  uploadArea.style.borderColor = "var(--primary-color)";
  uploadArea.style.backgroundColor = "rgba(74, 107, 255, 0.1)";
}

function unhighlight() {
  uploadArea.style.borderColor = "#ccc";
  uploadArea.style.backgroundColor = "transparent";
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file && file.type === "application/pdf") {
    processFile(file);
  } else {
    alert("Please select a PDF file.");
  }
}

function handleFileDrop(e) {
  const dt = e.dataTransfer;
  const file = dt.files[0];
  if (file && file.type === "application/pdf") {
    processFile(file);
  } else {
    alert("Please drop a PDF file.");
  }
}

function processFile(file) {
  currentFileName = file.name;
  documentTitle.textContent = currentFileName;
  const fileURL = URL.createObjectURL(file);
  loadPDF(fileURL);
}

function loadPDF(url) {
  loadingOverlay.style.display = "flex";
  progressBar.style.width = "0%";
  progressText.textContent = "0%";
  pdfViewer.innerHTML = "";
  renderedPages = [];
  currentPage = 1;
  scrollPosition = 0;
  fullscreenPage = null;

  // Set up loading progress callback
  const loadingTask = pdfjsLib.getDocument({
    url: url,
    withCredentials: false,
  });

  loadingTask.onProgress = (progress) => {
    const percent = Math.round((progress.loaded / progress.total) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
  };

  loadingTask.promise
    .then((doc) => {
      pdfDoc = doc;

      // Render all pages
      const renderPromises = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        renderPromises.push(renderPage(i));
      }

      return Promise.all(renderPromises).then(() => {
        loadingOverlay.style.display = "none";
        uploadContainer.style.display = "none";
        viewerContainer.style.display = "flex";

        // Set up page visibility tracking
        setupPageVisibilityTracking();
      });
    })
    .catch((err) => {
      console.error("Error loading PDF:", err);
      loadingOverlay.style.display = "none";
      alert("Error loading PDF. Please try another file.");
    });
}

function renderPage(pageNum) {
  return pdfDoc.getPage(pageNum).then((page) => {
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const pageContainer = document.createElement("div");
    pageContainer.className = "page-container";
    pageContainer.id = `page-${pageNum}`;

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    pageContainer.appendChild(canvas);
    pdfViewer.appendChild(pageContainer);

    const pageInfo = {
      container: pageContainer,
      canvas: canvas,
      page: page,
      viewport: viewport,
      rotation: currentRotation,
      pageNumber: pageNum,
    };
    renderedPages[pageNum] = pageInfo;

    return renderPageContent(pageInfo);
  });
}

function renderPageContent(pageInfo) {
  const { page, canvas, viewport, rotation } = pageInfo;
  const context = canvas.getContext("2d");

  // Adjust viewport for rotation
  const rotatedViewport = page.getViewport({
    scale: 1.5,
    rotation: rotation,
  });

  canvas.height = rotatedViewport.height;
  canvas.width = rotatedViewport.width;

  return page.render({
    canvasContext: context,
    viewport: rotatedViewport,
  }).promise;
}

function setupPageVisibilityTracking() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.id.split("-")[1]);
          if (!isNaN(pageNum)) {
            currentPage = pageNum;
            pageVisibility[pageNum] = true;
          }
        } else {
          const pageNum = parseInt(entry.target.id.split("-")[1]);
          if (!isNaN(pageNum)) {
            pageVisibility[pageNum] = false;
          }
        }
      });
    },
    { threshold: 0.5 }
  );

  // Observe all page containers
  renderedPages.forEach((pageInfo) => {
    if (pageInfo) {
      observer.observe(pageInfo.container);
    }
  });
}

function trackCurrentPage() {
  scrollPosition = pdfContainer.scrollTop;

  // Find which page is currently most visible
  let mostVisiblePage = 1;
  let maxVisibility = 0;

  for (const pageNum in pageVisibility) {
    if (pageVisibility[pageNum]) {
      const pageElement = document.getElementById(`page-${pageNum}`);
      if (pageElement) {
        const rect = pageElement.getBoundingClientRect();
        const visibility =
          Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        if (visibility > maxVisibility) {
          maxVisibility = visibility;
          mostVisiblePage = parseInt(pageNum);
        }
      }
    }
  }

  currentPage = mostVisiblePage;
}

function closePDF() {
  pdfViewer.innerHTML = "";
  renderedPages = [];
  uploadContainer.style.display = "flex";
  viewerContainer.style.display = "none";

  if (isFullscreen) {
    document.exitFullscreen().catch((err) => {
      console.error("Error exiting fullscreen:", err);
    });
  }

  resetViewerState();
}

function resetViewerState() {
  currentRotation = 0;
  currentScale = 1.0;
  document.documentElement.style.setProperty("--zoom-level", "1");
  zoomLevel.textContent = "100%";
  disablePacer();
}

function handleFullscreenChange() {
  if (!document.fullscreenElement) {
    // Exiting fullscreen
    isFullscreen = false;
    document.body.style.overflow = "";
    exitFullscreenBtn.style.display = "none";
    fullscreenBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    </svg>`;

    // Restore to the page we were viewing in fullscreen
    if (fullscreenPage && renderedPages[fullscreenPage]) {
      setTimeout(() => {
        renderedPages[fullscreenPage].container.scrollIntoView();
        pdfContainer.scrollTop -= 100; // Adjust for header
      }, 50);
    }
    fullscreenPage = null;
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    // Store current page before entering fullscreen
    fullscreenPage = currentPage;

    pdfContainer
      .requestFullscreen()
      .then(() => {
        isFullscreen = true;
        document.body.style.overflow = "hidden";
        exitFullscreenBtn.style.display = "flex";
        fullscreenBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
      </svg>`;

        // Scroll to current page in fullscreen
        if (fullscreenPage && renderedPages[fullscreenPage]) {
          setTimeout(() => {
            renderedPages[fullscreenPage].container.scrollIntoView();
          }, 50);
        }
      })
      .catch((err) => {
        console.error("Error entering fullscreen:", err);
      });
  } else {
    document.exitFullscreen();
  }
}

function rotateDocument() {
  currentRotation = (currentRotation + 90) % 360;

  // Re-render all pages with new rotation
  renderedPages.forEach((pageInfo) => {
    if (pageInfo) {
      pageInfo.rotation = currentRotation;
      renderPageContent(pageInfo);
    }
  });
}

function togglePacer() {
  isPacerActive = !isPacerActive;
  pacerBtn.classList.toggle("active", isPacerActive);
  pacerHighlighter.style.display = isPacerActive ? "block" : "none";

  if (isPacerActive) {
    pacerHighlighter.style.height = `${parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--pacer-height"
      )
    )}px`;
  }
}

function disablePacer() {
  isPacerActive = false;
  pacerBtn.classList.remove("active");
  pacerHighlighter.style.display = "none";
}

function handlePacerMovement(e) {
  if (!isPacerActive) return;

  const containerRect = pdfContainer.getBoundingClientRect();
  const yPos = e.clientY - containerRect.top;

  pacerHighlighter.style.top = `${
    yPos -
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--pacer-height"
      )
    ) /
      2
  }px`;
}

function toggleColorPanel(e) {
  e.stopPropagation();
  colorPanel.classList.toggle("active");
}

function applyColorFilter(color) {
  let bgColor = "#f8f9fa";
  let docBgColor = "#ffffff";
  let overlayColor = "none";

  switch (color) {
    case "sepia":
      bgColor = "#f5ebdf";
      docBgColor = "#f9f5f0";
      overlayColor = "#f3e5d8";
      break;
    case "dark":
      bgColor = "#222";
      docBgColor = "#333";
      overlayColor = "#444";
      break;
    case "blue":
      bgColor = "#e6f0ff";
      docBgColor = "#f0f6ff";
      overlayColor = "#d6e6ff";
      break;
    case "green":
      bgColor = "#e8f5e9";
      docBgColor = "#f1f8f1";
      overlayColor = "#d8edd9";
      break;
    case "pink":
      bgColor = "#ffebee";
      docBgColor = "#fff5f6";
      overlayColor = "#ffdbdf";
      break;
    case "yellow":
      bgColor = "#fff8e1";
      docBgColor = "#fffcf0";
      overlayColor = "#fff3c4";
      break;
    case "purple":
      bgColor = "#f3e5f5";
      docBgColor = "#f9f0fa";
      overlayColor = "#ead5ee";
      break;
    default:
      bgColor = "#f8f9fa";
      docBgColor = "#ffffff";
      overlayColor = "none";
  }

  document.documentElement.style.setProperty("--bg-color", bgColor);
  document.documentElement.style.setProperty("--doc-bg", docBgColor);
  document.documentElement.style.setProperty("--filter-overlay", overlayColor);

  // Explicitly set viewer backgrounds
  document.querySelector(".viewer-container").style.backgroundColor = bgColor;
  document.querySelector(".pdf-container").style.backgroundColor = bgColor;
}

function updateBrightness() {
  const brightnessValue = brightnessSlider.value;
  document.documentElement.style.setProperty(
    "--filter-opacity",
    `${brightnessValue / 100}`
  );
}

function adjustZoom(amount) {
  currentScale = Math.max(0.5, Math.min(2, currentScale + amount));
  document.documentElement.style.setProperty("--zoom-level", currentScale);
  zoomLevel.textContent = `${Math.round(currentScale * 100)}%`;

  // Re-render all pages with new scale
  renderedPages.forEach((pageInfo) => {
    if (pageInfo) {
      const viewport = pageInfo.page.getViewport({
        scale: currentScale * 1.5,
        rotation: pageInfo.rotation,
      });

      pageInfo.canvas.height = viewport.height;
      pageInfo.canvas.width = viewport.width;

      pageInfo.page.render({
        canvasContext: pageInfo.canvas.getContext("2d"),
        viewport: viewport,
      });
    }
  });
}

function handleKeyDown(e) {
  if (e.key === "Escape" && isFullscreen) {
    toggleFullscreen();
  }

  if (e.key === "r" && e.ctrlKey) {
    rotateDocument();
    e.preventDefault();
  }

  if (e.key === "+" && e.ctrlKey) {
    adjustZoom(0.1);
    e.preventDefault();
  }

  if (e.key === "-" && e.ctrlKey) {
    adjustZoom(-0.1);
    e.preventDefault();
  }

  if (e.key === "0" && e.ctrlKey) {
    currentScale = 1.0;
    document.documentElement.style.setProperty("--zoom-level", "1");
    zoomLevel.textContent = "100%";

    renderedPages.forEach((pageInfo) => {
      if (pageInfo) {
        const viewport = pageInfo.page.getViewport({
          scale: 1.5,
          rotation: pageInfo.rotation,
        });

        pageInfo.canvas.height = viewport.height;
        pageInfo.canvas.width = viewport.width;

        pageInfo.page.render({
          canvasContext: pageInfo.canvas.getContext("2d"),
          viewport: viewport,
        });
      }
    });
    e.preventDefault();
  }

  if (e.key === "h" && e.ctrlKey) {
    togglePacer();
    e.preventDefault();
  }
}

// Initialize the app
init();
