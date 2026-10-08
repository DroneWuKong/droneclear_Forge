# Forge UAS Session Recorder

Version 1.0.0, 7 October 2026. Public route: `/session-recorder/`. The app is free, with local browser storage, guided/developer views and a downloadable Python standard-library helper. It records evidence around existing tools and attaches System Test Lab output.

## What this release does

- Record an app/window or screen, camera/USB video capture, and optional microphone narration using browser MediaRecorder.
- Monitor and record receive-only MAVLink through Web Serial or a localhost UDP copy alongside the existing GCS. Ten common message types are decoded with named units. Unknown bytes and signatures remain in the original capture.
- Mark events, save chunks to IndexedDB, reopen sessions, recover committed evidence after interruption, and replay video with the telemetry timeline. Manual offset and clock-scale adjustments remain labeled with unmeasured uncertainty.
- Preserve multiple original ULog, DataFlash, Blackbox, configuration, mission, video and test-output attachments. Existing analyzers handle their native contents.
- Check attached System Test Lab reports against the exact shipped catalog. General, Gauntlet and DoW profile summaries retain human/external gates and self-recorded claims.
- Export/import an ordinary ZIP with SHA-256 hashes, raw telemetry, timestamped `.tlog`, a receipt ledger, media, originals and reports. Validate hashes and decoded packet identity when importing.
- Generate PX4/ArduPilot forum drafts, Betaflight support context, ClickUp task Markdown and Jira Cloud ADF. Forum posting and attachments remain user-reviewed actions in the destination.
- Optionally upload a reviewed complete ZIP to a configured Slack channel through the local helper. Credentials stay in the helper environment. Persistent receipts reuse a completed upload and block blind retries after uncertain completion.

Direct ClickUp/Jira posting, MSP capture, RTSP ingestion, native flight-log analysis, automatic flight control and requirement certification are outside this release. This app does not register OAuth integrations or provision Slack workspaces.

## Run locally

Download `/session-recorder/forge-session-helper.zip`, extract it, and run `python3 bridge.py` (Windows may use `python bridge.py`). Open the printed localhost URL. Python 3.9+ is sufficient; no packages are required. Copy its printed connection key to the app to enable the bridge. Recording/export work without an account or internet.

For network telemetry, forward a copy from the existing GCS/MAVProxy/router to `127.0.0.1:14551`. The helper binds to localhost and reads datagrams; it sends no vehicle commands. The packaged [README](../forge-source/session-helper/README.txt) explains optional Slack environment variables, ports and recovery. The [test-session SOP](UAS_TEST_SESSION_SOP.md) provides the general procedure.

Sessions belong to the browser origin, including its port. Use the same address to reopen them. Export before clearing browser data; a ZIP can move evidence between installations. The web app caches its recorder shell for offline reopening after an initial visit. Browser/OS capture support varies; Chromium desktop is the initial tested path.

## Evidence and timing contract

`session.json` is the schema-version-1 manifest. `timeline.json` contains local receipt observations and notes; `summary.txt`, `report.md` and `report.json` are derived outputs. Media uses WebM or MP4 according to runtime support. Original attachments use unique `originals/<id>/<safe-name>` paths while retaining their original names in the manifest.

`telemetry.mavlink` preserves received raw bytes. `telemetry-receipts.jsonl` records chunk offsets, lengths, browser receipt milliseconds and helper Unix receipt nanoseconds when available. `telemetry.tlog` prefixes complete frames with an unsigned big-endian 64-bit microsecond receipt timestamp. Helper timestamps avoid assigning browser polling delay to packet arrival; direct serial uses the session wall-clock anchor plus monotonic browser receipt time. These remain receipt clocks, with no source clock synchronization or sensor/video latency measurement.

CRC checks detect corruption and hashes check byte integrity. Authorship, signatures and test claims are not authenticated. Unknown message CRCs are not checked. Routed sequence gaps do not establish radio packet-loss percentages. Capture state, missing report evidence, user-recorded test outcome and external acceptance stay separate.

Capture stops at 192 MiB, 30,000 timeline entries, 12 MiB of decoded timeline or two hours. A final media chunk may exceed the capture threshold; retained evidence plus attachments is bounded at 240 MiB and ZIP export at 256 MiB. Interrupted containers may require repair in an external tool. Mobile layouts reflow; mobile screen/serial capture is not assured.

## Validation

The release is checked with independently generated pymavlink 2.4.49 MAVLink v1/v2/signed fixtures, ZIP/hash/tamper and timing tests, localhost bridge restrictions, and mocked Slack upload/retry tests. Pymavlink independently read an exported `.tlog` with the expected source and microsecond timestamp.

Chromium browser checks use real MediaRecorder encoding and IndexedDB with synthetic video inputs and upstream telemetry fixtures. They cover local save/reopen, original attachments, alignment/replay, report formatting, catalog validation, import rejection, interrupted recovery, offline reopening, and 320/390/1440-pixel layouts. Forge's existing Test Lab, navigation, accessibility and built-site checks also run. CI includes these checks.

This evidence is software validation. Physical aircraft, real USB/camera/microphone hardware across operating systems, and live Slack workspace permissions have not been qualified by these tests. The free local app does not depend on those account integrations to record or export.

## Implementation

`session-recorder.js` controls capture/replay; `session-store.js` owns atomic IndexedDB saves; `session-evidence.js` owns wire parsing and the bundle format; `session-reports.js` owns destination templates. `session-helper/bridge.py` provides localhost HTTP/UDP and Slack upload. `tools/build_session_recorder.py` packages only selected public files reproducibly through the existing Forge build. The recorder route enables camera, microphone and display capture in Pages headers.

The background Gauntlet service remains stopped. This release neither starts it nor executes aircraft tests automatically.
