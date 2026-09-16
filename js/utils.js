// ============================================================
// UTILITY FUNCTIONS
// ============================================================
const Utils = {
  // Generate 6-digit game PIN
  generateGamePin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },

  // Generate 4-digit group PIN
  generateGroupPin() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  },

  // Speed-based scoring (set by admin per question: points + time limit)
  //  - Correct FAST (first ~1/3 of the clock)   = FULL points
  //    e.g. 20s question, 100 pts: answered at 0-7s = 100
  //  - After that points slide down every second
  //    e.g. answered at 10s = 70, at 12s = 50, at 14s = 30
  //  - When only ~1/5 of the clock is left      = 10% floor
  //    e.g. 4 seconds left on a 20s question = only 10 pts (stays 10 after)
  //  - Wrong answer or times up                 = 0
  calculateSpeedScore(timeElapsed, maxPoints, timeLimit) {
    const limit = Math.max(1, parseInt(timeLimit) || 20);
    const pts = Math.max(0, parseInt(maxPoints) || 0);
    const te = Math.max(0, Number(timeElapsed) || 0);
    if (pts === 0 || te >= limit) return 0;
    if (te <= limit * 0.35) return pts;
    const start = limit * 0.35, end = limit * 0.80;
    const frac = Math.min(1, Math.max(0, (te - start) / (end - start)));
    return Math.max(Math.round(pts * 0.10), Math.round(pts * (1 - frac * 0.9)));
  },

  // Seeded PRNG - same seed string always produces the same random sequence
  seededRandom(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    let a = (h ^= h >>> 16) >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  },

  // Fisher-Yates shuffle driven by a seeded rand()
  seededShuffle(arr, rand) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  },

  // Format time display
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  // Show notification toast
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
      <span class="toast-message">${message}</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // Confetti animation
  createConfetti(container) {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffa500', '#ff69b4'];
    for (let i = 0; i < 100; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti-piece';
      confetti.style.cssText = `
        left: ${Math.random() * 100}%;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        animation-delay: ${Math.random() * 3}s;
        animation-duration: ${2 + Math.random() * 3}s;
      `;
      container.appendChild(confetti);
    }
  },

  // Download CSV report
  downloadCSV(data, filename) {
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Show/hide loading spinner
  showLoading() {
    document.getElementById('loading-overlay').style.display = 'flex';
  },

  hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
  },

  // Sanitize input
  sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
