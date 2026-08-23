// app.js - Attendee Modal & Kiosk Dispatcher

let currentSelectedAttendeeId = null;
let qrCodeInstance = null;

// Audio Telemetry Feedback
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx();

function playBeep(freq = 600, duration = 0.1, type = 'sine') {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function addLog(msg, type = '') {
  const logs = document.getElementById('terminalLogs');
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = `log-line ${type}`;
  div.innerText = `[${time}] ${msg}`;
  logs.appendChild(div);
  logs.scrollTop = logs.scrollHeight;
}

// 1. Modal Open Handler: Dynamically builds the attendee's QR ticket
function openTicketModal(attendeeId, name, ticketType) {
  currentSelectedAttendeeId = attendeeId;
  document.getElementById('modalName').innerText = name;
  document.getElementById('modalTicket').innerText = `${ticketType} • ID: ${attendeeId}`;

  const qrContainer = document.getElementById('modalQrCode');
  qrContainer.innerHTML = ''; // Clear previous QR

  qrCodeInstance = new QRCode(qrContainer, {
    text: attendeeId,
    width: 140,
    height: 140,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });

  document.getElementById('ticketModal').classList.add('active');
}

function closeTicketModal() {
  document.getElementById('ticketModal').classList.remove('active');
}

// 2. Scan action triggered from inside the popup modal
function triggerModalScan() {
  if (!currentSelectedAttendeeId) return;
  const idToScan = currentSelectedAttendeeId;
  closeTicketModal();
  executeCheckIn(idToScan);
}

// 3. Core Check-In & Asynchronous Queue Request
async function executeCheckIn(attendeeId) {
  playBeep(800, 0.08);
  const bIcon = document.getElementById('badgeIcon');
  const bName = document.getElementById('badgeName');
  const bSub = document.getElementById('badgeSub');
  const bStatus = document.getElementById('badgeStatus');

  bName.innerText = "Dispatching Job...";
  bSub.innerText = `Queueing print for ${attendeeId}`;
  bStatus.className = "status-pill STATUS_PENDING";
  bStatus.innerText = "QUEUED / PRINTING ⏳";
  bIcon.innerText = "⚙️";

  addLog(`[QR SCAN DETECTED] Scanned token: ${attendeeId}`, 'event');

  try {
    const res = await fetch('/api/kiosk/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendeeId })
    });
    const data = await res.json();

    if (!res.ok) {
      playBeep(220, 0.3, 'sawtooth');
      bIcon.innerText = "⛔";
      bName.innerText = res.status === 404 ? "ACCESS REJECTED" : "SCAN BLOCKED";
      bSub.innerText = data.error;
      bStatus.className = "status-pill STATUS_ERROR";
      bStatus.innerText = res.status === 404 ? "UNREGISTERED" : "DUPLICATE BLOCKED";
      addLog(`[${res.status} BLOCKED] ${data.error}`, 'err');
      return;
    }

    bName.innerText = data.name;
    bSub.innerText = `Job ${data.jobId} enqueued. Awaiting webhook callback...`;
    addLog(`[202 ACCEPTED] Job ${data.jobId} enqueued. Kiosk reflects PENDING.`, 'warn');

    // Poll until vendor callback confirms badge printing
    const poller = setInterval(async () => {
      const check = await fetch(`/api/kiosk/status/${attendeeId}`);
      const att = await check.json();

      if (att.status === 'CHECKED_IN') {
        clearInterval(poller);
        playBeep(1200, 0.2, 'triangle');
        bIcon.innerText = "✅";
        bName.innerText = att.name;
        bSub.innerText = `Badge Printed • Checked In at ${new Date(att.checkedInAt).toLocaleTimeString()}`;
        bStatus.className = "status-pill STATUS_SUCCESS";
        bStatus.innerText = "BADGE PRINTED / CHECKED IN";
        addLog(`[WEBHOOK SUCCESS] Print confirmed for ${att.name}. Status -> CHECKED_IN.`, 'success');
      }
    }, 400);

  } catch (err) {
    bStatus.className = "status-pill STATUS_ERROR";
    bStatus.innerText = "NETWORK ERROR";
    addLog(`Network failed: ${err.message}`, 'err');
  }
}

async function resetDb() {
  await fetch('/api/admin/reset', { method: 'POST' });
  addLog("[ADMIN] Database reset to initial state.", 'event');
  document.getElementById('badgeIcon').innerText = "🎫";
  document.getElementById('badgeName').innerText = "Waiting for Scan";
  document.getElementById('badgeSub').innerText = "Badge printer standing by";
  document.getElementById('badgeStatus').className = "status-pill STATUS_IDLE";
  document.getElementById('badgeStatus').innerText = "READY";
}