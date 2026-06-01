/**
 * Dashboard — Live attendance records with auto-refresh, search, and date picker.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const dateInput = document.getElementById('dashboard-date');
  const searchInput = document.getElementById('dashboard-search');
  const tableBody = document.getElementById('dashboard-table-body');
  const tableEmpty = document.getElementById('dashboard-table-empty');
  const refreshTime = document.getElementById('refresh-time');
  const refreshCountdown = document.getElementById('refresh-countdown');

  // Stats
  const statTotal = document.getElementById('stat-total');
  const statPresent = document.getElementById('stat-present');
  const statInSession = document.getElementById('stat-in-session');
  const statCompleted = document.getElementById('stat-completed');

  // --- State ---
  let allRecords = [];
  let refreshInterval = null;
  let countdownInterval = null;
  let secondsUntilRefresh = 30;

  const REFRESH_SECONDS = 30;

  // --- Initialize date to today ---
  const today = new Date().toISOString().split('T')[0];
  dateInput.value = today;

  // --- Format helpers ---
  function formatTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  }

  function formatDuration(minutes) {
    if (!minutes && minutes !== 0) return '—';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function getStatusBadge(status) {
    const labels = {
      completed: '<span class="badge badge--done">✓ Completed</span>',
      in_session: '<span class="badge badge--in-session">● In Session</span>',
      pending: '<span class="badge badge--entry">◌ Pending</span>',
    };
    return labels[status] || status;
  }

  // --- Fetch and render ---
  async function fetchAttendance() {
    const date = dateInput.value;
    const result = await API.getLiveAttendance(date);

    if (!result.ok) {
      console.error('Failed to fetch attendance:', result.data);
      return;
    }

    const data = result.data;

    // Update stats
    statTotal.textContent = data.totalStudents;
    statPresent.textContent = data.presentCount;
    statInSession.textContent = data.inSessionCount;
    statCompleted.textContent = data.completedCount;

    allRecords = data.records;
    renderTable();

    // Update refresh time
    refreshTime.textContent = `Last updated: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}`;
    resetCountdown();
  }

  function renderTable() {
    const search = searchInput.value.trim().toLowerCase();

    const filtered = allRecords.filter((r) => {
      if (!search) return true;
      return (
        r.regNo.toLowerCase().includes(search) ||
        r.name.toLowerCase().includes(search)
      );
    });

    if (filtered.length === 0) {
      tableBody.innerHTML = '';
      tableEmpty.classList.remove('hidden');
      return;
    }

    tableEmpty.classList.add('hidden');

    tableBody.innerHTML = filtered
      .map(
        (r, index) => `
      <tr style="animation-delay: ${index * 30}ms" class="animate-fade">
        <td style="font-weight: 600;">${r.regNo}</td>
        <td>${r.name}</td>
        <td>${formatTime(r.entryTime)}</td>
        <td>${formatTime(r.exitTime)}</td>
        <td>${formatDuration(r.durationMinutes)}</td>
        <td>${getStatusBadge(r.status)}</td>
      </tr>
    `
      )
      .join('');
  }

  // --- Countdown ---
  function resetCountdown() {
    secondsUntilRefresh = REFRESH_SECONDS;
    updateCountdownDisplay();
  }

  function updateCountdownDisplay() {
    refreshCountdown.textContent = `Next refresh in ${secondsUntilRefresh}s`;
  }

  // --- Event listeners ---
  dateInput.addEventListener('change', () => {
    fetchAttendance();
  });

  searchInput.addEventListener('input', () => {
    renderTable();
  });

  // --- Auto-refresh ---
  function startAutoRefresh() {
    // Fetch immediately
    fetchAttendance();

    // Refresh data every REFRESH_SECONDS
    refreshInterval = setInterval(() => {
      fetchAttendance();
    }, REFRESH_SECONDS * 1000);

    // Countdown ticker
    countdownInterval = setInterval(() => {
      secondsUntilRefresh--;
      if (secondsUntilRefresh < 0) secondsUntilRefresh = REFRESH_SECONDS;
      updateCountdownDisplay();
    }, 1000);
  }

  // --- Cleanup on page leave ---
  window.addEventListener('beforeunload', () => {
    clearInterval(refreshInterval);
    clearInterval(countdownInterval);
  });

  // --- Initialize ---
  startAutoRefresh();
});
