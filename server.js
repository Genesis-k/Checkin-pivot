// Solstice Events Async Badge Printing Service
const express = require('express');
const app = express();
app.use(express.json());

// In-memory Database of Attendees & Check-in States
const attendeesDb = {
  "ATT_001": { name: "Alice Mwangi", status: "NOT_CHECKED_IN", badgePrinted: false },
  "ATT_002": { name: "Bob Otieno", status: "NOT_CHECKED_IN", badgePrinted: false },
  "ATT_003": { name: "Charlie Kamau", status: "NOT_CHECKED_IN", badgePrinted: false }
};

// Mock Asynchronous Message Queue
const printQueue = [];

// 1. KIOSK SCAN ENDPOINT (Triggered when staff scans QR code)
app.post('/api/kiosk/scan', (req, res) => {
  const { attendeeId } = req.body;
  const attendee = attendeesDb[attendeeId];

  // Validation: Check if attendee exists
  if (!attendee) {
    return res.status(404).json({ error: "Attendee not found." });
  }

  // Duplicate Check Protection: Prevent duplicate prints if pending or checked in
  if (attendee.status === "PENDING_PRINT") {
    return res.status(400).json({ 
      error: "Duplicate scan blocked. Badge is currently printing." 
    });
  }
  if (attendee.status === "CHECKED_IN" || attendee.badgePrinted) {
    return res.status(400).json({ 
      error: "Duplicate scan blocked. Attendee is already checked in!" 
    });
  }

  // Set pending state immediately
  attendee.status = "PENDING_PRINT";

  // Push job to message queue
  const job = { jobId: `JOB_${Date.now()}`, attendeeId: attendeeId };
  printQueue.push(job);
  console.log(`[QUEUE] Added Job ${job.jobId} for ${attendee.name}`);

  // Return immediate pending state to UI (Non-blocking)
  res.status(202).json({
    message: "Scan received. Badge print job queued.",
    attendeeId: attendeeId,
    name: attendee.name,
    uiStatus: "PENDING_PRINT"
  });

  // Simulate external vendor printer processing asynchronously (1.5s delay)
  setTimeout(() => {
    simulateVendorWebhookCallback(job.jobId, attendeeId);
  }, 1500);
});

// 2. VENDOR WEBHOOK RECEIVER (Callback endpoint when printer finishes)
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

    console.log(`[WEBHOOK SUCCESS] ${attendee.name} marked as CHECKED_IN. Badge printed.`);
    return res.status(200).json({ status: "ACKNOWLEDGED", currentStatus: attendee.status });
  } else {
    attendee.status = "NOT_CHECKED_IN";
    console.log(`[WEBHOOK FAILURE] Print failed for ${attendee.name}. Reset state.`);
    return res.status(500).json({ status: "PRINT_FAILED" });
  }
});

// 3. UI STATUS QUERY ENDPOINT (Frontend polls/checks this to show green "Checked In")
app.get('/api/kiosk/status/:attendeeId', (req, res) => {
  const attendee = attendeesDb[req.params.attendeeId];
  if (!attendee) return res.status(404).json({ error: "Not found" });
  res.status(200).json({ attendeeId: req.params.attendeeId, ...attendee });
});

// Helper: Simulates the Printer Vendor calling our Webhook
async function simulateVendorWebhookCallback(jobId, attendeeId) {
  try {
    await fetch('http://localhost:3000/api/webhooks/printer-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, attendeeId, printSuccess: true })
    });
  } catch (err) {
    console.error("Webhook trigger error:", err.message);
  }
}

// Start Server
app.listen(3000, () => {
  console.log("Solstice Events Kiosk Service running on http://localhost:3000");
});