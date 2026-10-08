# UAS tools, formats and reporting research

Reviewed 7 October 2026. This extends the [recorder research and Forge overlap audit](UAS_SESSION_RECORDER_RESEARCH_2026-10-07.md). The companion [test-session SOP](UAS_TEST_SESSION_SOP.md) turns these findings into a proposed workflow.

The strongest direction for Forge is a free, local session recorder that connects established UAS tools, preserves usable evidence and prepares destination-specific reports. Synchronized visualization already exists. The product opportunity is making the whole path from setup to retest easy for both developers and people seeking help.

The SOP combines upstream practices into a proposed Forge workflow. Each vehicle and named acceptance profile retains its own requirements. The implemented first release is documented separately in [SESSION_RECORDER.md](SESSION_RECORDER.md); the broader design targets below remain proposals.

## Established tools

| Work | Tools and upstream workflow | Proposed Forge role |
| --- | --- | --- |
| Configure and document a vehicle | QGroundControl, Mission Planner and the Betaflight App are the existing stack-specific interfaces. ArduPilot Methodic Configurator adds component/connection records, ordered configuration steps and explanations of parameter changes. [Methodic Configurator](https://github.com/ArduPilot/MethodicConfigurator) | Attach the configuration baseline, component inventory and change reasons to a session. Link the relevant setup instructions. |
| Analyze PX4 flight behavior | Flight Review, PlotJuggler and Foxglove appear in PX4's official analysis guide. [PX4 analysis tools](https://docs.px4.io/main/en/log/flight_log_analysis) | Preserve ULog and prepare the relevant moments and questions for those tools. |
| Analyze ArduPilot behavior | UAV LogViewer and the focused WebTools cover different analysis tasks. WebTools also supplies video overlay and stream statistics tools. [UAV LogViewer](https://ardupilot.org/dev/docs/common-uavlogviewer.html), [WebTools](https://github.com/ArduPilot/WebTools) | Recommend the appropriate upstream tool rather than duplicate every analyzer. |
| Analyze Betaflight behavior | Blackbox Viewer is maintained inside the Betaflight App from 2026.6. The standalone viewer is frozen and scheduled for archival on 1 December 2026. [Migration notice](https://github.com/betaflight/blackbox-log-viewer) | Import native files and support data; direct detailed analysis to the maintained App. |
| Record a screen or GCS | OBS already provides local screen recording and remuxing. [OBS recording guide](https://obsproject.com/kb/standard-recording-output-guide) | Support existing recordings as well as convenient in-app capture. |
| Route or record MAVLink | MAVProxy records telemetry; MAVLink Router forwards UART, UDP and TCP traffic. [MAVProxy logs](https://ardupilot.org/mavproxy/docs/getting_started/logfiles.html), [MAVLink Router](https://github.com/mavlink-router/mavlink-router) | Receive a forwarded copy alongside the user's GCS and document the capture topology. |
| Record companion-computer data | ROS 2 rosbag2 records and replays topics, with storage backends and QoS configuration. [Jazzy recorder documentation](https://github.com/ros2/rosbag2/blob/jazzy/README.md) | Attach an existing bag and its metadata initially; add a ROS adapter after the basic recorder works. |
| Inspect synchronized robotics data | Foxglove combines plots, video, maps and other views. Its current free plan lists three visualization users, 10 GB storage and one project. [Visualization](https://foxglove.dev/product/visualization), [pricing checked on review date](https://foxglove.dev/pricing) | Make evidence portable to an established workspace. Forge's core capture must work without a paid visualization account. |

These are complementary tools, not one universal stack. Live Betaflight support needs an MSP adapter; capturing its App window and attaching Blackbox files is a useful first release without claiming MAVLink coverage. [MSP reference](https://betaflight.com/docs/development/MSP-Protocol-Reference-Dev).

## Testing beyond recording

Recording, running a test and deciding whether it passed are separate operations. Forge should keep their results separate too.

| Test level | Existing upstream path | Evidence Forge should collect |
| --- | --- | --- |
| Unit and build checks | Stack-specific build/test commands. | Exact command, source commit, build target, dependencies, exit status and original output. |
| Simulator integration | PX4 recommends MAVSDK integration tests, primarily developed for SITL. ArduPilot AutoTest supports selected vehicle tests and reproducible regressions. Betaflight documents SITL and its App connection. [PX4 MAVSDK tests](https://docs.px4.io/main/en/test_and_ci/integration_testing_mavsdk), [ArduPilot AutoTest](https://ardupilot.org/dev/docs/the-ardupilot-autotest-framework.html), [Betaflight SITL](https://betaflight.com/docs/development/SITL) | Scenario, simulator/model, firmware/configuration, selected case, simulation speed, native logs and result. |
| Real controller on a bench | PX4's current development tree includes `Tools/bench_test`, or px4bench. It exercises boot health, repeated protocol operations, storage, log transfer and reconnect behavior. [Bench-suite reference](https://github.com/PX4/PX4-Autopilot/blob/main/Tools/bench_test/README.md) | Firmware identity, test output, timed failures, skips and generated artifacts. |
| Simulation on controller hardware | px4bench also has an SIH mission stage, conditional on firmware support. This stage changes configuration and arms the controller in simulation; upstream imposes a bare-board/operator gate. | Explicit test mode, upstream gate outcome, changed/restored settings and ULog. |
| Physical flight or acceptance work | The applicable vehicle procedures and named requirement profile govern the activity. | Human observations, conditions, original recordings/logs and the exact requirement/version being assessed. |

px4bench was inspected on `main`; availability and supported features must be checked against the user's release and board. Its firmware gate stamps `firmware.json`, while the suite currently determines PASS/FAIL/SKIP from subprocess outcomes and prints a summary. It does not provide a universal JUnit report that Forge can assume exists. [Reporter implementation](https://github.com/PX4/PX4-Autopilot/blob/main/Tools/bench_test/px4bench/__init__.py), [suite implementation](https://github.com/PX4/PX4-Autopilot/blob/main/Tools/bench_test/run_bench_suite.py).

Receiving telemetry is different from these active tests. A forwarded connection can still permit sending messages: MAVLink Router's default TCP clients can both send and receive. Forge's passive recorder therefore needs its own receive-only behavior. Parameter download, changing message rates, rebooting, flashing, mission upload and arming belong to explicitly selected tool actions, not automatic capture setup.

Use the existing [System Test Lab](SYSTEM_TEST_LAB.md) for general checks and Gauntlet/DoW preparation profiles. Attach its report and profile identity rather than introduce another general runner. Simulation or recording evidence does not satisfy a physical, independent, signer or human requirement by itself.

## Native evidence and exchange formats

Preserve original bytes, original filenames and the producing tool/version. Derived files supplement the original. An extension alone is insufficient to identify a format.

| Artifact | Established format or convention | Forge handling |
| --- | --- | --- |
| PX4 onboard log | `.ulg`, using the self-describing binary ULog format; includes message definitions, metadata, parameters and dropout information. [ULog specification](https://docs.px4.io/main/en/dev_log/ulog_file_format) | Retain the full original, including metadata and dropout records. |
| ArduPilot onboard log | DataFlash binary `.bin` or textual `.log`; onboard and GCS telemetry logs have different coverage. [ArduPilot log types](https://ardupilot.org/dev/docs/common-logs.html) | Identify its origin; preserve it alongside any telemetry capture. |
| Betaflight onboard log | Native compressed Blackbox data, commonly `.bbl`/`.bfl`, with legacy naming also encountered. `blackbox_decode` produces CSV. [Logging guide](https://github.com/betaflight/betaflight.com/blob/master/docs/wiki/guides/current/Black-Box-logging-and-usage.md), [decoder documentation](https://github.com/betaflight/blackbox-tools/blob/master/Readme.md) | Use a compatible decoder. A text read is not binary decoding. Keep native headers and original data. |
| MAVLink ground capture | MAVProxy conventionally saves a timestamped `.tlog` and a raw companion. Pymavlink writes a big-endian unsigned 64-bit microsecond timestamp before each packet. [Writer/reader](https://github.com/ArduPilot/pymavlink/blob/master/mavutil.py) | Preserve all received bytes and receipt timing. Export `.tlog` only through a verified writer; retain raw data and any undecodable portions. |
| ROS 2 recording | A rosbag2 directory can contain `metadata.yaml` and multiple storage files, including `.mcap` or `.db3`. | Preserve the complete recording, topic/type definitions, distro, middleware and relevant QoS configuration. Do not silently keep only the first split file. |
| QGC parameter export | Tab-separated vehicle ID, component ID, name, value and MAVLink parameter type, with `#` comments. [QGC parameter format](https://docs.qgroundcontrol.com/Stable_V5.0/en/qgc-dev-guide/file_formats/parameters.html) | Preserve type and component identity; do not convert every value to an untyped float. |
| MAVProxy parameter export | Pymavlink's parameter helper uses name/value text and accepts comma or whitespace separation when loading. [Parameter helper](https://github.com/ArduPilot/pymavlink/blob/master/mavparm.py) | Identify the producer and available metadata; distinguish this dialect from QGC's five-column format. |
| Betaflight configuration | Version/support data and CLI `diff all` are useful context in its support workflow. [Support procedure](https://betaflight.com/docs/wiki/getting-started/hardware-support) | Save the text verbatim with firmware/App version. Show changes between sessions without automatically applying them. |
| Mission and flight plan | QGC `.plan` is versioned JSON and can include mission, fence and rally data. Older `QGC WPL 110` text carries mission rows and is not an official MAVLink file standard. [QGC Plan format](https://docs.qgroundcontrol.com/Stable_V5.0/en/qgc-dev-guide/file_formats/plan.html), [MAVLink file conventions](https://mavlink.io/en/file_formats/) | Retain native plan objects and coordinate/altitude frames. Flattening a plan to waypoint text can discard planning information. |
| Video/audio | Preserve the actual media container, codecs and timestamps. Browser recording formats depend on runtime support. [MediaRecorder format check](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static) | Store actual MIME/codec information. Offer a tested MP4 derivative when needed; renaming WebM does not convert it. |
| Automated results | JUnit XML is a useful CI convention. Pytest provides an exporter and documents schema compatibility limits. [Pytest JUnit output](https://docs.pytest.org/en/stable/how-to/output.html) | Keep the original result and stdout/stderr. Add a conservative JUnit export alongside versioned Forge JSON where meaningful. |

DataFlash's unit/multiplier metadata matters: the logger explicitly warns against inferring scaling from a unit name. The parser must account for format definitions and available multiplier records. [Logger format notes](https://github.com/ArduPilot/ardupilot/blob/master/libraries/AP_Logger/README.md), [format structures](https://github.com/ArduPilot/ardupilot/blob/master/libraries/AP_Logger/LogStructure.h).

For video imported from OBS, its guide recommends MKV to tolerate an interrupted recording and supports later remuxing. That is an OBS workflow, not a guarantee about browser MediaRecorder output. `ffprobe` can inspect stream/container metadata and emit JSON; a helper can use it when installed. Remuxing and transcoding should produce documented derivatives while retaining originals. [ffprobe documentation](https://ffmpeg.org/ffprobe.html).

### MCAP interoperability

MCAP is a good candidate for an additional normalized export. Its records provide schemas, channels, indexes and separate recording/publishing timestamps. Timestamps use nanoseconds from a documented, user-understood epoch, which can be Unix time or boot time. Missing publish time falls back to recording time; the export must state that limitation. [MCAP specification](https://mcap.dev/spec).

A Forge JSON message channel can use registered `json` message encoding and `jsonschema` schema encoding. ROS 2 profiles instead use CDR with ROS message/IDL definitions and QoS metadata. The registry inspected does not define a turnkey MAVLink profile. A Forge adapter must define its schema, units, frame conventions and clock mapping, then verify actual Foxglove behavior. MCAP should supplement native logs, not be required to use the first recorder. [MCAP registry](https://mcap.dev/spec/registry).

## Timing and measurement correctness

Store four things separately: local monotonic receipt time, wall-clock anchor, available source timestamp and media presentation time. Add the clock's epoch/unit, source, mapping method and uncertainty. Reboots, reconnects and simulation-clock resets start new clock segments.

MAVLink TIMESYNC exchanges can estimate offsets using round-trip timing. They are active messages, not a property acquired merely by receiving telemetry. A passive recorder may record existing synchronization information, or use explicit manual alignment, without claiming it performed synchronization. [TIMESYNC protocol](https://mavlink.io/en/services/timesync.html).

Browser media chunks do not arrive at exact requested intervals. Background tasks and platform behavior can delay them; chunk count multiplied by `timeslice` is not elapsed time. Keep a separate monotonic timer and verify alignment against the media timeline. [MediaRecorder delivery semantics](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).

Use a visible/audible shared event to align imported media, record at least a start and end reference when precision matters, and inspect drift. A proposed mapping is `session_time = offset + scale × source_time`, per continuous clock segment. Store how the mapping was obtained and the observed residual error. When only one reference is available, offset is estimated and drift remains unmeasured. Never label browser receipt timing as measured aircraft execution latency.

For each measured field preserve its raw value, decoded value, unit, coordinate frame, source instance and unavailable-value meaning. PX4 and ROS commonly differ in NED/ENU world frames and FRD/FLU body frames. A conversion must name both frames and the transform; changing labels alone is incorrect. [PX4 ROS 2 frame conventions](https://docs.px4.io/main/en/ros2/user_guide).

Three MAVLink interpretation rules are especially relevant:

1. Sequence counters describe a transmitting channel. Filtered, merged or redundantly routed traffic can create apparent gaps. Do not calculate radio loss from only the messages the UI understands. [Packet-loss limits](https://mavlink.io/en/guide/packet_loss.html).
2. Wire layout, CRC extras, extensions and MAVLink 2 truncation require the correct dialect definitions. Prefer generated upstream decoding, retain unknown packets and distinguish undecodable data from failed capture. [Serialization specification](https://mavlink.io/en/guide/serialization.html).
3. A checksum validates packet integrity; a present signature is not a verified signature. The signing timestamp is not automatically a flight UTC timestamp. [Signing specification](https://mavlink.io/en/guide/message_signing.html).

For ROS, record the selected topics and actual coverage, not merely that a recorder was running. QoS compatibility affects delivery and can require overrides. With Jazzy's `--use-sim-time`, recording waits for the first `/clock` message. Snapshot mode provides an existing pre-event ring-buffer model. ROS playback republishes messages; viewing evidence and replaying it into a running system must be separate actions. CLI details depend on the installed distribution. [Jazzy QoS documentation](https://github.com/ros2/ros2_documentation/blob/jazzy/source/How-To-Guides/Overriding-QoS-Policies-For-Recording-And-Playback.rst).

## Reports and destinations

Maintain one structured report model and render it for each destination. Its common fields should be summary, expected/actual behavior, numbered reproduction, frequency, environment/versions, configuration changes, marked times, evidence, tests and the question being asked. Observations and suspected explanations need different fields.

| Destination | Required adaptation |
| --- | --- |
| PX4 forum / firmware issue | Include vehicle and controller, firmware identity, relevant log and marked time. The current bug template recommends `ver all` and Flight Review links. Use support forums for an uncertain diagnosis. [PX4 issue template](https://github.com/PX4/PX4-Autopilot/blob/main/.github/ISSUE_TEMPLATE/bug_report.yml) |
| ArduPilot forum / firmware issue | Choose the vehicle/version context, include DataFlash and configuration, and retain any previous discussion link. The issue template directs questions and user problems to the forum. [ArduPilot issue template](https://github.com/ArduPilot/ardupilot/blob/master/.github/ISSUE_TEMPLATE/bug_report.md), [support procedure](https://ardupilot.org/copter/docs/common-when-problems-arise.html) |
| Betaflight firmware / App / hardware support | Route the issue to the right project or manufacturer. Collect Support ID, versions, board, components, wiring/ports and native logs when relevant. In the GitHub Support ID field, paste plain content: its template adds code formatting itself. [Firmware template](https://github.com/betaflight/betaflight/blob/master/.github/ISSUE_TEMPLATE/firmware-bug-report.yml) |
| Discourse composer | Render Markdown, copy/download the full report, and optionally open a prefilled `/new-topic` composer. Category, tags, login and attachment acceptance depend on the forum. [Discourse composer documentation](https://meta.discourse.org/t/creating-a-link-to-start-a-new-topic-with-pre-filled-information/28074) |
| Slack | Render a short summary and marked moments, with selected files or an accessible work-item URL. File upload needs Slack's upload/complete flow, not an incoming webhook. [Slack file workflow](https://docs.slack.dev/messaging/working-with-files/) |
| ClickUp | Render task Markdown; use the selected List's fields and upload files separately. Check the current create-task API field names. [Create Task](https://developer.clickup.com/reference/createtask), [attachments](https://developer.clickup.com/docs/attachments) |
| Jira Cloud | Render Atlassian Document Format, retrieve project/issue-type required fields and attachment limits, and preserve the existing issue key across retries. [ADF structure](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/), [attachment API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/) |

Anonymous public forum metadata was inspected on the review date. PX4 lists Flight Testing & Log Analysis, PX4 Autopilot, QGroundControl and ROS categories; ArduPilot lists vehicle and version categories. The inspected responses did not expose upload size/extension limits. These are discovery facts, not hardcoded publishing guarantees. [PX4 category metadata](https://discuss.px4.io/site.json), [ArduPilot category metadata](https://discuss.ardupilot.org/site.json).

A long report in a query URL can exceed practical URL limits and enter browser history. Default to local copy/download; offer composer prefill for a short reviewed draft. File attachments remain a separate step. Preserve a fallback if login or category selection loses prefilled content. Do not treat GitHub issue-form fields, Slack formatting and Jira ADF as interchangeable Markdown.

Correct formatting can be checked locally; acceptance still depends on destination permissions and current configuration. Report missing fields explicitly. Store template source, retrieval date and adapter version so formatting changes can be maintained. Public OAuth connections and partial-upload recovery are detailed in the [integration research](UAS_SESSION_RECORDER_RESEARCH_2026-10-07.md#clickup-and-jira-integration).

## Proposed session-package contract

This is a design target, not an implemented standard. Use an ordinary ZIP with a versioned manifest and individually usable files. A directory export should also work for recordings larger than the first browser ZIP implementation can handle.

| Part | Proposed contents |
| --- | --- |
| `manifest.json` | Schema/app/adapter versions; session ID; vehicle/build identity; capture status; requested/observed sources; artifacts; clocks; evidence-completeness status. |
| `report.md` and `report.json` | Human-readable report plus the shared structured report model. Destination renderings remain derived outputs. |
| `events.jsonl` | Monotonic marked moments, notes, test boundaries, disconnects and clock-segment changes. |
| `originals/` | Original onboard logs, telemetry captures, config/mission files, screenshots and imported recordings. Each artifact records original name, provenance, size and SHA-256. |
| `media/` | Separately identified screen/camera/audio tracks and their timing metadata. Preserve originals of imported media. |
| `tests/` | Original Lab/upstream outputs; selected requirement/profile versions; per-check status, limits, units, method and linked evidence. |
| `derived/` | Optional CSV, MCAP, trimmed/transcoded clips and destination reports, each linked to its inputs and producing tool/version. |

Represent 64-bit counters/timestamps in JSON without JavaScript precision loss; state units and clock basis. Preserve missing values as unavailable, not zero. Hashes establish byte consistency, not operator identity or successful qualification. The manifest itself needs a clearly defined verification policy; a self-contained hash list is not authentication.

Keep independent states for capture (`complete`, `interrupted`, `failed`), evidence (`sufficient`, `missing`, `unknown`) and each test (`pass`, `fail`, `blocked`, `skipped`, `inconclusive`, `not_run`). A working recorder can produce an inconclusive test. A denied camera permission need not invalidate an unrelated software check.

## Free app scope and adoption

The core should require no paid plan or team account: capture/import, local save/reopen, marked playback, native-file export, report formatting and links to existing analyzers. Optional account integrations use the user's existing destination and its storage limits. Server-hosted recordings are outside the selected local-session model.

Guided mode should ask plain questions and explain each missing item with the next useful action. Developer mode should expose source IDs, topic/message coverage, timing, units, firmware identity and decoder details over exactly the same session. Missing evidence must have the same meaning in both views.

The initial release should handle screen/camera capture, forwarded PX4/ArduPilot telemetry, native-file imports, Test Lab attachments, session recovery, playback and reports. Native live MSP, ROS capture, MCAP conversion and active hardware test orchestration can follow verified basic workflows. Do not launch a large analysis-suite rewrite under the recorder name.

Adoption should be measured by whether another person can open the evidence and reproduce the reported problem, how often maintainers need to ask for missing versions/logs, and how long a first-time user takes to prepare a useful report. These are proposed product measures; popularity is not established by this research.

Use links or separately invoked upstream tools first. If packaging code, retain its actual license and notices: MCAP is MIT, MAVLink Router Apache-2.0, and WebTools/Methodic Configurator/Betaflight App use GPL licenses. Pymavlink distinguishes its generator from generated output; its COPYING file describes the generated-code exception. Do not apply Forge's existing MIT notice to copied upstream code. [MCAP license](https://github.com/foxglove/mcap/blob/main/LICENSE), [pymavlink licensing](https://github.com/ArduPilot/pymavlink/blob/master/COPYING).

## Validation required before release

| Scenario | Useful release evidence |
| --- | --- |
| PX4 and ArduPilot telemetry | Generated `.tlog` opens in an upstream reader with correct timing; native onboard files remain intact. Unknown dialect messages survive capture. |
| Betaflight report | Native Blackbox is recognized or clearly marked unsupported; Support ID and CLI output render correctly in their destination fields. |
| Video and telemetry | Known events near start and end align within a stated measured error. Offset-only alignment never claims measured drift correction. |
| Link/capture interruption | Unplug, reboot, denied permission, stopped screen share and storage exhaustion produce accurate per-source status and recoverable evidence where supported. |
| Format handling | Multiple original files, split ROS bags, typed parameters, source units and frame conventions survive export/import. Corrupt or incomplete input produces a clear result. |
| Guided/developer modes | Both show the same capture and test conclusions; beginner wording does not invent an aircraft failure. |
| Forum/task export | Special characters, long reports and missing required fields have usable fallbacks; Jira ADF and ClickUp payloads match the current API. |
| Connected sharing | A failed attachment retry keeps the existing task/issue, retries only missing evidence and reports exactly what was shared. |
| Free/local workflow | A new user can capture, reopen and export without a destination account or cloud recording service. Verify supported OS/browser combinations explicitly. |

Hardware-dependent and external-account scenarios require actual validation later. Research and document checks do not count as those results.
