/**
 * Clippy — UI Utilities
 * DOM manipulation, toasts, animations, and clipboard.
 */
const UI = (() => {
  // Cache DOM elements
  const els = {};

  function init() {
    els.statusBar = document.getElementById('status-bar');
    els.statusDot = document.getElementById('status-dot');
    els.statusText = document.getElementById('status-text');

    els.viewHome = document.getElementById('view-home');
    els.viewWaiting = document.getElementById('view-waiting');
    els.viewConnected = document.getElementById('view-connected');

    els.btnCreate = document.getElementById('btn-create');
    els.inputCode = document.getElementById('input-code');
    els.btnJoin = document.getElementById('btn-join');

    els.codeText = document.getElementById('code-text');
    els.btnCopyCode = document.getElementById('btn-copy-code');
    els.ttlProgress = document.getElementById('ttl-progress');
    els.ttlText = document.getElementById('ttl-text');
    els.btnCancelWaiting = document.getElementById('btn-cancel-waiting');

    els.connectedCode = document.getElementById('connected-code');
    els.btnDisconnect = document.getElementById('btn-disconnect');
    els.inputClip = document.getElementById('input-clip');
    els.btnSend = document.getElementById('btn-send');
    els.clipFeed = document.getElementById('clip-feed');
    els.emptyState = document.getElementById('empty-state');

    els.toastContainer = document.getElementById('toast-container');
  }

  /**
   * Switch to a view (home, waiting, connected).
   */
  function showView(viewName) {
    const views = [els.viewHome, els.viewWaiting, els.viewConnected];
    views.forEach(v => v.classList.remove('active'));

    const targetMap = {
      home: els.viewHome,
      waiting: els.viewWaiting,
      connected: els.viewConnected,
    };

    const target = targetMap[viewName];
    if (target) {
      // Small delay for animation re-trigger
      requestAnimationFrame(() => {
        target.classList.add('active');
      });
    }
  }

  /**
   * Update the connection status bar.
   */
  function setStatus(status, text) {
    els.statusDot.className = 'status-dot';
    if (status === 'connected') {
      els.statusDot.classList.add('connected');
    } else if (status === 'disconnected') {
      els.statusDot.classList.add('disconnected');
    }
    els.statusText.textContent = text || status;
  }

  /**
   * Display the pairing code on the waiting screen.
   */
  function showCode(code) {
    els.codeText.textContent = code;
  }

  /**
   * Set the connected session code.
   */
  function setConnectedCode(code) {
    els.connectedCode.textContent = code;
  }

  /**
   * Update TTL progress bar and text.
   */
  function updateTTL(remainingMs, totalMs) {
    const pct = Math.max(0, (remainingMs / totalMs) * 100);
    els.ttlProgress.style.width = `${pct}%`;

    const totalSec = Math.ceil(remainingMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    els.ttlText.textContent = `Expires in ${min}:${sec.toString().padStart(2, '0')}`;

    // Change color when low
    if (pct < 20) {
      els.ttlProgress.style.background = `linear-gradient(135deg, var(--error), var(--warning))`;
    } else {
      els.ttlProgress.style.background = '';
    }
  }

  /**
   * Add a received clip to the feed.
   */
  function addClipToFeed(content, timestamp) {
    // Hide empty state
    if (els.emptyState) {
      els.emptyState.style.display = 'none';
    }

    const item = document.createElement('div');
    item.className = 'clip-item new';

    const time = new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    item.innerHTML = `
      <div class="clip-content">${escapeHtml(content)}</div>
      <div class="clip-meta">
        <span class="clip-time">${time}</span>
        <button class="btn-copy-clip" data-content="${escapeAttr(content)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          Copy
        </button>
      </div>
    `;

    // Add click handler
    const copyBtn = item.querySelector('.btn-copy-clip');
    copyBtn.addEventListener('click', () => {
      copyToClipboard(content, copyBtn);
    });

    // Insert at top
    els.clipFeed.insertBefore(item, els.clipFeed.firstChild);

    // Remove glow after animation
    setTimeout(() => {
      item.classList.remove('new');
    }, 2000);

    // Limit to 20 items
    while (els.clipFeed.children.length > 21) { // 20 clips + empty state
      els.clipFeed.removeChild(els.clipFeed.lastChild);
    }
  }

  /**
   * Clear the clip feed.
   */
  function clearFeed() {
    els.clipFeed.innerHTML = '';
    els.clipFeed.appendChild(els.emptyState || createEmptyState());
    if (els.emptyState) els.emptyState.style.display = '';
  }

  function createEmptyState() {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.id = 'empty-state';
    div.innerHTML = `
      <span class="empty-icon">📭</span>
      <p>No clips received yet</p>
      <p class="empty-hint">Text sent from the other device will appear here</p>
    `;
    els.emptyState = div;
    return div;
  }

  /**
   * Copy text to clipboard and update button state.
   */
  async function copyToClipboard(text, buttonEl) {
    try {
      await navigator.clipboard.writeText(text);
      if (buttonEl) {
        const origHTML = buttonEl.innerHTML;
        buttonEl.classList.add('copied');
        buttonEl.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Copied!
        `;
        setTimeout(() => {
          buttonEl.classList.remove('copied');
          buttonEl.innerHTML = origHTML;
        }, 1500);
      }
      return true;
    } catch (err) {
      showToast('Failed to copy to clipboard', 'error');
      return false;
    }
  }

  /**
   * Show a toast notification.
   */
  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
      success: '✓',
      error: '✕',
      info: 'ℹ',
    };

    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${escapeHtml(message)}`;
    els.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    }, duration);
  }

  /**
   * Get input values.
   */
  function getCodeInput() {
    return els.inputCode.value.trim().toUpperCase();
  }

  function getClipInput() {
    return els.inputClip.value;
  }

  function clearClipInput() {
    els.inputClip.value = '';
  }

  function setJoinEnabled(enabled) {
    els.btnJoin.disabled = !enabled;
  }

  /**
   * Escape HTML for display.
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Escape for HTML attributes.
   */
  function escapeAttr(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return {
    init,
    showView,
    setStatus,
    showCode,
    setConnectedCode,
    updateTTL,
    addClipToFeed,
    clearFeed,
    copyToClipboard,
    showToast,
    getCodeInput,
    getClipInput,
    clearClipInput,
    setJoinEnabled,
    els: () => els,
  };
})();
