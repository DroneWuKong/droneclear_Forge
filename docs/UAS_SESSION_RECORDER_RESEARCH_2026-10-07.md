# Forge UAS session recorder research

Reviewed 7 October 2026. Product direction: make it easy to capture and explain a reproducible UAS test session, preserve its original evidence, and prepare a useful support report. Existing tools already provide substantial log analysis, video overlays and synchronized playback. Forge should connect those tools with its build records and System Test Lab.

The proposed first release follows the selected storage model: local sessions with optional sharing. Slack provides team notification; ClickUp and Jira provide task tracking. The research was completed before implementation. The resulting local recorder release and its limits are documented in [SESSION_RECORDER.md](SESSION_RECORDER.md).

The deeper follow-up covers [standard tools, native formats, timing, report destinations and the proposed package contract](UAS_TOOLING_AND_FORMATS_2026-10-07.md). The [test-session SOP](UAS_TEST_SESSION_SOP.md) provides the practical setup → capture → review → report → retest workflow. It includes newly reviewed overlap with PX4's development-tree bench suite and ArduPilot Methodic Configurator.

## Existing tools and overlap

| Ecosystem | Existing capability | Implication for Forge |
| --- | --- | --- |
| PX4 | Flight Review provides flight analysis; PlotJuggler supports detailed plots; Foxglove opens ULog and can visualize selected uORB messages through an extension. [PX4 tool guide](https://docs.px4.io/main/en/log/flight_log_analysis) | Preserve the original `.ulg` file and help users choose an analyzer. |
| ArduPilot | UAV LogViewer accepts `.bin` and `.tlog` and provides plots and replay. [Official viewer guide](https://ardupilot.org/dev/docs/common-uavlogviewer.html) | Reuse the established viewer for detailed flight review. |
| ArduPilot | WebTools includes HardwareReport, FilterReview, PIDReview, StreamStats and other focused tools. Its Video Overlay tool aligns a DataFlash `.bin` log with video and exports the result. [WebTools](https://github.com/ArduPilot/WebTools), [Video Overlay](https://firmware.ardupilot.org/Tools/WebTools/VideoOverlay/) | Log/video overlays and stream-rate analysis already have upstream implementations. |
| Betaflight | Blackbox Explorer supports flight-video alignment and graph/video export. The maintained Blackbox Viewer moved into the Betaflight App with release 2026.6; the standalone project is frozen and schedules archival for 1 December 2026. [Project notice and usage](https://github.com/betaflight/blackbox-log-viewer) | Link to the maintained App and preserve native Blackbox logs. |
| Robotics tooling | Foxglove combines video, plots, maps, annotations and other data in synchronized views, including comparisons between recordings and shared layouts. [Visualization capabilities](https://foxglove.dev/product/visualization) | A synchronized telemetry workspace already exists. Evaluate interoperability before building a comparable analysis suite. |

ArduPilot's MAVLink Dashboard is another relevant reference: its README describes a display tool used alongside a GCS. Its connection UI supports a forwarding WebSocket, including Mission Planner's local endpoint, and an optional outgoing heartbeat. A Forge recorder should make its own receive-only behavior explicit rather than assume another dashboard's connection behavior. [Dashboard README](https://github.com/ArduPilot/WebTools/blob/main/TelemetryDashboard/Readme.md), [connection implementation](https://github.com/ArduPilot/WebTools/blob/main/TelemetryDashboard/TelemetryDashboard.js).

## Forum observations

PX4 users discussing a new raw-field plotter in December 2025 were pointed toward PlotJuggler and running Flight Review locally. A separate May 2024 replay question illustrates confusion between ULog and the `.tlog` files expected by QGroundControl. These threads support better tool discovery and format explanations; the 2025 outage report does not establish a current Flight Review outage. [Plotter discussion](https://discuss.px4.io/t/making-a-mission-planner-style-log-plotter-program/48195), [replay discussion](https://discuss.px4.io/t/replaying-ulogs/39002).

An ArduPilot thread opened in May 2026 lists numerous automated analyzers. Replies discuss integrating analytical tools into configuration workflows and question the credibility of LLM diagnoses. These are individual community views, not a survey or independent evaluation of every listed product. Forge should show measurements and their sources, distinguish observations from possible explanations, and help someone reproduce the problem. [Analyzer discussion](https://discuss.ardupilot.org/t/list-of-automated-ardupilot-flight-log-analysis-software/143635).

A May 2019 Mission Planner user reported telemetry/video playback drifting apart even at nominal normal speed. That historical report motivates testing clock alignment across a complete recording; it does not establish a current Mission Planner defect. [Synchronization discussion](https://discuss.ardupilot.org/t/tlog-playback-speed-inaccurate-video-sync-issue/42318).

## File formats and report structure

| Source | Preserve | Explain to the user |
| --- | --- | --- |
| PX4 | Original `.ulg` ULog, firmware/build identity and relevant parameters. | ULog records self-describing uORB data, including onboard sensor and internal state messages. [ULog specification](https://docs.px4.io/main/en/dev_log/ulog_file_format) |
| ArduPilot | Original DataFlash `.bin` or `.log`, available `.tlog`, firmware identity and parameters. | Onboard DataFlash and ground-station telemetry recordings have different origins and coverage. One cannot stand in for every field in the other. [Log types](https://ardupilot.org/dev/docs/common-logs.html) |
| Betaflight | Native Blackbox files, including `.bbl`/`.bfl` or legacy log files, available support data and video. | Native Blackbox data requires decoding; a CSV export is a derived artifact. Preserve both when available. The arming beep can provide a video/log alignment reference. [Logging guide](https://github.com/betaflight/betaflight.com/blob/master/docs/wiki/guides/current/Black-Box-logging-and-usage.md), [decoder documentation](https://github.com/betaflight/blackbox-tools/blob/master/Readme.md) |

Betaflight exposes MSP, the MultiWii Serial Protocol, for configuration communication. A future live Betaflight adapter needs a separate design; the first version can capture its App screen and attach Blackbox/support files without claiming live MAVLink coverage. [MSP reference](https://betaflight.com/docs/development/MSP-Protocol-Reference-Dev).

For a live MAVLink capture, record packet timing as well as original bytes. Raw packets without timestamps should not simply be renamed `.tlog`. Pymavlink's log writer provides a concrete interoperable format: a big-endian 64-bit microsecond timestamp precedes each recorded message. Validate generated files against actual readers before claiming compatibility. [Pymavlink writer and reader](https://github.com/ArduPilot/pymavlink/blob/master/mavutil.py).

Use an ordinary ZIP for the initial session package: original files, screen/camera media, a versioned JSON manifest, marked observations and a Markdown support report. Preserve original names in the manifest, byte counts, hashes, source information, timing metadata and whether recording ended normally. Hashes support byte-integrity checks; they do not establish who performed a test or whether its conclusion is correct.

For normalized telemetry exchange, evaluate MCAP rather than making Forge's timeline the only usable representation. MCAP defines schemas, channels, attachments and separate recording/publishing times. Keep native logs alongside any conversion. A valid MCAP container still needs meaningful schemas and a tested consumer workflow. [MCAP specification](https://mcap.dev/spec).

Generate support reports with a shared core: expected behavior, actual behavior, reproduction steps, vehicle/hardware, firmware/build, test conditions, relevant timestamps, attached evidence and remaining questions. Add the fields requested by each upstream project:

| Destination | Additional context |
| --- | --- |
| PX4 | Flight-log link when available, PX4 version or `ver all` output, flight controller and vehicle type. [Bug template](https://github.com/PX4/PX4-Autopilot/blob/main/.github/ISSUE_TEMPLATE/bug_report.yml) |
| ArduPilot | Version, vehicle platform, airframe, autopilot hardware, logs and any preceding forum discussion. General support goes to the forum. [Bug template](https://github.com/ArduPilot/ardupilot/blob/master/.github/ISSUE_TEMPLATE/bug_report.md) |
| Betaflight | Support ID from Submit Support Data, flight-controller model, other components and wiring/port details. [Firmware bug template](https://github.com/betaflight/betaflight/blob/master/.github/ISSUE_TEMPLATE/firmware-bug-report.yml) |

Produce a draft for the user to review and copy. Do not automatically submit a support question as a firmware bug.

## Existing Forge functionality

This audit uses Forge commit `58e41e5091c997a8765e3899d8c8d705457eb9e5`.

| Forge surface | Current overlap | Proposed connection |
| --- | --- | --- |
| Builder, Audit and Guide | Component compatibility and assembly records, including guide session notes/photos. | Attach a build reference and available exported records. [Guide state](../forge-source/guide-state.js) |
| PID Tuning | CSV/text gyro parsing and FFT analysis. The upload UI accepts `.bbl`/`.bfl`, but `bbxHandleFile` reads text and `bbxParseAndStore` searches for CSV fields; this path is not a native binary Blackbox decoder. | Correct the supported-format description and use upstream decoding for native files. [Upload/parser implementation](../forge-source/pid-tuning.html) |
| Software Library | Lists the standalone Betaflight Blackbox Explorer. | Update discovery to the maintained Betaflight App. [Library entry](../forge-source/software-library.html) |
| System Test Lab | Local general checks and preparation profiles, with report import and review. | Attach its existing JSON report to a session. [Lab design](SYSTEM_TEST_LAB.md) |
| Intel digest | Slack/Teams webhook notifications for digest items. | Session file sharing needs its own user-facing workflow; the digest webhook is not a general file uploader. [Digest implementation](../workers/digest.js) |

## Proposed first release

1. Start with a short guided form: aircraft/firmware, what the user is testing, what they expect and relevant build information.
2. Capture a selected screen/window and optional camera/audio. For PX4/ArduPilot, optionally receive a forwarded MAVLink stream; allow native logs and prerecorded video to be attached afterward.
3. Let the user mark a moment and describe what happened. Keep the recording, original logs, notes and existing Test Lab report together.
4. Offer guided and developer views over the same evidence. For example, show “vehicle messages paused for three seconds” alongside packet timing and source identifiers. Do not turn missing observations into an asserted aircraft or radio failure.
5. Save locally, replay, and export the ZIP plus a community-specific support report. Provide instructions and links for opening the original log in an existing analyzer. Do not upload it to an analyzer automatically.
6. Offer Slack sharing and ClickUp/Jira task tracking, with a preview of the report, chosen files and destination. Slack's external file-upload flow requires obtaining an upload URL, transferring bytes and completing the upload with a destination channel. [Slack file workflow](https://docs.slack.dev/messaging/working-with-files/).

Browser screen capture requires a secure context, a user action and permission; browser/OS audio support varies. Web Serial has limited browser availability. Offer imports and a local forwarding helper where direct capture is unavailable. [Screen capture requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [Web Serial availability](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).

Store receipt time, available source time and each media track's start time separately. Support manual alignment, record how it was chosen, and test drift over longer sessions. Clock resets, reconnects and capture gaps must remain visible. A browser receive timestamp alone cannot establish camera-to-display latency or flight-controller execution latency.

## ClickUp and Jira integration

The session should offer three task actions: prepare a report, create a new task or issue, and add evidence to an existing one. Each destination uses the same session information: expected/actual behavior, reproduction steps, aircraft and firmware/build, marked times, selected recordings/logs, and test results. Preserve the returned task URL or issue key in the local session so a later retest can be attached to the same work item.

| Destination | Creation and evidence | Formatting |
| --- | --- | --- |
| ClickUp | Choose a Workspace/List; create a task or add a comment and attachments to an existing task. Task creation supports assignees, priority, tags and custom fields. | Generate a Markdown description. Use destination fields rather than assuming every List has the same configuration. [Create Task](https://developer.clickup.com/reference/createtask), [task comments](https://developer.clickup.com/reference/createtaskcomment) |
| Jira Cloud | Choose a site, project and issue type, then retrieve required-field metadata. Create an issue or add a comment/attachments to an existing issue. | Convert the structured report to Atlassian Document Format for the description; a raw Markdown string is not the Jira v3 description format. [Issue API specification](https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json), [document format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) |

Upload selected evidence after the work item has been created. ClickUp's documented attachment API uses multipart files and permits up to 1 GB per file, subject to account storage. Jira exposes attachment settings, including whether uploads are enabled and the instance's maximum size; its upload requires multipart data and `X-Atlassian-Token: no-check`. Check these limits before uploading a recording. If a file cannot be attached, keep it local and offer the summary plus manual export, or an existing accessible URL chosen by the user. A local file path is not a team recording link. [ClickUp attachments](https://developer.clickup.com/docs/attachments), [Jira attachments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/).

For public account connections, use registered OAuth apps. ClickUp directs integrations used by other people to its OAuth flow. Atlassian directs distributable Jira Cloud integrations to a single OAuth 2.0 app and disallows collecting customers' API tokens or asking each customer to create their own OAuth app. This changes the connected-sharing architecture: provide an authentication service for the registered apps while session capture/storage remains local. OAuth client secrets must stay outside the public browser bundle and distributed helper. Copy/download exports can work before account connections are configured. [ClickUp authentication](https://developer.clickup.com/docs/authentication), [Jira Cloud OAuth](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

Track task creation and each attachment separately. If an upload fails after a task was created, show its existing link and retry only missing evidence; do not silently create another task. Slack can then share the task/issue URL and a short summary. Jira Data Center requires a separate adapter and is outside this initial Jira Cloud design.

## Further testing features

Useful follow-ups are evidence-completeness checks, recording-gap summaries, configuration comparisons between sessions, marked before/after comparisons and links from a test requirement to its actual evidence. A recording can show a problem while still being too incomplete to explain its cause.

For repeatable simulation testing, reuse PX4's MAVSDK integration tests and ArduPilot's AutoTest framework. Both already provide paths for software-in-the-loop testing. Forge can document selected scenarios and collect their results instead of creating another simulator. [PX4 integration tests](https://docs.px4.io/main/en/test_and_ci/integration_testing_mavsdk), [ArduPilot AutoTest](https://ardupilot.org/dev/docs/the-ardupilot-autotest-framework.html).

Gauntlet and DoW preparation should continue using the existing Lab profiles and their source/version identifiers. Session evidence can support an individual check; it does not close physical, independent, organizational or official acceptance gates. [Existing profile scope](SYSTEM_TEST_LAB.md).
