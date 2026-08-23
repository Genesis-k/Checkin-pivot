// server.js - Solstice Events Async Badge Printing & Webhook Service
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Serve Kiosk UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Seeded Attendee Database
const defaultDb = () => ({
  "ATT_001": { name: "Alice Mwangi", ticketType: "VIP Pass", status: "NOT_CHECKED_IN", badgePrinted: false },
  "ATT_002": { name: "Bob Otieno", ticketType: "Speaker", status: "NOT_CHECKED_IN", badgePrinted: false },
  "ATT_003": { name: "Charlie Kamau", ticketType: "General Admission", status: "NOT_CHECKED_IN", badgePrinted: false }
});

let attendeesDb = defaultDb();
const printQueue = [];

// 1. SEARCH DIRECTORY ENDPOINT
app.get('/api/kiosk/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const results = Object.keys(attendeesDb)
    .filter(id => {
      const att = attendeesDb[id];
      return (
        att.name.toLowerCase().includes(query) ||
        id.toLowerCase().includes(query) ||
        att.ticketType.toLowerCase().includes(query)
      );
    })
    .map(id => ({ id, ...attendeesDb[id] }));

  res.status(200).json(results);
});

// 2. KIOSK SCAN & DISPATCH ENDPOINT
app.post('/api/kiosk/scan', (req, res) => {
  const { attendeeId } = req.body;
  const attendee = attendeesDb[attendeeId];

  if (!attendee) {
    return res.status(404).json({ error: "Access Denied: Attendee QR/ID not found." });
  }

  // Idempotency / Duplicate-Scan Protection
  if (attendee.status === "PENDING_PRINT") {
    return res.status(400).json({ error: "Duplicate scan blocked: Print job is already processing." });
  }
  if (attendee.status === "CHECKED_IN" || attendee.badgePrinted) {
    return res.status(400).json({ error: "Duplicate scan blocked: Attendee is already checked in." });
  }

  attendee.status = "PENDING_PRINT";
  const jobId = `JOB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  printQueue.push({ jobId, attendeeId, requestedAt: new Date().toISOString() });

  res.status(202).json({
    message: "Scan accepted. Print job queued.",
    jobId,
    attendeeId,
    name: attendee.name,
    uiStatus: "PENDING_PRINT"
  });

  // Emulate asynchronous printer delay before webhook callback
  setTimeout(() => {
    dispatchVendorWebhookCallback(jobId, attendeeId);
  }, 1400);
});

// 3. VENDOR WEBHOOK RECEIVER
app.post('/api/webhooks/printer-callback', (req, res) => {
  const { jobId, attendeeId, printSuccess } = req.body;
  const attendee = attendeesDb[attendeeId];

  if (!attendee) {
    return res.status(404).json({ error: "Attendee record not found." });
  }

  if (printSuccess) {
    attendee.status = "CHECKED_IN";
    attendee.badgePrinted = true;
    attendee.checkedInAt = new Date().toISOString();
    return res.status(200).json({ status: "ACKNOWLEDGED", currentStatus: attendee.status });
  } else {
    attendee.status = "NOT_CHECKED_IN";
    return res.status(500).json({ status: "PRINT_FAILED" });
  }
});

// 4. STATUS QUERY ENDPOINT
app.get('/api/kiosk/status/:attendeeId', (req, res) => {
  const attendee = attendeesDb[req.params.attendeeId];
  if (!attendee) return res.status(404).json({ error: "Not found" });
  res.status(200).json({ attendeeId: req.params.attendeeId, ...attendee });
});

// 5. ADMIN RESET
app.post('/api/admin/reset', (req, res) => {
  attendeesDb = defaultDb();
  printQueue.length = 0;
  res.status(200).json({ message: "Reset complete" });
});

// Helper: Dispatches Webhook POST Callback
async function dispatchVendorWebhookCallback(jobId, attendeeId) {
  try {
    const port = process.env.PORT || 3000;
    await fetch(`http://localhost:${port}/api/webhooks/printer-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, attendeeId, printSuccess: true })
    });
  } catch (err) {
    console.error("Webhook callback trigger error:", err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Solstice Kiosk Service running on http://localhost:${PORT}`);
});