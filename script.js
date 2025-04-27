// Set PDF.js worker path
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.12.313/pdf.worker.min.js";

// =====================
// SECURITY CONFIGURATION
// =====================
pdfjsLib.disableTextLayer = true;
pdfjsLib.disableAutoFetch = true;
pdfjsLib.disableFontFace = true;

// Maximum allowed file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
const sidebar = document.getElementById("sidebar");
const sidebarBtn = document.getElementById("sidebar-btn");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarContent = document.getElementById("sidebar-content");
const chapterList = document.getElementById("chapter-list");

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
let isSidebarVisible = false;
let lastScrollPosition = 0;
let readPages = new Set();
let totalPages = 0;

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
  sidebarBtn.addEventListener("click", toggleSidebar);
  sidebarToggle.addEventListener("click", toggleSidebar);

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

// =====================
// SIDEBAR CHAPTER NAVIGATION
// =====================

function toggleSidebar() {
  isSidebarVisible = !isSidebarVisible;
  sidebar.classList.toggle("visible", isSidebarVisible);
  document.body.classList.toggle("sidebar-visible", isSidebarVisible);
}

async function extractChapters(pdfDoc) {
  try {
    const outline = await pdfDoc.getOutline();
    const chapters = [];

    // First try to get outline if it exists
    if (outline && outline.length > 0) {
      for (const item of outline) {
        try {
          let dest = item.dest;
          let pageNumber = 1;

          // Resolve named destinations
          if (typeof dest === "string") {
            const destArray = await pdfDoc.getDestination(dest);
            if (destArray && destArray[0]) {
              pageNumber = destArray[0].num + 1; // PDF.js uses 0-based index
              dest = destArray;
            }
          } else if (Array.isArray(dest)) {
            pageNumber = (dest[0]?.num ?? dest[0]) + 1 || 1;
          }

          // Clean title
          let title = item.title;
          if (title) {
            title = title
              .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
              .replace(/\s+/g, " ")
              .trim();
          }

          chapters.push({
            title: title || "Untitled Chapter",
            dest: dest,
            pageNumber: pageNumber,
          });
        } catch (err) {
          console.warn("Couldn't process chapter:", item, err);
        }
      }
    }

    // If no chapters found in outline, generate them from content
    if (chapters.length === 0) {
      return await generateArtificialChapters(pdfDoc);
    }

    return chapters;
  } catch (error) {
    console.error("Error extracting outline:", error);
    return await generateArtificialChapters(pdfDoc);
  }
}

async function generateArtificialChapters(pdfDoc) {
  const chapters = [];
  const maxPagesToCheck = Math.min(50, pdfDoc.numPages); // Check more pages for better results

  // First pass: look for obvious chapter headings (large text at top of page)
  for (let i = 1; i <= maxPagesToCheck; i++) {
    try {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();

      // Define "top of page" as top 20% of page
      const topThreshold = viewport.height * 0.2;

      // Find the largest text item in the top portion
      let largestText = null;
      let largestSize = 0;

      for (const item of textContent.items) {
        if (item.transform[5] < topThreshold) {
          // Check if in top portion
          const fontSize = Math.max(item.height, item.width);
          if (fontSize > largestSize && item.str.trim().length > 3) {
            largestSize = fontSize;
            largestText = item.str.trim();
          }
        }
      }

      if (largestText && largestSize > 20) {
        // Only consider if text is large enough
        chapters.push({
          title: largestText.substring(0, 100), // Limit title length
          pageNumber: i,
          isArtificial: true,
        });
      }
    } catch (err) {
      console.warn("Error checking page for chapters:", i, err);
    }
  }

  // Fallback: if we didn't find enough chapters, create them based on page numbers
  if (chapters.length < 3) {
    chapters.length = 0; // Clear any found chapters

    // Create chapters every 10 pages or at natural breakpoints
    const chapterInterval = Math.max(5, Math.floor(pdfDoc.numPages / 10));
    for (let i = 1; i <= pdfDoc.numPages; i += chapterInterval) {
      chapters.push({
        title: `Page ${i}`,
        pageNumber: i,
        isArtificial: true,
      });
    }
  }

  // Ensure first page is always included
  if (chapters.length === 0 || chapters[0].pageNumber !== 1) {
    chapters.unshift({
      title: "Page 1",
      pageNumber: 1,
      isArtificial: true,
    });
  }

  return chapters;
}

function renderChapters(chapters) {
  chapterList.innerHTML = "";

  if (!chapters || chapters.length === 0) {
    chapterList.innerHTML = '<li class="chapter-item">No chapters found</li>';
    return;
  }

  chapters.forEach((chapter) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    li.textContent = chapter.title || `Page ${chapter.pageNumber}`;
    li.dataset.pageNumber = chapter.pageNumber;

    li.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await navigateToPage(chapter.pageNumber);
    });

    chapterList.appendChild(li);
  });
}

async function navigateToPage(pageNumber) {
  if (!pdfDoc || pageNumber < 1 || pageNumber > pdfDoc.numPages) return;

  // Ensure page is rendered
  if (!renderedPages[pageNumber]) {
    await renderPage(pageNumber);
  }

  // Get page element
  const pageElement = document.getElementById(`page-${pageNumber}`);
  if (!pageElement) return;

  // Calculate scroll position accounting for header
  const headerHeight = document.querySelector("header").offsetHeight;
  const elementPosition = pageElement.offsetTop;
  const offsetPosition = elementPosition - headerHeight - 20; // 20px buffer

  // Scroll to position
  pdfContainer.scrollTo({
    top: offsetPosition,
    behavior: "smooth",
  });

  // Update current page
  currentPage = pageNumber;
  fullscreenPage = pageNumber;
  updateActiveChapter();
}

function updateActiveChapter() {
  // Remove active class from all chapters
  document.querySelectorAll(".chapter-item").forEach((item) => {
    item.classList.remove("active");
  });

  // Find chapter for current page
  const chapters = document.querySelectorAll(".chapter-item");
  let lastMatchingChapter = null;

  chapters.forEach((chapter) => {
    const chapterPage = parseInt(chapter.dataset.pageNumber);
    if (chapterPage && chapterPage <= currentPage) {
      lastMatchingChapter = chapter;
    }
  });

  // Highlight the nearest chapter before current page
  if (lastMatchingChapter) {
    lastMatchingChapter.classList.add("active");
  }
}

// =====================
// PDF VIEWER FUNCTIONS
// =====================

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
  readPages = new Set();

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
    .then(async (doc) => {
      pdfDoc = doc;
      totalPages = pdfDoc.numPages;
      updateReadCounter();
      console.log(`PDF loaded with ${pdfDoc.numPages} pages`);

      // Extract and render chapters first
      const chapters = await extractChapters(pdfDoc);
      console.log("Extracted chapters:", chapters);
      renderChapters(chapters);

      // Then render all pages
      const renderPromises = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        renderPromises.push(renderPage(i));
      }

      await Promise.all(renderPromises);
      loadingOverlay.style.display = "none";
      uploadContainer.style.display = "none";
      viewerContainer.style.display = "flex";
      setupPageVisibilityTracking();

      // Initial scroll to first page
      await navigateToPage(1);
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

    // Create page number element with checkbox
    const pageNumberElement = document.createElement("div");
    pageNumberElement.className = "page-number";

    // Add checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "read-checkbox";
    checkbox.id = `read-checkbox-${pageNum}`;
    checkbox.addEventListener("change", () =>
      handlePageRead(pageNum, checkbox.checked)
    );

    // Add page number text
    const pageNumberText = document.createElement("span");
    pageNumberText.textContent = pageNum;

    pageNumberElement.appendChild(checkbox);
    pageNumberElement.appendChild(pageNumberText);

    pageContainer.appendChild(canvas);
    pageContainer.appendChild(pageNumberElement);
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

  const rotatedViewport = page.getViewport({
    scale: 1.5 * currentScale,
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
            fullscreenPage = pageNum;
            pageVisibility[pageNum] = true;
            updateActiveChapter();
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

  renderedPages.forEach((pageInfo) => {
    if (pageInfo) {
      observer.observe(pageInfo.container);
    }
  });
}

function trackCurrentPage() {
  scrollPosition = pdfContainer.scrollTop;
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
  fullscreenPage = mostVisiblePage;
  updateActiveChapter();
}

function closePDF() {
  pdfViewer.innerHTML = "";
  renderedPages = [];
  uploadContainer.style.display = "flex";
  viewerContainer.style.display = "none";
  readPages = new Set();
  updateReadCounter();

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
    isFullscreen = false;
    document.body.style.overflow = "";
    exitFullscreenBtn.style.display = "none";
    fullscreenBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    </svg>`;

    // Restore scroll position after exiting fullscreen
    setTimeout(() => {
      if (fullscreenPage && renderedPages[fullscreenPage]) {
        navigateToPage(fullscreenPage);
      }
    }, 100);
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    // Store current page before entering fullscreen
    fullscreenPage = currentPage;
    lastScrollPosition = pdfContainer.scrollTop;

    pdfContainer
      .requestFullscreen()
      .then(() => {
        isFullscreen = true;
        document.body.style.overflow = "hidden";
        exitFullscreenBtn.style.display = "flex";
        fullscreenBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
      </svg>`;

        // Scroll to current page in fullscreen mode
        setTimeout(() => {
          if (fullscreenPage && renderedPages[fullscreenPage]) {
            const pageElement = document.getElementById(
              `page-${fullscreenPage}`
            );
            if (pageElement) {
              pageElement.scrollIntoView({ behavior: "instant" });
            }
          }
        }, 100);
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

// =====================
// PAGE READ TRACKING
// =====================

function handlePageRead(pageNum, isRead) {
  if (isRead) {
    readPages.add(pageNum);
    createFireworkEffect(document.getElementById(`read-checkbox-${pageNum}`));
    updateReadCounter();
    celebrateIfAllRead();
  } else {
    readPages.delete(pageNum);
    updateReadCounter();
  }
}

function updateReadCounter() {
  const readCountElement = document.getElementById("read-count");
  const totalPagesElement = document.getElementById("total-pages");
  const counterElement = document.getElementById("read-counter");

  readCountElement.textContent = readPages.size;
  totalPagesElement.textContent = totalPages || pdfDoc?.numPages || 0;

  // Add highlight effect when count increases
  counterElement.classList.add("highlight");
  setTimeout(() => counterElement.classList.remove("highlight"), 1000);
}

function createFireworkEffect(element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  for (let i = 0; i < 12; i++) {
    const firework = document.createElement("div");
    firework.className = "firework";
    firework.style.left = `${centerX}px`;
    firework.style.top = `${centerY}px`;
    firework.style.backgroundColor = getRandomColor();

    // Random direction and distance
    const angle = Math.random() * Math.PI * 2;
    const distance = 30 + Math.random() * 50;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    firework.style.setProperty("--x", `${x}px`);
    firework.style.setProperty("--y", `${y}px`);

    document.body.appendChild(firework);

    // Remove after animation
    setTimeout(() => firework.remove(), 1000);
  }
}

function getRandomColor() {
  const colors = [
    "#4a6bff",
    "#ff6b6b",
    "#6bff6b",
    "#ffff6b",
    "#ff6bff",
    "#6bffff",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function celebrateIfAllRead() {
  if (pdfDoc && readPages.size === pdfDoc.numPages) {
    // Create a bigger celebration
    for (let i = 0; i < 30; i++) {
      setTimeout(() => {
        const x = Math.random() * window.innerWidth;
        const y = Math.random() * window.innerHeight;
        createFireworkAtPosition(x, y);
      }, i * 100);
    }

    // Update counter with special style
    const counter = document.getElementById("read-counter");
    counter.style.backgroundColor = "#4a6bff";
    counter.style.color = "white";
    counter.style.fontWeight = "bold";
    counter.style.animation = "counterPulse 0.5s 3";
  }
}

function createFireworkAtPosition(x, y) {
  const firework = document.createElement("div");
  firework.className = "firework";
  firework.style.left = `${x}px`;
  firework.style.top = `${y}px`;
  firework.style.width = "8px";
  firework.style.height = "8px";
  firework.style.backgroundColor = getRandomColor();

  const angle = Math.random() * Math.PI * 2;
  const distance = 50 + Math.random() * 100;
  const xDist = Math.cos(angle) * distance;
  const yDist = Math.sin(angle) * distance;

  firework.style.setProperty("--x", `${xDist}px`);
  firework.style.setProperty("--y", `${yDist}px`);

  document.body.appendChild(firework);
  setTimeout(() => firework.remove(), 1000);
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
