# Forge UAS Session Recorder

Version 1.2.0, 8 October 2026. Public route: `/session-recorder/`. The app is free, with local browser storage, guided/developer views and standalone Windows/Linux x64 packages. It records evidence around existing tools and attaches System Test Lab output.

## What this release does

- Record up to eight chosen windows/screens and camera/USB video inputs together, with independent names, previews and files. Add each display through its own picker. Optional microphone narration is included once; an ended input is marked without stopping the others.
- Monitor and record passive MAVLink through Web Serial or a localhost UDP copy alongside the existing GCS. Thirteen common message types are decoded with named units. Unknown bytes and signatures remain in the original capture.
- Collect complete PX4/ArduPilot parameter snapshots and selected onboard logs over writable USB MAVLink or a bidirectional localhost UDP route. Files attach to the session before or after recording, with target and collection time. Incomplete downloads are discarded; transfers can be cancelled. Signed links use authenticated GCS exports. Log reads require a fresh disarmed heartbeat and are capped at 32 MiB per file.
- Use the full desktop width: setup beside capture on wide windows, expanding preview columns, focused input/replay views and a Fullscreen workspace button. Mobile layouts remain stacked.
- Mark events, save chunks to IndexedDB, reopen sessions, recover committed evidence after interruption, and replay video with the telemetry timeline. Manual offset and clock-scale adjustments remain labeled with unmeasured uncertainty.
- Cold-start offline from a bundled executable with an installed desktop Chromium browser. Connect to local UDP automatically, save completed session ZIPs atomically in a field folder, and reopen them independently of browser storage. Updated reports/attachments have an explicit Save updated disk copy action.
- Share the live team view through normal Teams or Google Meet window sharing. Show previews, recent supported telemetry with observation age, local recording status and marked events while capture continues. Internet/meeting loss does not stop local capture; meeting chat/audio is not automatically ingested.
- Preserve multiple original ULog, DataFlash, Blackbox, configuration, mission, video and test-output attachments. Existing analyzers handle their native contents.
- Check attached System Test Lab reports against the exact shipped catalog. General, Gauntlet and DoW profile summaries retain human/external gates and self-recorded claims.
- Export/import an ordinary ZIP with SHA-256 hashes, raw telemetry, timestamped `.tlog`, a receipt ledger, media, originals and reports. Validate hashes and decoded packet identity when importing.
- Generate PX4/Dronecode and ArduPilot forum drafts, collect separate flight-controller, component and wiring details and copy fields matching Betaflight’s official firmware bug form (including the unwrapped Support ID), route configuration questions to its official community, and export ClickUp task Markdown and Jira Cloud ADF. Forum posting and attachments remain user-reviewed actions in the destination.
- Keep Guided setup short, expand technical fields in Developer mode, and provide direct choose/record/review navigation. Attachments preserve report drafts. Jira's Guided copy is readable editor text; its download and Developer copy remain ADF JSON.
- Optionally upload a reviewed complete ZIP to a configured Slack channel through the local helper. Credentials stay in the helper environment. Persistent receipts reuse a completed upload and block blind retries after uncertain completion.

Direct ClickUp/Jira posting, MSP capture, RTSP ingestion, native flight-log analysis, automatic flight control and requirement certification are outside this release. This app does not register OAuth integrations or provision Slack workspaces.

## Run locally

Download the Windows x64 or Linux x64 standalone ZIP from the recorder page, extract it, and run `Forge-UAS-Recorder.exe` (Windows) or `./Forge-UAS-Recorder` (Linux; set executable permission if necessary). The executable includes Python and every recorder asset. Install Edge, Chrome or Chromium before field use. The app opens the default browser and connects to the localhost helper automatically; use the printed URL in Chromium if another browser is your default. The Linux release is built on Ubuntu 22.04 with glibc 2.35. Packages are unsigned.

Completed captures also save under `~/.forge-uas-recorder/sessions` (`~` is the user's home directory on both platforms). Select Save updated disk copy after editing or attaching logs. Browser chunks are retained during recording, but the automatic disk copy happens after a normal stop; interrupted browser evidence still uses the existing recovery path. Disk copies can be opened after browser data is cleared. `--session-dir PATH`, `--http-port`, `--udp-port` and `--no-browser` are available.

The source fallback `/session-recorder/forge-session-helper.zip` requires Python 3.9+ but no pip packages. Run `Start-Recorder.cmd` or `python3 desktop.py`. Advanced `bridge.py` usage remains available with its printed connection key and without an automatic field folder.

For network telemetry, forward a copy from the existing GCS/MAVProxy/router to `127.0.0.1:14551`. The helper binds to localhost and monitors datagrams. Explicit evidence collection sends only allowlisted MAVLink parameter/log read requests and log-transfer cleanup to the observed peer. It validates CRC, bounds, fresh target heartbeat and disarmed log access, with a 20-request/second limit. A receive-only mirror cannot perform downloads. MAVProxy forwarding requires its bidirectional `mavfwd` setting for this workflow; retain GCS exports as the fallback. The packaged [README](../forge-source/session-helper/README.txt) explains optional Slack environment variables, ports and recovery. The [test-session SOP](UAS_TEST_SESSION_SOP.md) provides the general procedure.

Browser sessions belong to their origin, including its port. Use the same address to reopen them. A field-folder ZIP or download can move evidence between installations. The public web app caches its recorder shell for offline reopening after an initial visit; the standalone package includes those assets for a first offline launch. Browser/OS capture support varies; Chromium desktop is the initial tested path.

## Live team procedure

Select capture inputs and start local recording, join your normal Teams/Meet meeting, choose Live team view, and share the recorder window. The [live team guide](../forge-source/session-helper/LIVE_TEAM_GUIDE.txt) describes sharing, source selection and reconnecting. These are standard meeting screen shares, with no native meeting SDK, hosted relay or remote aircraft control. A meeting connection is separate from localhost capture and disk persistence.

## Evidence and timing contract

`session.json` is the schema-version-1 manifest. `timeline.json` contains local receipt observations and notes; `summary.txt`, `report.md` and `report.json` are derived outputs. Media uses WebM or MP4 according to runtime support. The first inputs retain `screen.webm`/`camera.webm` (or MP4); subsequent inputs use `screen-2.webm`, `camera-2.webm`, etc. Input IDs, labels, per-input status and file links remain in the manifest. Older single-input bundles remain supported. Collected `.params` files use tab-separated system/component/name/value/type rows; PX4 integers use bytewise decoding, ArduPilot uses its C-cast encoding. These are live snapshots rather than atomic vehicle backups, with inherent C-cast float precision limits. Original attachments use unique `originals/<id>/<safe-name>` paths while retaining their original names in the manifest.

`telemetry.mavlink` preserves received raw bytes. `telemetry-receipts.jsonl` records chunk offsets, lengths, browser receipt milliseconds and helper Unix receipt nanoseconds when available. `telemetry.tlog` prefixes complete frames with an unsigned big-endian 64-bit microsecond receipt timestamp. Helper timestamps avoid assigning browser polling delay to packet arrival; direct serial uses the session wall-clock anchor plus monotonic browser receipt time. These remain receipt clocks, with no source clock synchronization or sensor/video latency measurement.

CRC checks detect corruption and hashes check byte integrity. Authorship, signatures and test claims are not authenticated. Unknown message CRCs are not checked. Routed sequence gaps do not establish radio packet-loss percentages. Capture state, missing report evidence, user-recorded test outcome and external acceptance stay separate.

Capture stops at 192 MiB, 30,000 timeline entries, 12 MiB of decoded timeline or two hours. A final media chunk may exceed the capture threshold; retained evidence plus attachments is bounded at 240 MiB and ZIP export at 256 MiB. Interrupted containers may require repair in an external tool. Mobile layouts reflow; mobile screen/serial capture is not assured.

## Validation

The release is checked with independently generated pymavlink 2.4.49 MAVLink v1/v2/signed fixtures, ZIP/hash/tamper and timing tests, localhost bridge restrictions, and mocked Slack upload/retry tests. Pymavlink independently read an exported `.tlog` with the expected source and microsecond timestamp.

Chromium browser checks use real MediaRecorder encoding and IndexedDB with synthetic video inputs and upstream telemetry fixtures. They cover local save/reopen, original attachments, alignment/replay, report formatting, catalog validation, import rejection, interrupted recovery, offline reopening, and 320/390/1366/1920/2560-pixel layouts. Forge's existing Test Lab, navigation, accessibility and built-site checks also run. CI includes these checks.

Native CI builds each executable on its target Windows/Linux runner. A fresh Chromium profile loads bundled assets with all non-loopback requests blocked, records three synthetic windows, two cameras and one microphone, tests duplicate/cancelled input selection and the eight-input limit, interrupts one source while the others continue, exercises fullscreen, collects independently generated parameter/log responses through the actual helper, switches live/workspace views during capture, exports reports and reopens a disk copy in a new profile. Archive/authentication tests cover integrity failures, replacement, symlinks, path rejection and cross-origin bootstrap restrictions. This is software evidence; real Teams/Meet participants, field connectivity, hardware and code signing remain unqualified.

The [user journey review](SESSION_RECORDER_USER_JOURNEYS_2026-10-08.md) records novice, developer and live-team walkthrough findings and their fixes. Automated browser checks cover first-use navigation, review focus, draft retention, Jira clipboard/ADF behavior and mobile reflow. This is a scenario-based review, with no recruited participant study or measured human completion rates.

This evidence is software validation. Physical aircraft, real USB/camera/microphone hardware across operating systems, and live Slack workspace permissions have not been qualified by these tests. The free local app does not depend on those account integrations to record or export.

## Implementation

`session-recorder.js` controls capture/replay; `session-media.js` manages independent chosen inputs; `session-vehicle.js` manages bounded read-only evidence transfers; `session-store.js` owns atomic IndexedDB saves; `session-evidence.js` owns wire parsing and the bundle format; `session-reports.js` owns destination templates. `session-helper/bridge.py` provides localhost HTTP/UDP, atomic field-folder ZIPs and Slack upload; `desktop.py` launches it. `tools/build_session_recorder.py` packages selected public files reproducibly through the existing Forge build. `tools/build_session_desktop.py` freezes the runtime on each OS. The desktop CI publishes versioned ZIPs, SHA-256 files, source/build metadata and runtime license notices to GitHub Releases after both platforms pass. The recorder route enables camera, microphone and display capture in Pages headers.

The background Gauntlet service remains stopped. This release neither starts it nor executes aircraft tests automatically.

## Upstream format references

- [Screen Capture API](https://www.w3.org/TR/screen-capture/): each display selection requires the user's click and its own browser picker.
- [MAVLink parameter protocol](https://mavlink.io/en/services/parameter.html) and [common log messages](https://mavlink.io/en/messages/common.html#LOG_REQUEST_LIST): parameter encodings, indexed retries, log listing/data and transfer cleanup.
- [MAVProxy forwarding](https://ardupilot.org/mavproxy/docs/getting_started/forwarding.html) and [settings](https://ardupilot.org/mavproxy/docs/getting_started/settings.html): forwarding copies and `mavfwd` for requests.
- [Dronecode/PX4 forum](https://discuss.px4.io/), [Betaflight firmware bug form](https://github.com/betaflight/betaflight/blob/master/.github/ISSUE_TEMPLATE/firmware-bug-report.yml) and [support routing](https://github.com/betaflight/betaflight/blob/master/.github/ISSUE_TEMPLATE/config.yml): official destinations and field labels reviewed on 8 October 2026. The current Betaflight form lacks field IDs for reliable URL prefilling; individual field copying remains available offline.
