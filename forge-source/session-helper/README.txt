Forge UAS Session Recorder 1.2
Free local recording, live team view and evidence export. No account required.

QUICK START
1. Download and extract the Windows x64 or Linux x64 standalone ZIP before
   leaving for the field. Install a desktop Chromium browser (Edge, Chrome or
   Chromium) beforehand. The executable includes Python and the recorder files;
   there is no runtime installation, account check or download at field startup.
2. Windows: open Forge-UAS-Recorder.exe. Keep its console window open.
   Linux: run chmod +x Forge-UAS-Recorder, then ./Forge-UAS-Recorder.
   The Linux release is built on Ubuntu 22.04 (glibc 2.35); newer compatible
   x64 distributions are the initial target. Hardware capture depends on the OS.
3. The app opens the default browser. If it is not Chromium, paste the printed
   localhost address into Edge, Chrome or Chromium. Local telemetry connects
   automatically. Use --no-browser to open it yourself.
4. The app displays the field folder for saved session ZIPs. Its default is
   .forge-uas-recorder/sessions under your home directory. --session-dir PATH
   selects another writable folder, including a removable drive.
5. Add your chosen windows/screens and cameras (up to eight video inputs),
   name each preview, and optionally include one microphone. Or start notes-only.
   Collect connected parameters/logs before or after recording. Select your
   stack and test environment, explain the expected behavior, and mark moments.
6. Stop: committed evidence stays in the browser and a completed ZIP is copied
   to the field folder. Attach original logs/configuration and update the report,
   then select Save updated disk copy. Reopen a disk copy or download a ZIP.

PYTHON SOURCE PACKAGE
The smaller source ZIP requires an existing Python 3.9+ installation. Extract
the complete package, open Start-Recorder.cmd (Windows), or run
python3 desktop.py (Linux). No pip packages are required. start-recorder.sh
is also included. These launch the same app with automatic local telemetry
connection and disk copies. Advanced bridge.py usage prints a manual key;
that helper has browser storage and downloads, with no automatic field folder.

SOP.md provides the general session procedure and report template.
The included app runs without internet. Local browser sessions belong to the
browser origin (including its port): use the same address/port next time, or
export a ZIP to move evidence. Clearing browser data deletes browser sessions.
Disk copies remain when browser data is cleared; use Open disk copy to recover
them. Active capture chunks still live in browser storage until stopped/exported.
Keep the app running until capture finishes. The helper does not host team links.

LIVE TEAM SESSIONS
Join your usual Teams or Google Meet meeting, then choose Live team view and
share this recorder window through the meeting's screen/window sharing.
Record the separate GCS/app window and/or camera to avoid recursive capture.
The team sees video previews, recent vehicle observations, their observation
age and marked events. Switch between live view and workspace without stopping
capture. Meetings require connectivity; losing the meeting does not stop local
recording, local UDP telemetry, saving, replay or report generation.
LIVE_TEAM_GUIDE.txt gives the procedure and official screen-sharing references.
Meeting audio/chat is not automatically captured. This release uses normal
meeting screen sharing; it does not create a meeting bot or hosted video relay.

NETWORK TELEMETRY
Keep your existing GCS connected and forward a copy to 127.0.0.1 UDP 14551.
Use the forwarding options of Mission Planner, QGroundControl, MAVProxy or
MAVLink Router. Setup reference:
https://ardupilot.org/mavproxy/docs/getting_started/forwarding.html
The helper binds only to localhost. Monitoring is passive. Explicit parameter
and onboard-log collection returns allowlisted read requests to the observed
vehicle peer; the forwarding route must be bidirectional (MAVProxy mavfwd).
No flight-control commands or configuration writes are available.
It buffers 2048 datagrams; gaps are reported if the browser falls behind.
Use --http-port or --udp-port to select different local ports.

Direct USB telemetry uses browser Web Serial where available. The recorder
monitors the port and writes only explicit evidence read requests. Do not
select a port already owned by your GCS; prefer a
forwarded copy. Supported decoding is a subset of MAVLink common messages.
Raw bytes preserve unknown data. Timestamped telemetry.tlog uses host receipt
time; source clock and camera/display pipeline delays are not measured.
Helper captures preserve the helper's Unix receipt timestamp separately from
browser receipt time in telemetry-receipts.jsonl. With the helper, .tlog uses
that helper receipt time; direct USB uses the browser wall-clock anchor.
Betaflight uses MSP: capture its App window and import Blackbox/support data.

CONNECTED EVIDENCE
Choose a vehicle with a fresh PX4/ArduPilot heartbeat. Collect parameters, or
list onboard logs and collect a selected completed log (up to 32 MiB, disarmed).
Complete files attach to the current session with collection time and target.
If collected before recording, Start recording keeps them in the same session.
Cancellation, missing data or disconnect does not attach incomplete downloads.
Use GCS/SD-card exports for signed links, receive-only mirrors and unsupported
firmware. Betaflight needs App configuration/Blackbox exports; MSP retrieval is
not implemented. Live parameter snapshots are not atomic backups. PX4 uses
bytewise parameter encoding; ArduPilot C-cast values retain float precision limits.

LOCAL EVIDENCE
The session ZIP contains session.json (versioned manifest), timeline.json,
summary.txt, report.md, report.json, selected media and original attachments.
Original filenames, sizes and SHA-256 values are stored. Derived reports are
labeled. ZIP exports are uncompressed and limited to 256 MiB. Capture stops
at 192 MiB, 30,000 timeline entries, 12 MiB of decoded timeline or two hours. Attachments keep originals;
native ULog, DataFlash and Blackbox analysis stays in existing viewers.
Video alignment accepts a manual offset, including negative offsets for video
that began earlier. Developer mode also exposes a clock scale. Check shared
events near the start/end; manual settings do not measure alignment uncertainty.

GUIDED / DEVELOPER MODES
Both use the same evidence. Developer mode adds decoded values, source IDs,
capture status and timing details. Capture completeness, missing report fields
and user-recorded test outcomes are separate. A System Test Lab attachment is
checked against the exact shipped catalog without closing external/human gates.

REPORTS
PX4 / ArduPilot forum drafts: copy the Markdown or open a prefilled composer,
review category/tags, and attach selected files there. Large reports use copy.
Betaflight: collect Submit Support Data's Support ID and original diff all.
Select the firmware bug destination for per-field copying into the official
GitHub form. Review and submit in your own account; attach files separately.
Configuration/community questions go to Betaflight's official Discord.
The GitHub Support ID field adds its own formatting; paste the ID there plainly.
ClickUp: copy/download task Markdown for your selected List or existing task.
Jira Cloud: Guided mode copies a readable report for the task editor. Download
ADF JSON for an API description; Developer mode also previews/copies that JSON.
Direct ClickUp/Jira posting needs
registered public OAuth apps and is not enabled in this local release.

OPTIONAL SLACK UPLOAD
Use an existing Slack app with files:write permission and membership in the
destination channel. Set FORGE_SLACK_TOKEN and FORGE_SLACK_CHANNEL in the
terminal environment before starting the executable or Python launcher. The token stays in the helper;
the browser receives only whether Slack is enabled and the channel identifier.
Do not put tokens in source files or reports. No Slack account is needed for
recording, playback, report formatting or export.

Review the session and select the share confirmation before Send session to
Slack. This sends the complete ZIP and its summary using Slack's external
upload flow. The helper keeps local upload receipts under
~/.forge-session-helper/slack-receipts.json so retries reuse an existing file.
If completion is uncertain, check that file in Slack before clearing a receipt.
Channel permissions, storage and upload limits depend on your Slack workspace.

TROUBLESHOOTING
Permission denied: choose the source again; use HTTPS or localhost.
Browser-to-helper access blocked: use the included app at the helper's local
address. Browsers may require local-network permission.
Missing video/audio: browser and OS capture support vary; import a recording
from OBS or the GCS instead. Audio narration is selected with the camera.
Interrupted recording: reopen its saved entry; existing chunks are retained,
but an interrupted media container may need repair in an external tool.
Storage full: stop and export available evidence, then remove unused sessions.
Another recorder tab: close it and reload. One tab owns local editing at a time
in browsers that support Web Locks.

The app records evidence and user-declared outcomes. It does not certify
airworthiness or official acceptance. Follow the procedure for the selected
test and vehicle; active upstream bench tools are separate from this recorder.
