/* this is the parent script from the standalone test that known working*/
    // Modal controls (unchanged)…
    document.getElementById('openChildModal').onclick = () => {
      document.getElementById('childModal').style.display = 'block';
      document.getElementById('childFrame').src = 'child2.html';
      document.body.style.overflow = 'hidden';
    };
    document.querySelector('.close-modal').onclick = () => {
      document.getElementById('childModal').style.display = 'none';
      document.getElementById('childFrame').src = '';
      document.body.style.overflow = 'auto';
    };
    document.getElementById('childModal').onclick = e => {
      if (e.target === e.currentTarget) {
        document.querySelector('.close-modal').click();
      }
    };

    // Handle messages from child
    window.addEventListener('message', async (e) => {
      const msg = e.data;
      console.log('[PARENT] message from child:', msg);

      // ─── FILE DIALOG ───────────────────────────────────────
      if (msg.action === 'OPEN_FILES_DIALOG') {
        let paths = [];
        if (window.electronAPI?.openFilesDialog) {
          // Electron-based call
          paths = await window.electronAPI.openFilesDialog({
            filters: msg.filters,
            properties: ['openFile','multiSelections']
          });
        } else {
          // Fallback <input type="file">
          const input = document.createElement('input');
          input.type     = 'file';
          input.accept   = 'video/*';
          input.multiple = true;
          input.onchange = () => {
            paths = Array.from(input.files).map(f => f.path || URL.createObjectURL(f));
            sendVideoFiles(paths);
          };
          return input.click();
        }
        sendVideoFiles(paths);
      }

      // ─── DIRECTORY DIALOG ──────────────────────────────────
      if (msg.action === 'OPEN_DIRECTORY_DIALOG') {
        let dir = null;
        if (window.electronAPI?.openDirectoryDialog) {
          dir = await window.electronAPI.openDirectoryDialog({
            properties: ['openDirectory','createDirectory']
          });
        }
        e.source.postMessage({
          type: 'DIRECTORY_SELECTED',
          path: dir || ''
        }, e.origin);
      }

      // ─── CONCAT COMPLETE NOTIFICATION ─────────────────────
      if (msg.action === 'CONCAT_COMPLETE') {
        // Show a toast, an alert, or call your own method
        alert(`Video concatenation complete!\nOutput: ${msg.output}`);
      }

      // Helper: gather stats & post VIDEO_FILES
      async function sendVideoFiles(paths) {
        const files = await Promise.all(paths.map(async p => {
          let size = 0;
          if (window.electronAPI?.getFileStats) {
            try {
              const stat = await window.electronAPI.getFileStats(p);
              size = stat.size;
            } catch (err) {
              console.warn('[PARENT] getFileStats failed for', p, err);
            }
          }
          return { path: p, size };
        }));
        e.source.postMessage({
          type: 'VIDEO_FILES',
          files
        }, e.origin);
      }
    });

