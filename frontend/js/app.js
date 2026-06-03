/**
 * Scan Page — State Machine
 *
 * States:
 *   1. VERIFYING   → token from URL is being verified
 *   2. IDENTIFY    → ask for registration number
 *   3. REGISTER    → new student registration form
 *   4. ACTION      → show Mark Entry / Mark Exit button
 *   5. CONFIRM     → show success confirmation
 *   6. ERROR       → show error message
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const sections = {
    verifying: document.getElementById('section-verifying'),
    identify: document.getElementById('section-identify'),
    register: document.getElementById('section-register'),
    action: document.getElementById('section-action'),
    confirm: document.getElementById('section-confirm'),
    error: document.getElementById('section-error'),
  };

  const steps = document.querySelectorAll('.step');

  // Identify
  const regNoInput = document.getElementById('input-reg-no');
  const identifyBtn = document.getElementById('btn-identify');
  const identifyError = document.getElementById('identify-error');

  // Register
  const regFormRegNo = document.getElementById('reg-reg-no');
  const regFormName = document.getElementById('reg-name');
  const regFormMobile = document.getElementById('reg-mobile');
  const registerBtn = document.getElementById('btn-register');
  const registerError = document.getElementById('register-error');

  // Action
  const actionStudentName = document.getElementById('action-student-name');
  const actionRegNo = document.getElementById('action-reg-no');
  const actionNextLabel = document.getElementById('action-next-label');
  const actionBtn = document.getElementById('btn-action');
  const actionEntryInfo = document.getElementById('action-entry-info');
  const actionError = document.getElementById('action-error');

  // Confirm
  const confirmIcon = document.getElementById('confirm-icon');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmSummary = document.getElementById('confirm-summary');

  // Error
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');

  // --- State ---
  let sessionId = null;
  let currentStudent = null;
  let currentState = null;
  let nextAction = null;

  // --- Show/hide sections ---
  function showSection(name, stepIndex) {
    Object.keys(sections).forEach((key) => {
      sections[key].classList.add('hidden');
    });
    sections[name].classList.remove('hidden');
    sections[name].classList.add('animate-in');

    // Update step indicators
    if (stepIndex !== undefined) {
      steps.forEach((step, i) => {
        step.classList.remove('step--active', 'step--done');
        if (i < stepIndex) step.classList.add('step--done');
        if (i === stepIndex) step.classList.add('step--active');
      });
    }

    currentState = name;
  }

  // --- Error display helper ---
  function showError(title, message) {
    errorTitle.textContent = title;
    errorMessage.textContent = message;
    showSection('error');
  }

  // --- Format time helper ---
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

  // ===================================
  // STEP 1: Verify token from URL
  // ===================================
  async function verifyToken() {
    showSection('verifying', 0);

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      showError('No QR Code Scanned', 'Please scan the QR code displayed on the attendance device to get started.');
      return;
    }

    // Update the verifying UI text live as retries happen
    const verifyingText = sections.verifying.querySelector('.loading-state__text');
    const verifyingSubtext = sections.verifying.querySelector('.loading-state__text.text-muted');

    function onRetry(attempt, max, message) {
      if (verifyingText) verifyingText.textContent = message;
      if (verifyingSubtext) {
        verifyingSubtext.textContent = `Attempt ${attempt + 1} of ${max + 1} — keep this page open, the server is waking up.`;
      }
    }

    const result = await API.verifyToken(token, onRetry);

    if (!result.ok) {
      const errCode = result.data?.code;
      if (errCode === 'INVALID_TOKEN') {
        showError('QR Code Expired', 'This QR code has expired. Please scan the current code on the device.');
      } else if (errCode === 'TOKEN_ALREADY_USED') {
        showError('Already Used', 'This QR code has already been used. Please scan the new code on the device.');
      } else {
        showError('Connection Failed', result.data?.error || 'Could not reach the server. Please check your internet connection and try again.');
      }
      return;
    }

    sessionId = result.data.sessionId;

    // Clean the URL (remove token from address bar)
    window.history.replaceState({}, '', window.location.pathname);

    showSection('identify', 1);
    regNoInput.focus();
  }


  // ===================================
  // STEP 2: Identify student
  // ===================================
  identifyBtn.addEventListener('click', handleIdentify);
  regNoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleIdentify();
  });

  async function handleIdentify() {
    const regNo = regNoInput.value.trim().toUpperCase();
    identifyError.classList.add('hidden');

    if (!regNo) {
      identifyError.textContent = 'Please enter your registration number.';
      identifyError.classList.remove('hidden');
      regNoInput.focus();
      return;
    }

    identifyBtn.disabled = true;
    identifyBtn.innerHTML = '<span class="spinner"></span> Looking up...';

    const result = await API.lookupStudent(regNo, sessionId);

    identifyBtn.disabled = false;
    identifyBtn.innerHTML = 'Continue';

    if (!result.ok) {
      identifyError.textContent = result.data?.error || 'Failed to look up student. Please try again.';
      identifyError.classList.remove('hidden');
      return;
    }

    if (result.data.found) {
      // Existing student — go to action
      currentStudent = result.data.student;
      nextAction = result.data.attendanceState.nextAction;
      showActionSection(result.data.attendanceState);
    } else {
      // New student — go to registration
      regFormRegNo.value = regNo;
      showSection('register', 2);
      regFormName.focus();
    }
  }

  // ===================================
  // STEP 3: Register new student
  // ===================================
  registerBtn.addEventListener('click', handleRegister);

  async function handleRegister() {
    registerError.classList.add('hidden');

    const regNo = regFormRegNo.value.trim().toUpperCase();
    const name = regFormName.value.trim();
    const mobile = regFormMobile.value.trim();

    // Client-side validation
    if (!name || name.length < 2) {
      registerError.textContent = 'Please enter your full name (at least 2 characters).';
      registerError.classList.remove('hidden');
      regFormName.focus();
      return;
    }

    if (!mobile || !/^\d{10,15}$/.test(mobile)) {
      registerError.textContent = 'Please enter a valid mobile number (10-15 digits).';
      registerError.classList.remove('hidden');
      regFormMobile.focus();
      return;
    }

    registerBtn.disabled = true;
    registerBtn.innerHTML = '<span class="spinner"></span> Registering...';

    const result = await API.registerStudent({ regNo, name, mobile, sessionId });

    registerBtn.disabled = false;
    registerBtn.innerHTML = '✨ Register & Continue';

    if (!result.ok) {
      registerError.textContent = result.data?.error || 'Registration failed. Please try again.';
      registerError.classList.remove('hidden');
      return;
    }

    currentStudent = result.data.student;
    nextAction = result.data.attendanceState.nextAction;
    showActionSection(result.data.attendanceState);
  }

  // ===================================
  // STEP 4: Show attendance action
  // ===================================
  function showActionSection(attendanceState) {
    actionStudentName.textContent = currentStudent.name;
    actionRegNo.textContent = currentStudent.regNo;

    nextAction = attendanceState.nextAction;

    if (nextAction === 'entry') {
      actionNextLabel.textContent = 'Mark your entry to start the session';
      actionBtn.textContent = '📍 Mark Entry';
      actionBtn.className = 'btn btn--success btn--lg';
      actionEntryInfo.classList.add('hidden');
      actionBtn.classList.remove('hidden');
    } else if (nextAction === 'exit') {
      actionNextLabel.textContent = 'Mark your exit to complete the session';
      actionBtn.textContent = '🚪 Mark Exit';
      actionBtn.className = 'btn btn--danger btn--lg';
      actionEntryInfo.innerHTML = `<span class="summary-row__label">Entry Time</span><span class="summary-row__value summary-row__value--highlight">${formatTime(attendanceState.entryTime)}</span>`;
      actionEntryInfo.classList.remove('hidden');
      actionBtn.classList.remove('hidden');
    } else if (nextAction === 'done') {
      showConfirmation('done', attendanceState);
      return;
    }

    showSection('action', 3);
  }

  actionBtn.addEventListener('click', handleMarkAttendance);

  async function handleMarkAttendance() {
    actionError.classList.add('hidden');

    actionBtn.disabled = true;
    actionBtn.innerHTML = `<span class="spinner"></span> ${nextAction === 'entry' ? 'Marking Entry...' : 'Marking Exit...'}`;

    const result = await API.markAttendance(currentStudent.regNo, nextAction, sessionId);

    actionBtn.disabled = false;

    if (!result.ok) {
      // If the error includes an attendanceState, the backend is telling us the actual state
      if (result.data?.attendanceState) {
        showActionSection(result.data.attendanceState);
        return;
      }
      actionError.textContent = result.data?.error || 'Failed to mark attendance. Please try again.';
      actionError.classList.remove('hidden');
      actionBtn.textContent = nextAction === 'entry' ? '📍 Mark Entry' : '🚪 Mark Exit';
      return;
    }

    showConfirmation(result.data.action, result.data.attendanceState);
  }

  // ===================================
  // STEP 5: Show confirmation
  // ===================================
  function showConfirmation(action, state) {
    let icon, title, message;

    if (action === 'entry') {
      confirmIcon.className = 'confirmation__icon confirmation__icon--entry';
      confirmIcon.textContent = '✅';
      title = 'Entry Marked!';
      message = 'Your attendance entry has been recorded. Scan the QR code again when leaving to mark your exit.';
    } else if (action === 'exit') {
      confirmIcon.className = 'confirmation__icon confirmation__icon--exit';
      confirmIcon.textContent = '👋';
      title = 'Exit Marked!';
      message = `Your session is complete. Total duration: ${formatDuration(state.durationMinutes)}.`;
    } else {
      confirmIcon.className = 'confirmation__icon confirmation__icon--done';
      confirmIcon.textContent = '🎉';
      title = 'All Done!';
      message = 'Your attendance for today is already complete.';
    }

    confirmTitle.textContent = title;
    confirmMessage.textContent = message;

    // Build summary
    confirmSummary.innerHTML = `
      <div class="summary-row">
        <span class="summary-row__label">Student</span>
        <span class="summary-row__value">${currentStudent.name}</span>
      </div>
      <div class="summary-row">
        <span class="summary-row__label">Reg No</span>
        <span class="summary-row__value">${currentStudent.regNo}</span>
      </div>
      <div class="summary-row">
        <span class="summary-row__label">Entry Time</span>
        <span class="summary-row__value summary-row__value--highlight">${formatTime(state.entryTime)}</span>
      </div>
      <div class="summary-row">
        <span class="summary-row__label">Exit Time</span>
        <span class="summary-row__value ${state.exitTime ? 'summary-row__value--highlight' : ''}">${formatTime(state.exitTime)}</span>
      </div>
      ${state.durationMinutes != null ? `
      <div class="summary-row">
        <span class="summary-row__label">Duration</span>
        <span class="summary-row__value summary-row__value--success">${formatDuration(state.durationMinutes)}</span>
      </div>` : ''}
    `;

    showSection('confirm', 4);
  }

  // --- Initialize ---
  verifyToken();
});
