# Solstice Events Co. - Asynchronous Check-In & Badge Printing Service

## Overview
This service handles attendee check-ins and badge printing for Solstice Events Co.'s multi-day tech conference. Following the deprecation of the synchronous printer API, the system was refactored into an **asynchronous message-queue and webhook callback architecture**.

---

## Architectural Pivot
* **Previous Design (Synchronous):** The kiosk service blocked and waited for the badge printer vendor's API response before confirming check-in on screen.
* **New Design (Asynchronous Push & Callback):**
  * Staff scans a QR code (`POST /api/kiosk/scan`), which queues a print job and returns an immediate `PENDING_PRINT` status to the UI.
  * The badge printer processes the request in the background and sends an asynchronous callback to our webhook endpoint (`POST /api/webhooks/printer-callback`).
  * The webhook updates the attendee record to `CHECKED_IN` and sets `badgePrinted: true`.

---

## Duplicate Scan Protection (Idempotency)
To prevent accidental duplicate badge printing:
1. If an attendee's status is `PENDING_PRINT`, re-scanning is blocked with an HTTP 400 error.
2. If an attendee's status is already `CHECKED_IN`, re-scanning is blocked with an HTTP 400 error.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/kiosk/scan` | Ingests attendee scan, queues print job, returns `PENDING_PRINT`. |
| `POST` | `/api/webhooks/printer-callback` | Receives async printer confirmation and marks attendee `CHECKED_IN`. |
| `GET` | `/api/kiosk/status/:attendeeId` | Retrieves current attendee status for kiosk display polling. |

---

## Test Scenarios Covered
1. **Successful Scan & Async Confirmation:** Scanned `ATT_001` (Alice Mwangi) -> Queued -> Received callback -> Marked `CHECKED_IN`.
2. **Duplicate Scan Guard (Blocked):** Attempted re-scan for `ATT_001` -> Blocked with `400 Bad Request`.
3. **Multi-Attendee Processing:** Scanned `ATT_002` (Bob Otieno) -> Processed independently without blocking.