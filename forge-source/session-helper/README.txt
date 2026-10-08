Forge UAS Session Recorder 1.0
Free local recording and evidence export. Python 3.9 or newer; no Python packages required.

QUICK START
1. Extract the complete ZIP.
2. Open a terminal in the extracted directory and run: python bridge.py
   On Linux/macOS the command may be: python3 bridge.py
3. Open the localhost address printed by the helper.
4. Copy its Connection key into the recorder and select Connect local helper.
5. Choose a screen and/or camera, or start a notes-only session. Select your
   stack and test environment, explain the expected behavior, and mark moments.
6. Stop, attach original logs/configuration, reopen the evidence, then export.

SOP.md provides the general session procedure and report template.
The included app runs without internet. Local browser sessions belong to the
browser origin (including its port): use the same address/port next time, or
export a ZIP to move evidence. Clearing browser data deletes browser sessions.
Download the session before clearing it. The helper does not host team links.

NETWORK TELEMETRY
Keep your existing GCS connected and forward a copy to 127.0.0.1 UDP 14551.
Use the forwarding options of Mission Planner, QGroundControl, MAVProxy or
MAVLink Router. Setup reference:
https://ardupilot.org/mavproxy/docs/getting_started/forwarding.html
The helper binds only to localhost and never sends anything to the aircraft.
It buffers 2048 datagrams; gaps are reported if the browser falls behind.
Use --http-port or --udp-port to select different local ports.

Direct USB telemetry uses browser Web Serial where available. The recorder
only reads the port. Do not select a port already owned by your GCS; prefer a
forwarded copy. Supported decoding is a subset of MAVLink common messages.
Raw bytes preserve unknown data. Timestamped telemetry.tlog uses host receipt
time; source clock and camera/display pipeline delays are not measured.
Helper captures preserve the helper's Unix receipt timestamp separately from
browser receipt time in telemetry-receipts.jsonl. With the helper, .tlog uses
that helper receipt time; direct USB uses the browser wall-clock anchor.
Betaflight uses MSP: capture its App window and import Blackbox/support data.

LOCAL EVIDENCE
The session ZIP contains session.json (versioned manifest), timeline.json,
summary.txt, report.md, report.json, selected media and original attachments.
Original filenames, sizes and SHA-256 values are stored. Derived reports are
labeled. ZIP exports are uncompressed and limited to 256 MiB. Capture stops
at 192 MiB, 30,000 timeline entries or two hours. Attachments keep originals;
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
The GitHub Support ID field adds its own formatting; paste the ID there plainly.
ClickUp: copy/download task Markdown for your selected List or existing task.
Jira Cloud: download ADF JSON for an API description; select General for a
human-readable report to paste in the editor. Direct ClickUp/Jira posting needs
registered public OAuth apps and is not enabled in this local release.

OPTIONAL SLACK UPLOAD
Use an existing Slack app with files:write permission and membership in the
destination channel. Set FORGE_SLACK_TOKEN and FORGE_SLACK_CHANNEL in the
terminal environment before starting bridge.py. The token stays in the helper;
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
