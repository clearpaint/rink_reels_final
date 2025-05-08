<script>
  console.log("[PARENT] parent.html is loaded.");

  // Listen for messages from any child iframe
  window.addEventListener("message", async (event) => {
  console.log("[PARENT] Received message:", event.data, "from:", event.source);

  // 1) Gather all iframes so we match the correct event.source
  const allIframes = document.querySelectorAll("iframe");
  let matchedIframe = null;
  for (const ifr of allIframes) {
  if (ifr.contentWindow === event.source) {
  matchedIframe = ifr;
  break;
}
}
  if (!matchedIframe) {
  console.warn("[PARENT] Message from unknown source => ignoring.");
  return;
}

  const {action} = event.data || {};

  if (action === 'OPEN_FILE_DIALOG') {
  console.log("[PARENT] Child requests OPEN_FILE_DIALOG...");
  let filePath = null;
  try {
  filePath = await window.electronAPI.openFileDialog({
  filters: [{name: 'Videos', extensions: ['mp4','mov','mkv','avi']}]
});
  console.log("[PARENT] electronAPI.openFileDialog => filePath:", filePath);
} catch (err) {
  console.error("[PARENT] Error in openFileDialog:", err);
}

  // Send the result back
  event.source.postMessage({action: 'OPEN_FILE_DIALOG_RESULT', filePath}, '*');
  console.log("[PARENT] Sent OPEN_FILE_DIALOG_RESULT to child:", filePath);
}
  else if (action === 'OPEN_DIRECTORY_DIALOG') {
  console.log("[PARENT] Child requests OPEN_DIRECTORY_DIALOG...");
  let dirPath = null;
  try {
  dirPath = await window.electronAPI.openDirectoryDialog();
  console.log("[PARENT] electronAPI.openDirectoryDialog => dirPath:", dirPath);
} catch (err) {
  console.error("[PARENT] Error in openDirectoryDialog:", err);
}

  // Send the result back
  event.source.postMessage({action: 'OPEN_DIRECTORY_DIALOG_RESULT', dirPath}, '*');
  console.log("[PARENT] Sent OPEN_DIRECTORY_DIALOG_RESULT to child:", dirPath);
}
  else {
  console.log("[PARENT] Unrecognized action => ignoring:", action);
}
});

  // Initialize all tooltips once the DOM is loaded
  document.addEventListener('DOMContentLoaded', function () {
  var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.forEach(function (tooltipTriggerEl) {
  new bootstrap.Tooltip(tooltipTriggerEl);
});
});

  function returnToVideoView() {
  document.getElementById("videoWrapper").innerHTML = `
      <h5 id="videoTitle"></h5>
      <div class="video-container">
        <video id="videoPlayer" preload="auto"></video>
        <canvas id="drawCanvas"></canvas>
        <div class="bottom-controls">
          <!-- etc. the timeline bar, etc. -->
        </div>
      </div>
    `;
  document.getElementById("returnToVideoBtn").style.display = 'none';
  showToast("Back to Video Viewer");
}

</script>
