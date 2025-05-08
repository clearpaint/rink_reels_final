// script.js
/*****************************************************************
 * GLOBAL STATE (Including SAM2)
 *****************************************************************/
let editorMode = 'normal';   // can be 'normal' or 'sam2'
let sam2Tool   = null;       // 'click' or 'box'
let sam2Session = null;      // object to store subclip data in SAM2 mode
let segmentationPanelLoaded = false;
let isBottomPanelExpanded = false;
/*****************************************************************
 * VIDEO EDITOR FUNCTIONALITY
 *****************************************************************/
let currentVideoPath = null;
let timelineTagsData = [];
let videoDuration = 0;
let draggingHandle = null;
let selectionStart = 0;
let selectionEnd = 0;

// Drawing state arrays with timestamp tracking
let drawnElements = [];         // General drawings
let homographyElements = [];    // Halo overlays from homography tool

// Drawing state variables for general drawing
let currentTool = 'pointer'; // pointer, pen, square, polygon, text, circle, homography
let isDrawing = false;
let lastX = 0, lastY = 0;
let startX, startY;
let currentTextElement = null;
let currentPolygonPoints = [];

// Variables for homography tool
let currentHomographyBox = null;
let homographyDrawing = false;
let draggingHomographyIndex = null;
let homographyDragOffset = { x: 0, y: 0 };
let editingHomographyIndex = null;
let defaultHomographyRingColor = "#ffffff";
let defaultHomographySpotlightColor = "#ffffff";

let zoomLevel = 1;
let zoomOffsetX = 0;
let zoomOffsetY = 0;
let isPanning = false;
let panStartX = 0, panStartY = 0;

const videoPlayer = document.getElementById("videoPlayer");
const canvas = document.getElementById("drawCanvas");
const ctx = canvas.getContext("2d");
const videoContainer = document.querySelector('.video-container');

// For touch pinch zoom
let pinchStartDistance = null;
let pinchStartZoom = null;

// temporary in-progress line
let connectionTempPoints = [];

// dragging state for connection lines
// { elementIndex: 0-based in drawnElements or null for temp, pointIndex }
let draggingConnection = null;

function toggleBottomPanel() {
  const panel = document.getElementById('segmentationPanel');
  isBottomPanelExpanded = !isBottomPanelExpanded;

  if (isBottomPanelExpanded) {
    panel.classList.remove('collapsed');
    panel.classList.add('expanded');
    if (!segmentationPanelLoaded) {
      loadSegmentationContent();
    }
  } else {
    panel.classList.remove('expanded');
    panel.classList.add('collapsed');
  }
}
function loadSegmentationContent() {
  const iframe = document.getElementById('segmentationFrame');
  iframe.onload = function() {
    segmentationPanelLoaded = true;
  };
  iframe.src = iframe.src; // Reload the iframe
}

  function reloadSegmentationContent(event) {
    // Prevent the parent panel's click from also toggling:
    event.stopPropagation();

    const iframe = document.getElementById('segmentationIframe');
    const baseSrc = 'index_2.html';  // Adjust if located elsewhere
    // Add a timestamp parameter to ensure a fresh reload:
    iframe.src = baseSrc + '?_t=' + Date.now();
  }
/*****************************************************************
 * showSpinner / Socket Setup
 *****************************************************************/
function showSpinner(visible) {
  document.getElementById("exportSpinner").style.display = visible ? "inline-block" : "none";
}

let socketOpened = false;
const socket = new WebSocket("ws://localhost:8765");
const pendingMessages = [];
socket.addEventListener("open", () => {
  console.log("[CLIENT] WebSocket connected");
  pendingMessages.forEach(msg => socket.send(msg));
  pendingMessages.length = 0;
  // On connect, fetch the stored videos
  sendSocketMessage("fetchVideos", { videoDBPath: "videos.json" });
});

/*****************************************************************
 * SOCKET MESSAGES
 *****************************************************************/
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  console.log("[CLIENT] Received:", msg);

  // 1) Export progress or final
  if (msg.type === "exportProgress") {
    showSpinner(true);
    if (msg.message) {
      showToast(`[Export Progress] ${msg.message} (${msg.progress || 0}%)`);
    }
  }
  else if (msg.type === "exportResult") {
    showSpinner(false);
    showToast(`Export done: ${msg.message}`);
  }
  else if (msg.type === "error") {
    showSpinner(false);
    showToast("Error: " + msg.message);
  }

  // 2) Standard stuff
  if (msg.type === "videoList") {
    updateVideoList(msg.videos);
  } else if (msg.type === "tagList") {
    updateTagList(msg.tags);
  } else if (msg.type === "whistleEvents") {
    const autoTags = msg.events.map(ev => ({
      name: ev.label || "Whistle",
      startSec: ev.time,
      endSec: ev.time + 1,
      color: getRandomMutedColor(),
      timestamp: Date.now()
    }));
    timelineTagsData = [...timelineTagsData, ...autoTags];
    renderSidebarTags();
    renderTimelineTags();
    showToast(`Added ${autoTags.length} whistle tag(s)`);
  }

  /*****************************************************************
   * SAM2: Subclip => first frame => user picks click/box => propagate
   *****************************************************************/
  else if (msg.type === "segmentationReady") {
    // Subclip extracted, first frame is ready
    showSpinner(false);
    showToast("Subclip ready. Mark your object.");

    editorMode = 'sam2';
    sam2Tool   = null; // user picks 'click' or 'box'
    sam2Session = {
      firstFrameB64: msg.firstFrame,
      outputPath: msg.outputPath,
      currentOverlayB64: msg.firstFrame
    };

    // Hide the normal video
    videoPlayer.pause();
    videoPlayer.style.display = 'none';

    // Optionally show a 'segmentationPanel' (on the right side)
    document.getElementById('segmentationPanel').style.display = 'block';

    // Display the first frame on the same canvas
    displaySAM2Frame(msg.firstFrame);
    loadSegmentationView();
  }
  else if (msg.type === "maskUpdate") {
    // Updated partial mask overlay
    showSpinner(false);
    if (sam2Session) {
      sam2Session.currentOverlayB64 = msg.overlay;
      displaySAM2Frame(msg.overlay);
    }
  }
  else if (msg.type === "segmentationComplete") {
    // Final done
    showSpinner(false);
    Swal.fire({
      background: '#2f2f2f',
      color: '#ffffff',
      title: 'Segmentation Complete',
      text: `Saved to ${msg.outputPath}`,
      icon: 'success'
    });
    showToast(`Segmentation Complete => ${msg.outputPath}`);
    restoreNormalEditor();
  }
  else if (msg.type === "progress") {
    // Could display a progress bar or spinner
    showToast(msg.msg || `Progress: ${msg.percent || 0}%`);
  }
  else if (msg.type === "toast") {
    showToast(msg.message);
  }
});

socket.addEventListener("close", () => {
  showToast(socket.readyState === WebSocket.OPEN
    ? "WebSocket disconnected"
    : "WebSocket not connected");
});
socket.addEventListener("error", () => {
  showToast("WebSocket error");
});

/*****************************************************************
 * HELPER: Display SAM2 frame on existing canvas
 *****************************************************************/
function displaySAM2Frame(base64Image) {
  const tempImg = new Image();
  tempImg.onload = function() {
    // Resize canvas to match the subclip’s first frame
    canvas.width = tempImg.width;
    canvas.height = tempImg.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tempImg, 0, 0);
  };
  tempImg.src = base64Image;
}

/*****************************************************************
 * UTILITY FUNCTIONS (Video Editor)
 *****************************************************************/
function showToast(msg) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast show bg-success text-white p-2 mb-2";
  toast.style.position = "relative";
  toast.innerHTML = `<div class="toast-body">${msg}</div>`;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3000);
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
}

function getRandomMutedColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 50%, 50%)`;
}

function toFileURL(rawPath) {
  if (!rawPath) return "";
  let path = rawPath.replace(/\\/g, "/");
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  return "file://" + encodeURI(path);
}

function sendSocketMessage(action, payload = {}) {
  if (!action) return;
  const json = JSON.stringify({ action, ...payload });
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(json);
  } else {
    console.log(`[CLIENT] WS not open, queueing ${action}`);
    pendingMessages.push(json);
  }
}

/*****************************************************************
 * SIDEBAR & LAYOUT (Video Editor)
 *****************************************************************/
// script.js or inside a <script> tag
let inactivityTimerId = null;
let inactivityDelayMs = 5000; // 5 seconds of no activity => auto-hide

function showSidebar(sidebarId) {
  const sidebar = document.getElementById(sidebarId);
  sidebar.classList.remove('collapsed');

  // Start watching for inactivity
  startInactivityTimer(sidebarId);
}

function hideSidebar(sidebarId) {
  const sidebar = document.getElementById(sidebarId);
  sidebar.classList.add('collapsed');
  stopInactivityTimer(); // no need to watch for inactivity if hidden
}

function toggleSidebar(sidebarId) {
  const sidebar = document.getElementById(sidebarId);
  if (sidebar.classList.contains('collapsed')) {
    showSidebar(sidebarId);
  } else {
    hideSidebar(sidebarId);
  }
}

function startInactivityTimer(sidebarId) {
  // Clear any previous timer
  stopInactivityTimer();

  // When the timer finishes, hide the sidebar
  inactivityTimerId = setTimeout(() => {
    hideSidebar(sidebarId);
  }, inactivityDelayMs);

  // Optionally, you could watch for mousemove or keypress to reset the timer:
  document.addEventListener('mousemove', resetInactivityTimer, { once: true });
  document.addEventListener('keydown', resetInactivityTimer, { once: true });
}

function stopInactivityTimer() {
  if (inactivityTimerId) {
    clearTimeout(inactivityTimerId);
    inactivityTimerId = null;
  }
}

function resetInactivityTimer() {
  // If the sidebar is open, restart the inactivity timer
  // (Use whichever ID you want to close after inactivity; if you have multiple,
  //  you could pass them as parameters or handle them individually.)
  const sidebarId = 'tagPanel'; // or 'videoPanel', etc.

  // Clear the old timer
  stopInactivityTimer();

  // Start a new one
  inactivityTimerId = setTimeout(() => {
    hideSidebar(sidebarId);
  }, inactivityDelayMs);

  // Listen again for next activity
  document.addEventListener('mousemove', resetInactivityTimer, { once: true });
  document.addEventListener('keydown', resetInactivityTimer, { once: true });
}

function updateMainContentSize() {
  const leftPanel = document.getElementById("videoPanel");
  const rightPanel = document.getElementById("tagPanel");
  const mainContent = document.getElementById("mainContent");
  const leftWidth = leftPanel.classList.contains("collapsed") ? 0 : 250;
  const rightWidth = rightPanel.classList.contains("collapsed") ? 0 : 250;
  const availableWidth = window.innerWidth - leftWidth - rightWidth;
  mainContent.style.width = availableWidth + "px";
  mainContent.style.marginLeft = leftWidth + "px";
  mainContent.style.marginRight = rightWidth + "px";
}
window.addEventListener("resize", updateMainContentSize);

/*****************************************************************
 * VIDEO LIST & ADDING VIDEOS (Video Editor)
 *****************************************************************/
function toggleVideoForm() {
  const form = document.getElementById("addVideoForm");
  const btn = document.getElementById("toggleVideoFormBtn");
  if (form.style.display === "none") {
    form.style.display = "block";
    btn.innerHTML = '<i class="fa-solid fa-minus"></i>';
  } else {
    form.style.display = "none";
    btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  }
}
// We'll store the real file path here after the user picks the file
  let selectedPath = null;

  /**
   * Intercept the <input type="file"> click event.
   * We show Electron's file dialog (via preload) and store the real path.
   */
  async function onFileInputClick(event) {
    event.preventDefault();
    event.stopPropagation();

    // Show OS file dialog through Electron (exposed by your preload)
    const chosenFilePath = await window.electronAPI.openFileDialog({
      filters: [{ name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv'] }]
    });

    if (chosenFilePath) {
      selectedPath = chosenFilePath;

      // Update the label to show the user what was selected
      const labelEl = document.getElementById("selectedFileLabel");
      labelEl.textContent = chosenFilePath; // or just the filename if you prefer

      // Optional toast/notification
      showToast(`Selected file: ${chosenFilePath}`);
    } else {
      showToast("No file selected / dialog canceled");
    }
  }

  async function addVideo() {
    const fileInput = document.getElementById("videoInput");
    const videoNameInput = document.getElementById("videoName");

    // Validate user input
    if (!selectedPath || !videoNameInput.value.trim()) {
      Swal.fire({
        background: '#2f2f2f',
        color: '#ffffff',
        icon: 'error',
        title: 'Missing Input',
        text: 'Please select a video and enter a name!'
      });
      return;
    }

    const videoObj = {
      id: Date.now(),
      name: videoNameInput.value.trim(),
      filePath: selectedPath, // The actual OS path from Electron
      liked: false,
      timestamp: Date.now()
    };

    // Send to your Python server over WebSocket
    sendSocketMessage("addVideo", { video: videoObj });

    // Clear UI
    drawnElements = [];
    homographyElements = [];
    redrawCanvas();

    fileInput.value = "";
    videoNameInput.value = "";
    selectedPath = null;

    // Reset the label
    document.getElementById("selectedFileLabel").textContent = "No file chosen";

    toggleVideoForm();
  }

async function addVideo_o() {
  const fileInput = document.getElementById("videoInput");
  const videoNameInput = document.getElementById("videoName");
  if (!fileInput.files.length || !videoNameInput.value.trim()) {
    Swal.fire({
      background: '#2f2f2f',
      color: '#ffffff',
      icon: 'error',
      title: 'Missing Input',
      text: 'Please select a video and enter a name!'
    });
    return;
  }
  const videoFile = fileInput.files[0];
  let absolutePath = videoFile.path;
  if (!absolutePath || absolutePath === videoFile.name) {
    showToast("Unable to retrieve absolute path in browser environment");
  }
  const videoObj = {
    id: Date.now(),
    name: videoNameInput.value.trim(),
    filePath: absolutePath,
    liked: false,
    timestamp: Date.now()
  };
  sendSocketMessage("addVideo", { video: videoObj });
  drawnElements = [];
  homographyElements = [];
  redrawCanvas();
  fileInput.value = "";
  videoNameInput.value = "";
  toggleVideoForm();
}

function updateVideoList(videos) {
  const videoListElem = document.getElementById("videoList");
  videoListElem.innerHTML = "";
  videos.forEach((video) => {
    const videoItem = document.createElement("div");
    videoItem.className = "video-item";
    videoItem.innerHTML = `
      <span class="video-name" title="${video.name}">${video.name}</span>
      <div class="video-buttons">
        <button class="favorite">
          <i class="fa-solid fa-heart${video.liked ? " active" : ""}"></i>
        </button>
        <button class="edit">
          <i class="fa-solid fa-cog"></i>
        </button>
        <button class="delete">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
    videoItem.addEventListener("click", () => {
      currentVideoPath = video.filePath;
      videoPlayer.src = toFileURL(video.filePath);
      document.getElementById("videoTitle").textContent = video.name;
      drawnElements = [];
      homographyElements = [];
      redrawCanvas();
      sendSocketMessage("fetchTags", { videoPath: currentVideoPath });
    });
    videoItem.querySelector(".favorite").addEventListener("click", (e) => {
      e.stopPropagation();
      sendSocketMessage("toggleHeart", { videoId: video.id });
    });
    videoItem.querySelector(".delete").addEventListener("click", (e) => {
      e.stopPropagation();
      Swal.fire({
        background: '#2f2f2f',
        color: '#ffffff',
        title: 'Are you sure?',
        text: "Are you sure you want to delete this video?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
      }).then((result) => {
        if (result.isConfirmed) {
          sendSocketMessage("removeVideo", { videoId: video.id });
        }
      });
    });
    videoItem.querySelector(".edit").addEventListener("click", (e) => {
      e.stopPropagation();
      Swal.fire({
        background: '#2f2f2f',
        color: '#ffffff',
        title: 'Edit Video Name',
        input: 'text',
        inputValue: video.name,
        showCancelButton: true,
        confirmButtonText: 'Save',
        cancelButtonText: 'Cancel'
      }).then((result) => {
        if (result.isConfirmed && result.value && result.value.trim() !== "") {
          video.name = result.value.trim();
          sendSocketMessage("editVideo", { video });
        }
      });
    });
    videoListElem.appendChild(videoItem);
  });
}

/*****************************************************************
 * TAGGING SYSTEM (Video Editor)
 *****************************************************************/
function updateTagList(tags) {
  timelineTagsData = tags.map((tag) => {
    if (!tag.color) tag.color = getRandomMutedColor();
    return { ...tag, isSelected: false, rangeEditing: false, domElement: null };
  });
  renderSidebarTags();
  renderTimelineTags();
}
function addTag() {
  const tagInput = document.getElementById("tagInput");
  const presetSelect = document.getElementById("presetTags");
  let tagValue = tagInput.value.trim() || presetSelect.value.trim();
  if (!tagValue) return;
  if (selectionStart === selectionEnd) {
    Swal.fire({
      background: '#2f2f2f',
      color: '#ffffff',
      icon: 'error',
      title: 'Invalid Range',
      text: 'Please select a time range on the timeline first!'
    });
    return;
  }
  const newTag = {
    name: tagValue,
    startSec: selectionStart,
    endSec: selectionEnd,
    timestamp: Date.now()
  };
  sendSocketMessage("addTag", { videoPath: currentVideoPath, tag: newTag });
  tagInput.value = "";
  presetSelect.value = "";
}
function renderSidebarTags() {
  const tagListElem = document.getElementById("tagList");
  tagListElem.innerHTML = "";
  timelineTagsData.forEach((tag, index) => {
    const displayText = `${tag.name} (${formatTime(tag.startSec)} - ${formatTime(tag.endSec)})`;
    const tagItem = document.createElement("div");
    tagItem.className = "tag-item";
    tagItem.setAttribute("data-tag-index", index);
    tagItem.setAttribute("data-start-sec", tag.startSec);
    tagItem.setAttribute("data-end-sec", tag.endSec);
    tagItem.style.borderLeft = `8px solid ${tag.color}`;
    tagItem.innerHTML = `
      <input type="checkbox" class="tag-select">
      <span class="tag-display" title="${displayText}">${displayText}</span>
      <div class="tag-buttons">
        <button class="editNameBtn"><i class="fa-solid fa-pen"></i></button>
        <button class="editRangeBtn"><i class="fa-solid fa-arrows-left-right-to-line"></i></button>
        <button class="delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    tagItem.querySelector(".editNameBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      Swal.fire({
        background: '#2f2f2f',
        color: '#ffffff',
        title: 'Edit Tag Name',
        input: 'text',
        inputValue: tag.name,
        showCancelButton: true,
        confirmButtonText: 'Save',
        cancelButtonText: 'Cancel'
      }).then((result) => {
        if(result.isConfirmed && result.value && result.value.trim()) {
          const updatedTag = { ...tag, name: result.value.trim() };
          sendSocketMessage("editTag", {
            videoPath: currentVideoPath,
            tagIndex: index,
            tag: updatedTag
          });
        }
      });
    });
    tagItem.querySelector(".editRangeBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!tag.rangeEditing) {
        timelineTagsData.forEach((t) => (t.rangeEditing = false));
        tag.rangeEditing = true;
        selectionStart = tag.startSec;
        selectionEnd = tag.endSec;
        updateTimelineHandles();
        showToast(`Editing range for "${tag.name}". Drag handles or scrub the video.`);
      } else {
        const updatedTag = { ...tag, startSec: selectionStart, endSec: selectionEnd, rangeEditing: false };
        sendSocketMessage("editTag", {
          videoPath: currentVideoPath,
          tagIndex: index,
          tag: updatedTag
        });
      }
    });
    tagItem.querySelector(".delete").addEventListener("click", (e) => {
      e.stopPropagation();
      Swal.fire({
        background: '#2f2f2f',
        color: '#ffffff',
        title: 'Are you sure?',
        text: "Are you sure you want to delete this tag?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
      }).then((result) => {
        if(result.isConfirmed) {
          sendSocketMessage("removeTag", {
            videoPath: currentVideoPath,
            tagIndex: index
          });
        }
      });
    });
    tagItem.addEventListener("click", (e) => {
      e.stopPropagation();
      timelineTagsData.forEach((t) => (t.isSelected = false));
      tag.isSelected = true;
      renderTimelineTags();
      videoPlayer.currentTime = tag.startSec;
    });
    tagListElem.appendChild(tagItem);
  });
}
function renderTimelineTags() {
  const timelineTagsEl = document.getElementById("timelineTags");
  timelineTagsEl.innerHTML = "";
  const width = timelineContainer.offsetWidth;
  timelineTagsData.forEach((tag) => {
    const startPx = (tag.startSec / videoDuration) * width;
    const endPx = (tag.endSec / videoDuration) * width;
    const left = Math.min(startPx, endPx);
    const tagW = Math.abs(endPx - startPx);
    const tagDiv = document.createElement("div");
    tagDiv.className = "timeline-tag";
    if (tag.isSelected) tagDiv.classList.add("selected");
    tagDiv.style.left = left + "px";
    tagDiv.style.width = Math.max(2, tagW) + "px";
    tagDiv.style.backgroundColor = tag.color;
    tagDiv.addEventListener("click", (evt) => {
      evt.stopPropagation();
      timelineTagsData.forEach((t) => (t.isSelected = false));
      tag.isSelected = true;
      renderTimelineTags();
      videoPlayer.currentTime = tag.startSec || 0;
    });
    timelineTagsEl.appendChild(tagDiv);
    tag.domElement = tagDiv;
  });
}

/*****************************************************************
 * TIMELINE & PLAYER BAR
 *****************************************************************/
const timelineContainer = document.getElementById("timelineContainer");
const selectionEl = document.getElementById("selection");
const handleStartEl = document.getElementById("handleStart");
const handleEndEl = document.getElementById("handleEnd");
const playerPlayPause = document.getElementById("playerPlayPause");
const playerBarTime = document.getElementById("playerBarTime");
const playerBarProgressContainer = document.getElementById("playerBarProgressContainer");
const playerBarProgressFill = document.getElementById("playerBarProgressFill");
const playerBarProgressDot = document.getElementById("playerBarProgressDot");

videoPlayer.addEventListener("loadedmetadata", () => {
  videoDuration = videoPlayer.duration || 0;
  selectionStart = 0;
  selectionEnd = 0;
  drawnElements = [];
  homographyElements = [];
  currentPolygonPoints = [];
  document.querySelectorAll('.draggable-text').forEach(el => el.remove());
  updateTimelineHandles();
  resizeCanvas();
});
videoPlayer.addEventListener("timeupdate", () => {
  const cTime = videoPlayer.currentTime;
  const dur = videoPlayer.duration || 0;
  playerBarTime.textContent = formatTime(cTime);
  const percent = dur ? (cTime / dur) * 100 : 0;
  playerBarProgressFill.style.width = percent + "%";

  const editingTag = timelineTagsData.find((t) => t.rangeEditing);
  if (editingTag && !draggingHandle) {
    if (cTime < editingTag.startSec) {
      selectionStart = cTime;
      selectionEnd = editingTag.endSec;
    } else if (cTime > editingTag.endSec) {
      selectionEnd = cTime;
      selectionStart = editingTag.startSec;
    } else {
      const distToStart = Math.abs(cTime - editingTag.startSec);
      const distToEnd = Math.abs(cTime - editingTag.endSec);
      if (distToStart < distToEnd) {
        selectionStart = cTime;
        selectionEnd = editingTag.endSec;
      } else {
        selectionEnd = cTime;
        selectionStart = editingTag.startSec;
      }
    }
    updateTimelineHandles();
  }
});

function togglePlayPause() {
  if (videoPlayer.paused) {
    videoPlayer.play();
      document
    .querySelector('[data-btn-id="eraser"]')
    .dispatchEvent(new Event('click'));
    playerPlayPause.classList.remove("fa-play");
    playerPlayPause.classList.add("fa-pause");
  } else {
    videoPlayer.pause();
    playerPlayPause.classList.remove("fa-pause");
    playerPlayPause.classList.add("fa-play");
  }
}
playerPlayPause.addEventListener("click", togglePlayPause);

document.getElementById("playerStepBack").addEventListener("click", () => {
  videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5);
});
document.getElementById("playerStepForward").addEventListener("click", () => {
  videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 5);
});
document.getElementById("playerBackward").addEventListener("click", () => {
  videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
});
document.getElementById("playerMute").addEventListener("click", (e) => {
  videoPlayer.muted = !videoPlayer.muted;
  if (videoPlayer.muted) {
    e.target.classList.remove("fa-volume-mute");
    e.target.classList.add("fa-volume-up");
  } else {
    e.target.classList.add("fa-volume-mute");
    e.target.classList.remove("fa-volume-up");
  }
});
const playerSpeed = document.getElementById("playerSpeed");
playerSpeed.addEventListener("click", () => {
  let newRate = 1;
  switch (videoPlayer.playbackRate) {
    case 1: newRate = 1.5; break;
    case 1.5: newRate = 2; break;
    case 2: newRate = 0.5; break;
    default: newRate = 1; break;
  }
  videoPlayer.playbackRate = newRate;
  playerSpeed.textContent = "x" + newRate;
});
videoContainer.addEventListener("click", (evt) => {
  if (currentTool === 'pointer' && zoomLevel === 1 && evt.target === videoPlayer) {
    togglePlayPause();
  }
});
document.addEventListener("keydown", (e) => {
  // skip if we're editing text
  if (document.activeElement && document.activeElement.isContentEditable) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlayPause();
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    videoPlayer.currentTime = Math.max(videoPlayer.currentTime - 5, 0);
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    videoPlayer.currentTime = Math.min(videoPlayer.currentTime + 5, videoPlayer.duration);
  } else if (e.code === "KeyM") {
    videoPlayer.muted = !videoPlayer.muted;
  }
});
playerBarProgressContainer.addEventListener("click", (e) => {
  const rect = playerBarProgressContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const width = rect.width;
  const dur = videoPlayer.duration || 0;
  videoPlayer.currentTime = (clickX / width) * dur;
});

/*****************************************************************
 * TIMELINE HANDLES
 *****************************************************************/
function updateTimelineHandles() {
  const width = timelineContainer.offsetWidth;
  const startX = (selectionStart / videoDuration) * width;
  const endX = (selectionEnd / videoDuration) * width;
  handleStartEl.style.left = startX + "px";
  handleEndEl.style.left = endX + "px";
  selectionEl.style.left = Math.min(startX, endX) + "px";
  selectionEl.style.width = Math.abs(endX - startX) + "px";
  renderTimelineTags();
}
function onHandleMouseMove(e) {
  if (!draggingHandle) return;
  const rect = timelineContainer.getBoundingClientRect();
  let xPos = e.clientX - rect.left;
  xPos = Math.max(0, Math.min(timelineContainer.offsetWidth, xPos));
  const newSec = (xPos / timelineContainer.offsetWidth) * videoDuration;
  if (draggingHandle === "start") {
    selectionStart = Math.min(newSec, selectionEnd);
    videoPlayer.currentTime = selectionStart;
  } else {
    selectionEnd = Math.max(newSec, selectionStart);
    videoPlayer.currentTime = selectionEnd;
  }
  updateTimelineHandles();
}
function onHandleMouseUp() {
  draggingHandle = null;
  document.removeEventListener("mousemove", onHandleMouseMove);
  document.removeEventListener("mouseup", onHandleMouseUp);
}
handleStartEl.addEventListener("mousedown", () => {
  draggingHandle = "start";
  document.addEventListener("mousemove", onHandleMouseMove);
  document.addEventListener("mouseup", onHandleMouseUp);
});
handleEndEl.addEventListener("mousedown", () => {
  draggingHandle = "end";
  document.addEventListener("mousemove", onHandleMouseMove);
  document.addEventListener("mouseup", onHandleMouseUp);
});

/*****************************************************************
 * DRAWING CANVAS RESIZE & COORDINATE MAPPING
 *****************************************************************/
// ─── around line ~375 in script.js ─────────────────────────────
function resizeCanvas() {
  if (editorMode === 'sam2') return;

  // 1) record old size
  const oldW = canvas.width;
  const oldH = canvas.height;

  // 2) compute new target size
  const newW = videoContainer.clientWidth;
  const newH = videoContainer.clientHeight;

  // avoid division by zero
  if (oldW === 0 || oldH === 0) {
    canvas.width  = newW;
    canvas.height = newH;
    return redrawCanvas();
  }

  const scaleX = newW / oldW;
  const scaleY = newH / oldH;

  // 3) scale all drawnElements
  drawnElements.forEach(el => {
    switch (el.type) {
      case 'pen':
      case 'polygon':
      case 'connectionLine':
        el.points.forEach(p => { p.x *= scaleX; p.y *= scaleY; });
        break;
      case 'vectorSquare':
        el.points.forEach(p => { p.x *= scaleX; p.y *= scaleY; });
        break;
      case 'square':
      case 'rectangle':
        el.x      *= scaleX;
        el.y      *= scaleY;
        el.width  *= scaleX;
        el.height *= scaleY;
        break;
      case 'circle':
        el.x      *= scaleX;
        el.y      *= scaleY;
        // scale radius by the smaller factor to keep it roughly circular
        el.radius *= Math.min(scaleX, scaleY);
        break;
      case 'text':
        el.x *= scaleX;
        el.y *= scaleY;
        break;
    }
  });

  // 4) scale any in-progress/poly points
  currentPolygonPoints.forEach(p => { p.x *= scaleX; p.y *= scaleY; });
  connectionTempPoints.forEach(p      => { p.x *= scaleX; p.y *= scaleY; });

  // 5) scale homography boxes & rings
  homographyElements.forEach(h => {
    // box corners
    h.box.startX *= scaleX;
    h.box.startY *= scaleY;
    h.box.endX   *= scaleX;
    h.box.endY   *= scaleY;
    // ring center
    h.ringCenter.x *= scaleX;
    h.ringCenter.y *= scaleY;
  });

  // 6) finally resize and redraw
  canvas.width  = newW;
  canvas.height = newH;
  redrawCanvas();
}
// ────────────────────────────────────────────────────────────────

window.addEventListener("resize", resizeCanvas);
videoPlayer.addEventListener("play", resizeCanvas)
{
    document
    .querySelector('[data-btn-id="eraser"]')
    .dispatchEvent(new Event('click'));
  // still resize if you need to
  resizeCanvas();
};
videoPlayer.addEventListener("loadeddata", resizeCanvas);

/*****************************************************************
 * ZOOM & PAN
 *****************************************************************/
function updateZoomTransform() {
  videoPlayer.style.transform = `scale(${zoomLevel}) translate(${zoomOffsetX}px, ${zoomOffsetY}px)`;
  canvas.style.transform = `scale(${zoomLevel}) translate(${zoomOffsetX}px, ${zoomOffsetY}px)`;
}
function applyZoom() {
  updateZoomTransform();
}
videoContainer.addEventListener('mousedown', (e) => {
  if (currentTool === 'pointer' && zoomLevel > 1) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    e.preventDefault();
  }
});
videoContainer.addEventListener('mousemove', (e) => {
  if (isPanning) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    zoomOffsetX += dx / zoomLevel;
    zoomOffsetY += dy / zoomLevel;
    panStartX = e.clientX;
    panStartY = e.clientY;
    updateZoomTransform();
  }
});
videoContainer.addEventListener('mouseup', () => { isPanning = false; });
videoContainer.addEventListener('mouseleave', () => { isPanning = false; });
videoContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    zoomLevel -= e.deltaY * 0.001;
    zoomLevel = Math.max(0.5, Math.min(2, zoomLevel));
    updateZoomTransform();
  } else {
    zoomOffsetX -= e.deltaX / zoomLevel;
    zoomOffsetY -= e.deltaY / zoomLevel;
    updateZoomTransform();
  }
});
videoContainer.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchStartDistance = Math.sqrt(dx * dx + dy * dy);
    pinchStartZoom = zoomLevel;
  }
});
videoContainer.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && pinchStartDistance) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const newDistance = Math.sqrt(dx * dx + dy * dy);
    const scale = newDistance / pinchStartDistance;
    zoomLevel = pinchStartZoom * scale;
    updateZoomTransform();
  }
});
videoContainer.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    pinchStartDistance = null;
    pinchStartZoom = null;
  }
});
function resetView() {
  zoomLevel = 1;
  zoomOffsetX = 0;
  zoomOffsetY = 0;
  updateZoomTransform();
  showToast("View reset to normal");
}

/*****************************************************************
 * TOOL BUTTONS & DRAWING
 *****************************************************************/
function highlightActiveTool(toolId) {
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.querySelector(`[data-btn-id="${toolId}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
}
function setupToolButtons() {
  document.querySelector('[data-btn-id="mag-minus"]').addEventListener('click', () => {
    if (zoomLevel > 0.5) {
      zoomLevel -= 0.1;
      applyZoom();
    }
  });
  document.querySelector('[data-btn-id="mag-plus"]').addEventListener('click', () => {
    if (zoomLevel < 2) {
      zoomLevel += 0.1;
      applyZoom();
    }
  });
  document.querySelector('[data-btn-id="reset-view"]').addEventListener('click', resetView);
  document.querySelector('[data-btn-id="mouse-pointer"]').addEventListener('click', () => {
    currentTool = 'pointer';
    canvas.style.cursor = 'default';
    highlightActiveTool('mouse-pointer');
  });
  document.querySelector('[data-btn-id="pen"]').addEventListener('click', () => {
    currentTool = 'pen';
    canvas.style.cursor = 'crosshair';
    highlightActiveTool('pen');
  });
  document.querySelector('[data-btn-id="vector-square"]').addEventListener('click', () => {
    currentTool = 'square';
    canvas.style.cursor = 'crosshair';
    highlightActiveTool('vector-square');
    //currentPolygonPoints = [];
    redrawCanvas();
  });
  // Project Diagram → connectionLine mode
  document.querySelector('[data-btn-id="project-diagram"]').addEventListener('click', () => {
    currentTool = 'connectionLine';
    canvas.style.cursor = 'crosshair';
    highlightActiveTool('project-diagram');
    // start fresh
   // connectionTempPoints = [];
    redrawCanvas();
  });
  document.querySelector('[data-btn-id="draw-polygon"]').addEventListener('click', () => {
    currentTool = 'polygon';
    canvas.style.cursor = 'crosshair';
    highlightActiveTool('draw-polygon');
    //currentPolygonPoints = [];
    redrawCanvas();
  });
  document.querySelector('[data-btn-id="comment"]').addEventListener('click', () => {
    currentTool = 'text';
    canvas.style.cursor = 'text';
    highlightActiveTool('comment');
  });
  document.querySelector('[data-btn-id="circle-notch"]').addEventListener('click', () => {
    currentTool = 'circle';
    canvas.style.cursor = 'crosshair';
    highlightActiveTool('circle-notch');
  });
document.querySelector('[data-btn-id="eraser"]').addEventListener('click', () => {
  // 1) Clear all stored shapes
  drawnElements = [];
  homographyElements = [];

  // 2) Reset any in-progress polygon or rectangle
  currentPolygonPoints = [];

  // 3) Reset connection-line state
  connectionTempPoints = [];
  draggingConnection   = null;

  // 4) Kill any half-drawn shapes
  isDrawing            = false;
  homographyDrawing    = false;
  currentHomographyBox = null;

  // 5) Remove any floating text inputs
  document.querySelectorAll('.draggable-text').forEach(el => el.remove());

  // 6) Redraw the (now empty) canvas
  redrawCanvas();
});
  document.querySelector('[data-btn-id="undo"]').addEventListener('click', undoLast);
  document.querySelector('[data-btn-id="camera"]').addEventListener('click', takeScreenshot);
  document.querySelector('[data-btn-id="set-homography"]').addEventListener('click', () => {
    currentTool = 'homography';
    canvas.style.cursor = 'crosshair';
    highlightActiveTool('set-homography');
  });
}

/*****************************************************************
 * CANVAS DRAWING HANDLERS (Integrated with SAM2)
 *****************************************************************/
canvas.addEventListener('mousedown', (e) => {
  // SAM2 mode
  if (editorMode === 'sam2') {
    if (sam2Tool === 'click') {
      // user is in "click" prompt mode
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      // Shift/right-click => negative label
      const label = (e.button === 2 || e.shiftKey) ? 0 : 1;
      showSpinner(true);
      sendSocketMessage('addSAM2Click', { x, y, label });
    }
    else if (sam2Tool === 'box') {
      // user is in "box" prompt mode: track mouseDown => store start coords
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      sam2Session.boxStart = { x, y };
    }
    // If user hasn't chosen a SAM2 tool, do nothing
    return;
  }

  // Normal editor mode below
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  if (currentTool === 'homography') {
    if(e.button === 2) return; // ignore right-click for homography
    for (let i = 0; i < homographyElements.length; i++) {
      const elem = homographyElements[i];
      const ring = elem.ringCenter;
      const dx = x - ring.x, dy = y - ring.y;
      if (Math.sqrt(dx*dx + dy*dy) < 20) {
        draggingHomographyIndex = i;
        homographyDragOffset = { x: dx, y: dy };
        return;
      }
    }
    homographyDrawing = true;
    currentHomographyBox = {
      startX: x, startY: y,
      endX: x, endY: y,
      timestamp: Date.now()
    };
    return;
  }
  if (currentTool === 'polygon' || currentTool === 'vectorSquare') {
    currentPolygonPoints.push({ x, y });
    redrawCanvas();
    return;
  }
  if (currentTool === 'pen') {
    isDrawing = true;
    lastX = x;
    lastY = y;
    drawnElements.push({
      type: 'pen',
      points: [{ x, y }],
      color: '#00ff9f',
      width: 3,
      timestamp: Date.now()
    });
  }
  else if (currentTool === 'text') {
    createTextInput(x, y);
  }
  else if (currentTool === 'square' || currentTool === 'circle') {
    isDrawing = true;
    startX = x;
    startY = y;
  }
  else if (currentTool === 'connectionLine')
  {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top)  * scaleY;
  const thresh = 6;

  // 1) Are we clicking on an existing temp‐point?
  for (let i = 0; i < connectionTempPoints.length; i++) {
    const p = connectionTempPoints[i];
    if (Math.hypot(p.x - x, p.y - y) < thresh) {
      draggingConnection = { elementIndex: null, pointIndex: i };
      return;
    }
  }

  // 2) Are we clicking on a stored connectionLine endpoint?
  for (let ei = 0; ei < drawnElements.length; ei++) {
    const el = drawnElements[ei];
    if (el.type !== 'connectionLine') continue;
    for (let pi = 0; pi < el.points.length; pi++) {
      const p = el.points[pi];
      if (Math.hypot(p.x - x, p.y - y) < thresh) {
        draggingConnection = { elementIndex: ei, pointIndex: pi };
        return;
      }
    }
  }

  // 3) Otherwise start/add a new point
  connectionTempPoints.push({ x, y });
  redrawCanvas();
  return;
}
});

canvas.addEventListener('mousemove', (e) => {
  // SAM2 + box => ephemeral rectangle
  if (editorMode === 'sam2' && sam2Tool === 'box' && sam2Session && sam2Session.boxStart) {
    if (sam2Session.currentOverlayB64) {
      // re-draw the last overlay
      displaySAM2Frame(sam2Session.currentOverlayB64);
      ctx.save();
      ctx.strokeStyle = 'yellow';
      ctx.lineWidth = 2;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const bx = sam2Session.boxStart.x;
      const by = sam2Session.boxStart.y;
      ctx.strokeRect(bx, by, x - bx, y - by);
      ctx.restore();
    }
    return;
  }

  // Normal mode:
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  if (currentTool === 'connectionLine' && draggingConnection) {
    const { elementIndex, pointIndex } = draggingConnection;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top ) * scaleY;

    if (elementIndex === null) {
      connectionTempPoints[pointIndex] = { x, y };
    } else {
      drawnElements[elementIndex].points[pointIndex] = { x, y };
    }
    redrawCanvas();
    return;
  }
  if (currentTool === 'homography') {
    // drag ring center or draw ephemeral rect
    if (draggingHomographyIndex !== null) {
      const elem = homographyElements[draggingHomographyIndex];
      elem.ringCenter.x = x - homographyDragOffset.x;
      elem.ringCenter.y = y - homographyDragOffset.y;
      redrawCanvas();
      return;
    }
    if (homographyDrawing && currentHomographyBox) {
      currentHomographyBox.endX = x;
      currentHomographyBox.endY = y;
      redrawCanvas();
      ctx.save();
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 2;
      const minX = Math.min(currentHomographyBox.startX, currentHomographyBox.endX);
      const minY = Math.min(currentHomographyBox.startY, currentHomographyBox.endY);
      const w = Math.abs(currentHomographyBox.endX - currentHomographyBox.startX);
      const h = Math.abs(currentHomographyBox.endY - currentHomographyBox.startY);
      ctx.strokeRect(minX, minY, w, h);
      ctx.restore();
      return;
    }
  }
  if (currentTool === 'pen' && isDrawing) {
    const stroke = drawnElements[drawnElements.length - 1];
    stroke.points.push({ x, y });
    drawSegment(lastX, lastY, x, y, stroke.color, stroke.width);
    lastX = x;
    lastY = y;
  }
  else if ((currentTool === 'square' || currentTool === 'circle') && isDrawing) {
    redrawCanvas();
    drawShapePreview(x, y);
  }
});

canvas.addEventListener('mouseup', (e) => {
  // SAM2 + box => finalize bounding box
  if (editorMode === 'sam2' && sam2Tool === 'box' && sam2Session && sam2Session.boxStart) {
    showSpinner(true);
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const bx = sam2Session.boxStart.x;
    const by = sam2Session.boxStart.y;
    sam2Session.boxStart = null;
    sendSocketMessage('addSAM2Box', {
      x1: Math.min(bx, x),
      y1: Math.min(by, y),
      x2: Math.max(bx, x),
      y2: Math.max(by, y)
    });
    return;
  }

  if (currentTool === 'connectionLine' && draggingConnection) {
    draggingConnection = null;
    return;
  }
  // Normal mode:
  if (currentTool === 'homography') {
    if (homographyDrawing && currentHomographyBox) {
      const b = currentHomographyBox;
      const minX = Math.min(b.startX, b.endX);
      const maxX = Math.max(b.startX, b.endX);
      const minY = Math.min(b.startY, b.endY);
      const maxY = Math.max(b.startY, b.endY);
      const ringCenter = { x: (minX + maxX) / 2, y: maxY };
      homographyElements.push({
        box: b,
        ringCenter,
        ringColor: defaultHomographyRingColor,
        spotlightColor: defaultHomographySpotlightColor,
        timestamp: Date.now()
      });
      homographyDrawing = false;
      currentHomographyBox = null;
      redrawCanvas();
      return;
    }
    if (draggingHomographyIndex !== null) {
      draggingHomographyIndex = null;
      return;
    }
  }
  if (currentTool === 'pen') {
    isDrawing = false;
  }
  else if (currentTool === 'square' || currentTool === 'circle') {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    if (currentTool === 'square') {
      drawnElements.push({
        type: 'square',
        x: Math.min(startX, x),
        y: Math.min(startY, y),
        width: Math.abs(x - startX),
        height: Math.abs(y - startY),
        color: '#00ff9f',
        lineWidth: 2,
        timestamp: Date.now()
      });
    } else {
      const radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
      drawnElements.push({
        type: 'circle',
        x: startX,
        y: startY,
        radius,
        color: '#00ff9f',
        lineWidth: 2,
        timestamp: Date.now()
      });
    }
    isDrawing = false;
    redrawCanvas();
  }
});
canvas.addEventListener('mouseleave', () => {
  if (currentTool === 'pen') {
    isDrawing = false;
  }
});
canvas.addEventListener("contextmenu", (e) => {
  if (currentTool === 'homography') {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    for (let i = 0; i < homographyElements.length; i++) {
      const elem = homographyElements[i];
      const ring = elem.ringCenter;
      const dx = x - ring.x, dy = y - ring.y;
      if (Math.sqrt(dx*dx + dy*dy) < 20) {
        e.preventDefault();
        editingHomographyIndex = i;
        document.getElementById("homographyDropdownRingColor").value = elem.ringColor;
        document.getElementById("homographyDropdownSpotlightColor").value = elem.spotlightColor;
        const menu = document.getElementById("homographyContextMenu");
        menu.style.left = e.pageX + "px";
        menu.style.top = e.pageY + "px";
        menu.style.display = "block";
        return;
      }
    }
  }
});
document.getElementById("homographyDropdownSaveBtn").addEventListener("click", () => {
  if (editingHomographyIndex !== null) {
    const newRingColor = document.getElementById("homographyDropdownRingColor").value;
    const newSpotlightColor = document.getElementById("homographyDropdownSpotlightColor").value;
    homographyElements[editingHomographyIndex].ringColor = newRingColor;
    homographyElements[editingHomographyIndex].spotlightColor = newSpotlightColor;
    editingHomographyIndex = null;
    redrawCanvas();
    hideHomographyContextMenu();
  }
});
function hideHomographyContextMenu() {
  document.getElementById("homographyContextMenu").style.display = "none";
}
document.addEventListener("click", (e) => {
  const menu = document.getElementById("homographyContextMenu");
  if (menu && !menu.contains(e.target)) {
    hideHomographyContextMenu();
  }
});
canvas.addEventListener('dblclick', (e) => {
  if (currentTool === 'polygon') {
    if (currentPolygonPoints.length >= 3) {
      drawnElements.push({
        type: 'polygon',
        points: [...currentPolygonPoints],
        color: '#00ff9f',
        timestamp: Date.now()
      });
      currentPolygonPoints = [];
      redrawCanvas();
    }
  } else if (currentTool === 'vectorSquare') {
    if (currentPolygonPoints.length >= 2) {
      drawnElements.push({
        type: 'vectorSquare',
        points: [...currentPolygonPoints],
        color: '#00ff9f',
        timestamp: Date.now()
      });
      currentPolygonPoints = [];
      redrawCanvas();
    }
      else if (currentTool === 'connectionLine' && connectionTempPoints.length >= 2) {
    drawnElements.push({
      type:      'connectionLine',
      points:    [...connectionTempPoints],
      color:     '#00ff9f',
      lineWidth: 2,
      timestamp: Date.now()
    });
    connectionTempPoints = [];
    redrawCanvas();
  }
  }
});

/*****************************************************************
 * DRAWING HELPER FUNCTIONS (General)
 *****************************************************************/
function createTextInput(x, y) {
  let initialText = '';
  const textElem = document.createElement('div');
  textElem.className = 'draggable-text';
  textElem.contentEditable = true;
  textElem.innerText = initialText;
  textElem.style.position = 'absolute';
  textElem.style.left = x + 'px';
  textElem.style.top = y + 'px';
  textElem.style.minWidth = '100px';
  textElem.style.minHeight = '20px';
  textElem.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  textElem.style.color = '#00ff9f';
  textElem.style.padding = '5px';
  textElem.style.border = '1px solid #00ff9f';
  textElem.style.outline = 'none';
  textElem.style.zIndex = '1000';

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  document.querySelector('.video-container').appendChild(textElem);
  textElem.addEventListener('mousedown', (e) => {
    if (textElem.contentEditable === "false") {
      isDragging = true;
      dragOffsetX = e.clientX - textElem.offsetLeft;
      dragOffsetY = e.clientY - textElem.offsetTop;
      e.preventDefault();
    }
  });
  function onMouseMove(e) {
    if (isDragging) {
      textElem.style.left = (e.clientX - dragOffsetX) + 'px';
      textElem.style.top = (e.clientY - dragOffsetY) + 'px';
    }
  }
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
  textElem.addEventListener('blur', () => {
    if (textElem.textContent.trim() !== '') {
      textElem.contentEditable = "false";
    }
  });
  textElem.addEventListener('dblclick', () => {
    textElem.contentEditable = "true";
    setTimeout(() => textElem.focus(), 0);
  });
  document.querySelector('.video-container').appendChild(textElem);
  setTimeout(() => { textElem.focus(); }, 0);

  return textElem;
}

function drawSegment(x1, y1, x2, y2, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function drawShapePreview(x, y) {
  ctx.strokeStyle = '#00ff9f';
  ctx.lineWidth = 2;
  if (currentTool === 'square') {
    ctx.strokeRect(
      Math.min(startX, x),
      Math.min(startY, y),
      Math.abs(x - startX),
      Math.abs(y - startY)
    );
  } else if (currentTool === 'circle') {
    const radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
    ctx.beginPath();
    ctx.arc(startX, startY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
    else if (currentTool === 'vectorSquare' && currentPolygonPoints.length >= 2) {
    // TWO‐POINT rectangle preview
    const [p1, p2] = currentPolygonPoints;
    const rx = Math.min(p1.x, p2.x);
    const ry = Math.min(p1.y, p2.y);
    const rw = Math.abs(p2.x - p1.x);
    const rh = Math.abs(p2.y - p1.y);
    ctx.strokeRect(rx, ry, rw, rh);
  }
}
function drawElement(ctx, element) {
  ctx.save();

  // set up styles
  ctx.lineWidth   = element.lineWidth ?? element.width  ?? 2;
  ctx.strokeStyle = element.color     ?? '#00ff9f';
  ctx.fillStyle   = element.fillColor ?? element.color  ?? '#00ff9f';
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  switch (element.type) {
    // ----------------------------------------------------------------
    // 1) freehand pen strokes
    // ----------------------------------------------------------------
    case 'pen': {
      if (!element.points || element.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(element.points[0].x, element.points[0].y);
      for (let i = 1; i < element.points.length; i++) {
        ctx.lineTo(element.points[i].x, element.points[i].y);
      }
      ctx.stroke();
      break;
    }

    // ----------------------------------------------------------------
    // 2) axis-aligned rectangle / square
    // ----------------------------------------------------------------
    case 'square':
    case 'rectangle': {
      const { x, y, width, height, fill } = element;
      if ([x,y,width,height].every(v => typeof v === 'number')) {
        if (fill) ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
      }
      break;
    }

    // ----------------------------------------------------------------
    // 3) vectorSquare defined by two corner points
    // ----------------------------------------------------------------
    case 'vectorSquare': {
      const pts = element.points;
      if (pts && pts.length >= 2) {
        const [p1,p2] = pts;
        const x = Math.min(p1.x, p2.x),
              y = Math.min(p1.y, p2.y),
              w = Math.abs(p2.x - p1.x),
              h = Math.abs(p2.y - p1.y);
        if (element.fill) ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      break;
    }

    // ----------------------------------------------------------------
    // 4) circle / ring
    // ----------------------------------------------------------------
    case 'circle': {
      const { x, y, radius, fill } = element;
      if ([x,y,radius].every(v => typeof v === 'number')) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2*Math.PI);
        if (fill) ctx.fill();
        ctx.stroke();
      }
      break;
    }

    // ----------------------------------------------------------------
    // 5) open or closed polygon
    // ----------------------------------------------------------------
    case 'polygon': {
      const pts = element.points;
      if (pts && pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        if (element.closed) ctx.closePath();
        if (element.fill)  ctx.fill();
        ctx.stroke();
      }
      break;
    }

    // ----------------------------------------------------------------
    // 6) simple line with an arrowhead
    // ----------------------------------------------------------------
    case 'connectionLine': {
      const pts = element.points;
      if (!pts || pts.length < 2) break;

      // draw polyline
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();

      // draw a dot at each node
      pts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, 2*Math.PI);
        ctx.fill();
      });
      break;
    }


    // ----------------------------------------------------------------
    // 7) projectDiagram (alias to polygon for now)
    // ----------------------------------------------------------------
    case 'projectDiagram': {
      // fallback to same logic as polygon
      element.type = 'polygon';
      drawElement(ctx, element);
      break;
    }

    // ----------------------------------------------------------------
    // 8) plain text
    // ----------------------------------------------------------------
    case 'text': {
      const { x, y, text, font } = element;
      if (typeof x === 'number' && typeof y === 'number' && text) {
        ctx.font      = font || '16px Arial';
        ctx.textBaseline = 'top';
        ctx.fillText(text, x, y);
      }
      break;
    }

    default:
      // unknown type: no-op
      break;
  }

  ctx.restore();
}

function drawElementold(ctx, element) {
  ctx.lineWidth   = element.lineWidth || element.width || 2;
  ctx.strokeStyle = element.color || '#00ff9f';
  ctx.fillStyle   = element.color || '#00ff9f';
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  switch (element.type) {
    case 'pen': {
      if (!element.points || !element.points.length) return;
      ctx.beginPath();
      ctx.moveTo(element.points[0].x, element.points[0].y);
      for (let i = 1; i < element.points.length; i++) {
        ctx.lineTo(element.points[i].x, element.points[i].y);
      }
      ctx.stroke();
      break;
    }
    case 'square':
    case 'rectangle':
    case 'vectorSquare': {
      // figure out our box coords & size
      let x, y, w, h;

      // 1) If you already stored x/ y/ width/ height on the element
      if (
        typeof element.x      === 'number' &&
        typeof element.y      === 'number' &&
        typeof element.width  === 'number' &&
        typeof element.height === 'number'
      ) {
        x = element.x;
        y = element.y;
        w = element.width;
        h = element.height;
      }
      // 2) Otherwise fall back to the two points
      else if (element.points && element.points.length >= 2) {
        const [p1, p2] = element.points;
        x = Math.min(p1.x, p2.x);
        y = Math.min(p1.y, p2.y);
        w = Math.abs(p2.x - p1.x);
        h = Math.abs(p2.y - p1.y);
      } else {
        break;
      }

      // optional fill
      if (element.fill) {
        ctx.fillRect(x, y, w, h);
      }
      // stroke outline
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'circle': {
      if (typeof element.x === 'number' && typeof element.y === 'number' && typeof element.radius === 'number') {
        ctx.beginPath();
        ctx.arc(element.x, element.y, element.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'polygon':
    case 'connectionLine':
    case 'projectDiagram': {
      if (!element.points || element.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(element.points[0].x, element.points[0].y);
      for (let i = 1; i < element.points.length; i++) {
        ctx.lineTo(element.points[i].x, element.points[i].y);
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      if (typeof element.x === 'number' && typeof element.y === 'number' && element.text) {
        ctx.font = '16px Arial';
        ctx.fillText(element.text, element.x, element.y);
      }
      break;
    }
    default:
      break;
  }
}
function redrawCanvas() {
  // 1) clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 2) draw all committed shapes
  drawnElements.forEach(element => {
    drawElement(ctx, element);
  });

  // 3) live polygon/vectorSquare preview (anytime there are points)
  if (currentPolygonPoints.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#00ff9f';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(currentPolygonPoints[0].x, currentPolygonPoints[0].y);
    for (let i = 1; i < currentPolygonPoints.length; i++) {
      ctx.lineTo(currentPolygonPoints[i].x, currentPolygonPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 4) live connectionLine preview (anytime there are points)
  if (connectionTempPoints.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#00ff9f';
    ctx.fillStyle   = '#00ff9f';
    ctx.lineWidth   = 2;

    // draw the line/polyline
    ctx.beginPath();
    ctx.moveTo(connectionTempPoints[0].x, connectionTempPoints[0].y);
    for (let i = 1; i < connectionTempPoints.length; i++) {
      ctx.lineTo(connectionTempPoints[i].x, connectionTempPoints[i].y);
    }
    ctx.stroke();

    // draw the draggable end-points
    connectionTempPoints.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
      ctx.fill();
    });
    ctx.restore();
  }

  // 5) homography overlays, etc.
  homographyElements.forEach(elem => {
    drawHaloAndSpotlight(ctx, elem.ringCenter, elem.ringColor, elem.spotlightColor);
  });
}

/*****************************************************************
 * UNDO FUNCTION
 *****************************************************************/
function undoLast() {
  let lastGeneral = drawnElements.length ? drawnElements[drawnElements.length - 1] : null;
  let lastHalo = homographyElements.length ? homographyElements[homographyElements.length - 1] : null;
  if (!lastGeneral && !lastHalo) return;
  if (lastGeneral && lastHalo) {
    if (lastGeneral.timestamp > lastHalo.timestamp) {
      drawnElements.pop();
    } else {
      homographyElements.pop();
    }
  } else if (lastGeneral) {
    drawnElements.pop();
  } else {
    homographyElements.pop();
  }
  redrawCanvas();
}

/*****************************************************************
 * SCREENSHOT (Video Editor)
 *****************************************************************/
function takeScreenshot() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');

  // 1) Video frame
  tempCtx.drawImage(videoPlayer, 0, 0, canvas.width, canvas.height);
  // 2) stored shapes
  drawnElements.forEach(element => {
    drawElement(tempCtx, element);
  });
  // 3) homography overlays
  homographyElements.forEach(elem => {
    drawHaloAndSpotlight(tempCtx, elem.ringCenter, elem.ringColor, elem.spotlightColor);
  });
  // 4) text
  const canvasRect = canvas.getBoundingClientRect();
  document.querySelectorAll('.draggable-text').forEach(textEl => {
    const text = textEl.textContent.trim();
    if (!text) return;
    const textRect = textEl.getBoundingClientRect();
    const relativeX = textRect.left - canvasRect.left;
    const relativeY = textRect.top  - canvasRect.top;
    tempCtx.font      = '16px Arial';
    tempCtx.fillStyle = '#00ff9f';
    tempCtx.fillText(text, relativeX, relativeY + 16);
  });
  tempCanvas.toBlob((blob) => {
    const link = document.createElement('a');
    link.download = `screenshot-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
  }, 'image/png');
}

/*****************************************************************
 * ACTION BUTTONS (Video Editor)
 *****************************************************************/
function detectAudioEvents() {
  if (!currentVideoPath) {
    showToast("Load a video first");
    return;
  }
  sendSocketMessage("detectWhistles", {
    videoPath: currentVideoPath
  });
  showToast("Running whistle detector…");
}

async function exportTags() {
  // existing code for multiple/single file export
  // ...
  const selectedCheckboxes = document.querySelectorAll(".tag-select:checked");
  if (!selectedCheckboxes.length) {
    await Swal.fire({
      background: '#2f2f2f',
      color: '#ffffff',
      icon: 'error',
      title: 'No Tags Selected',
      text: 'Please select one or more tags to export.'
    });
    return;
  }
  const selectedTags = [];
  selectedCheckboxes.forEach((checkbox) => {
    const parent = checkbox.closest(".tag-item");
    const startSec = parseFloat(parent.getAttribute("data-start-sec") || "0");
    const endSec   = parseFloat(parent.getAttribute("data-end-sec") || "0");
    const tagNameEl = parent.querySelector(".tag-display");
    const tagName = tagNameEl ? tagNameEl.textContent : "tag";
    selectedTags.push({ startSec, endSec, name: tagName });
  });

  const result = await Swal.fire({
    background: '#2f2f2f',
    color: '#ffffff',
    title: 'Export Tags',
    text: 'Multiple clips or single concatenated video?',
    showCancelButton: true,
    cancelButtonText: 'Cancel',
    confirmButtonText: 'Multiple Clips',
    denyButtonText: 'Single File',
    showDenyButton: true,
    reverseButtons: true
  });
  if (result.isDismissed) return;

  let folderPath = await window.electronAPI.openDirectoryDialog();
  if (!folderPath) return;

  let payload = {
    videoPath: currentVideoPath,
    clips: [],
    concatenate: false,
    concatOutput: '',
    destinationFolder: folderPath
  };
  if (result.isConfirmed) {
    let formHtml = '';
    selectedTags.forEach((tag, i) => {
      const safeName = tag.name.replace(/[^\w\d_-]+/g,'_') || `clip_${i}`;
      formHtml += `
        <div class="mb-2">
          <label>${tag.name} [${formatTime(tag.startSec)}–${formatTime(tag.endSec)}]</label><br/>
          <input id="clip_name_${i}" class="swal2-input" style="width:80%" value="${safeName}.mp4" />
        </div>
      `;
    });
    const renameResult = await Swal.fire({
      background: '#2f2f2f',
      color: '#ffffff',
      title: 'Clip Filenames',
      html: formHtml,
      showCancelButton: true,
      focusConfirm: false,
      preConfirm: () => {
        const names = [];
        selectedTags.forEach((_, i) => {
          const val = (document.getElementById(`clip_name_${i}`) || {}).value?.trim();
          if (!val) {
            Swal.showValidationMessage("All filenames must be specified!");
          }
          names.push(val);
        });
        return names;
      }
    });
    if (!renameResult.value) return;

    selectedTags.forEach((tag, i) => {
      payload.clips.push({
        startSec: tag.startSec,
        endSec:   tag.endSec,
        filename: renameResult.value[i]
      });
    });
    payload.concatenate = false;
  } else if (result.isDenied) {
    const singleRes = await Swal.fire({
      background: '#2f2f2f',
      color: '#ffffff',
      title: 'Single Output Filename',
      input: 'text',
      inputValue: 'combined.mp4',
      showCancelButton: true
    });
    if (!singleRes.value) {
      return;
    }
    payload.concatenate = true;
    payload.concatOutput = singleRes.value.trim();
    selectedTags.forEach(tag => {
      payload.clips.push({
        startSec: tag.startSec,
        endSec:   tag.endSec
      });
    });
  }
  document.getElementById("exportSpinner").style.display = "inline-block";
  showToast("Export started…");
  sendSocketMessage("exportTags", payload);
}



/*****************************************************************
 * SAM2 HELPER: Start "Propagate"
 *****************************************************************/
function startSAM2Propagation() {
  if (editorMode !== 'sam2' || !sam2Session) return;
  showSpinner(true);
  showToast("Propagating across all frames...");
  sendSocketMessage('propagateSAM2', {
    outputPath: sam2Session.outputPath
  });
}

/*****************************************************************
 * SAM2 HELPER: Return to normal editor
 *****************************************************************/
function restoreNormalEditor() {
  editorMode = 'normal';
  sam2Tool   = null;
  sam2Session = null;
  document.getElementById('segmentationPanel').style.display = 'none';

  // Show normal video again
  videoPlayer.style.display = '';
}

/*****************************************************************
 * SAM2 HELPER: Switch to "click" or "box" in SAM2
 *****************************************************************/
function enableSAM2ClickMode() {
  sam2Tool = 'click';
  showToast("SAM2: Click Mode (Shift/right=negative).");
}
function enableSAM2BoxMode() {
  sam2Tool = 'box';
  showToast("SAM2: Box Mode (drag a bounding box).");
}

/*****************************************************************
 * INIT & HOMOGRAPHY
 *****************************************************************/
function init() {
  updateMainContentSize();
  setupToolButtons();
  // Default to pointer tool
  document.querySelector('[data-btn-id="mouse-pointer"]').click();

  // Hook up "Upload" label => hidden file input
  const uploadLabel = document.getElementById("action-upload");
  const videoUploaderFirst = document.getElementById("videoUploaderFirst");
  uploadLabel.addEventListener("click", () => {
    videoUploaderFirst.click();
  });
  videoUploaderFirst.addEventListener("change", () => {
    const file = videoUploaderFirst.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("image/")) {
      videoPlayer.style.display = "none";
      const img = new Image();
      img.onload = () => {
        resizeCanvas();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = url;
    } else {
      videoPlayer.style.display = "block";
      videoPlayer.src = url;
      videoPlayer.load();
    }
  });
}
document.addEventListener('DOMContentLoaded', init);

/*****************************************************************
 * HOMOGRAPHY DRAWING FUNCTIONS
 *****************************************************************/
function drawHaloAndSpotlight(ctx, center, ringColor, spotlightColor) {
  const cx = center.x, cy = center.y;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, 40, 15, 0, 0, 2*Math.PI);
  ctx.strokeStyle = hexToRgba(ringColor, 0.8);
  ctx.lineWidth   = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx, cy, 28, 10, 0, 0, 2*Math.PI);
  ctx.strokeStyle = hexToRgba(ringColor, 0.9);
  ctx.lineWidth   = 4;
  ctx.stroke();
  ctx.restore();
  drawVerticalSpotlight(ctx, cx, cy, spotlightColor);
}
function drawVerticalSpotlight(ctx, cx, cy, spotlightColor) {
  const rgb = hexToRgb(spotlightColor);
  const gradient = ctx.createLinearGradient(0, 0, 0, cy);
  gradient.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.0)`);
  gradient.addColorStop(0.1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`);
  gradient.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.0)`);

  const beamWidth = 80;
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.rect(cx - beamWidth/2, 0, beamWidth, cy);
  ctx.clip();
  ctx.fillRect(cx - beamWidth/2, 0, beamWidth, cy);
  ctx.restore();
}
function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function hexToRgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// Save original HTML for dynamic project stuff
const mainContentElem         = document.getElementById('mainContent');
const originalMainContentHTML = mainContentElem.innerHTML;
let   currentProjectId        = null;

function showProjects() {
  document.getElementById('videoWrapper').style.display = 'none';
  mainContentElem.style.position = 'relative';
  const iframe = document.createElement('iframe');
  iframe.id  = 'projectsFrame';
  iframe.src = 'projects.html';
  Object.assign(iframe.style, {
    position: 'absolute',
    left:     '0',
    width:    '100%',
    border:   'none'
  });
  function resizeIframe() {
    const navH = document.querySelector('.navbar').offsetHeight;
    iframe.style.top    = `${navH}px`;
    iframe.style.height = `${window.innerHeight - navH}px`;
  }
  window.addEventListener('resize', resizeIframe);
  resizeIframe();
  mainContentElem.appendChild(iframe);
}
function onProjectSelected(projectId) {
  currentProjectId = projectId;
  const iframe = document.getElementById('projectsFrame');
  if (iframe) iframe.remove();
  mainContentElem.innerHTML = originalMainContentHTML;
  init();
  updateMainContentSize();
  const videoDB = `videos_${projectId}.json`;
  sendSocketMessage('fetchVideos', { projectId, videoDBPath: videoDB });
}

function openSegmentationPanel() {
  const panel = document.getElementById('segmentationPanel');
  const mainContent = document.getElementById('mainContent');
  const returnBtn = document.getElementById('returnToVideoBtn');

  // Show the panel by adding .full-screen
  panel.classList.add('full-screen');

  // Hide the main content (so the panel takes over entire page)
  if (mainContent) mainContent.style.display = 'none';

  // Show the Return button
  if (returnBtn) returnBtn.style.display = 'inline-block';

  // Optionally load or reload the iframe
  loadSegmentationIframe();
}

/**
 * Hide the segmentation panel, show the main content again
 */
function returnToVideoView() {
  const panel = document.getElementById('segmentationPanel');
  const mainContent = document.getElementById('mainContent');
  const returnBtn = document.getElementById('returnToVideoBtn');

  // Remove .full-screen from panel, so it's hidden (display:none from CSS)
  panel.classList.remove('full-screen');
  panel.style.display = 'none'; // ensures it doesn't remain visible

  // Show main content again
  if (mainContent) mainContent.style.display = '';

  // Hide the return button
  if (returnBtn) returnBtn.style.display = 'none';
}

/**
 * Reload or refresh the iframe content if needed
 */
function loadSegmentationIframe() {
  const iframe = document.getElementById('segmentationIframe');
  if (!iframe) return;

  // onload callback
  iframe.onload = () => {
    console.log("Segmentation iframe loaded!");
  };

  // Force reload if it already has a src
  // This reassigns the same src to refresh
  iframe.src = iframe.src;
}

/**
 * If you keep a "maximize" button in the panel header, ensure you call
 * toggleMaximizePanel(event) from the button.
 * e.g. in HTML: onclick="toggleMaximizePanel(event)"
 */
let panelIsMaximized = false;
function toggleMaximizePanel(event) {
  // If you see "Cannot read properties of undefined (reading 'stopPropagation')"
  // it means you didn't pass 'event' from the HTML. So ensure:
  //   <button onclick="toggleMaximizePanel(event)">...</button>
  event.stopPropagation(); // prevents click from collapsing panel if you have that logic

  const panel = document.getElementById('segmentationPanel');
  if (!panel) return;

  if (!panelIsMaximized) {
    // Make it bigger or fill screen
    panel.style.height = '90vh';
    panelIsMaximized = true;
  } else {
    // Revert to original
    panel.style.height = '';
    panelIsMaximized = false;
  }
}

function toggleMaximizePanel() {
  const panel = document.getElementById('segmentationPanel');
  if (!panel) return;
  // Example logic
  panel.style.width = '100%';
  panel.style.height = '90vh';
}

function displaySegPanel() {
  // Show the panel
  const panel = document.getElementById('segmentationPanel');
  panel.style.display = 'block';
  panel.classList.remove('collapsed');

  // Then if you want to auto-maximize:
  toggleMaximizePanel();
}
