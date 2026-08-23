// server.js - Solstice Events Async Badge Printing Service
const express = require('express');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Serve static HTML frontend
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

// 1. KIOSK SCAN ENDPOINT (On-Screen Button Ingestion)
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
  const jobId = `JOB_${Date.now()}`;
  printQueue.push({ jobId, attendeeId, requestedAt: new Date().toISOString() });

  res.status(202).json({
    message: "Scan accepted. Print job queued.",
    jobId,
    attendeeId,
    name: attendee.name,
    uiStatus: "PENDING_PRINT"
  });

  // Trigger internal async webhook processing after delay
  setTimeout(() => {
    executeWebhookStateUpdate(jobId, attendeeId, true);
  }, 1200);
});

// 2. DIRECT PHONE QR SCAN ENDPOINT (Triggered when phone camera opens the link)
app.get('/api/kiosk/direct-scan', (req, res) => {
  const { attendeeId } = req.query;
  const attendee = attendeesDb[attendeeId];

  if (!attendee) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access Denied</title></head>
      <body style="background:#090d16;color:#ef4444;font-family:-apple-system,sans-serif;text-align:center;padding:3rem 1.5rem;">
        <div style="background:#1e293b;padding:2rem;border-radius:16px;max-width:400px;margin:auto;border:1px solid #ef4444;">
          <h1 style="font-size:3rem;margin:0;">⛔</h1>
          <h2>Access Denied</h2>
          <p style="color:#94a3b8;">Unregistered or invalid QR code: <code>${attendeeId || 'UNKNOWN'}</code></p>
        </div>
      </body>
      </html>
    `);
  }

  if (attendee.status === "PENDING_PRINT") {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Processing</title></head>
      <body style="background:#090d16;color:#fbbf24;font-family:-apple-system,sans-serif;text-align:center;padding:3rem 1.5rem;">
        <div style="background:#1e293b;padding:2rem;border-radius:16px;max-width:400px;margin:auto;border:1px solid #fbbf24;">
          <h1 style="font-size:3rem;margin:0;">⏳</h1>
          <h2>Print In Progress</h2>
          <p style="color:#94a3b8;">Badge for <strong>${attendee.name}</strong> is already queued.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (attendee.status === "CHECKED_IN" || attendee.badgePrinted) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Duplicate Scan</title></head>
      <body style="background:#090d16;color:#ef4444;font-family:-apple-system,sans-serif;text-align:center;padding:3rem 1.5rem;">
        <div style="background:#1e293b;padding:2rem;border-radius:16px;max-width:400px;margin:auto;border:1px solid #ef4444;">
          <h1 style="font-size:3rem;margin:0;">🚫</h1>
          <h2>Duplicate Scan Blocked</h2>
          <p style="color:#94a3b8;"><strong>${attendee.name}</strong> is already checked in!</p>
        </div>
      </body>
      </html>
    `);
  }

  // Queue print job and mark pending
  attendee.status = "PENDING_PRINT";
  const jobId = `JOB_${Date.now()}`;
  printQueue.push({ jobId, attendeeId, requestedAt: new Date().toISOString() });

  setTimeout(() => {
    executeWebhookStateUpdate(jobId, attendeeId, true);
  }, 1200);

  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Check-In Confirmed</title></head>
    <body style="background:#090d16;color:#10b981;font-family:-apple-system,sans-serif;text-align:center;padding:3rem 1.5rem;">
      <div style="background:#1e293b;padding:2rem;border-radius:16px;max-width:400px;margin:auto;border:1px solid #10b981;">
        <h1 style="font-size:3rem;margin:0;">✅</h1>
        <h2>Scan Confirmed!</h2>
        <p style="color:#f8fafc;font-size:1.1rem;margin:0.5rem 0;">Welcome, <strong>${attendee.name}</strong></p>
        <p style="color:#94a3b8;font-size:0.85rem;">Badge print job published to message queue. Kiosk is printing your pass.</p>
      </div>
    </body>
    </html>
  `);
});

// 3. VENDOR WEBHOOK RECEIVER (POST endpoint for standard webhook callbacks)
app.post('/api/webhooks/printer-callback', (req, res) => {
  const { jobId, attendeeId, printSuccess } = req.body;
  const result = executeWebhookStateUpdate(jobId, attendeeId, printSuccess);
  if (result.success) {
    return res.status(200).json({ status: "ACKNOWLEDGED", currentStatus: result.status });
  } else {
    return res.status(result.code).json({ error: result.error });
  }
});

// 4. STATUS QUERY ENDPOINT (Frontend polling)
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

// Internal Webhook State Transition Logic
function executeWebhookStateUpdate(jobId, attendeeId, printSuccess) {
  const attendee = attendeesDb[attendeeId];
  if (!attendee) return { success: false, code: 404, error: "Attendee not found" };

  if (printSuccess) {
    attendee.status = "CHECKED_IN";
    attendee.badgePrinted = true;
    attendee.checkedInAt = new Date().toISOString();
    attendee.lastJobId = jobId;
    return { success: true, status: attendee.status };
  } else {
    attendee.status = "NOT_CHECKED_IN";
    return { success: false, code: 500, error: "Print failed" };
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Solstice Kiosk live on port ${PORT}`);
});

module.exports = app;