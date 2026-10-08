# UAS test-session SOP

Forge workflow, 8 October 2026. The [local recorder](SESSION_RECORDER.md) supports capture, review and report preparation; select upstream tools for the active tests themselves. Use this for a support investigation, software regression, bench session or documented flight test, selecting the steps that apply. It combines practices from upstream tools; it does not replace the vehicle's operating procedure or a named acceptance requirement. The [research](UAS_TOOLING_AND_FORMATS_2026-10-07.md) provides the tool and format references.

The aim is a repeatable test with evidence another person can inspect. A captured video, adequate diagnostic evidence and a passing test are three separate outcomes.

## 1 Describe one test

Write the question, expected behavior and a concrete criterion before starting. Name the test mode: software-only, SITL, SIH/HIL, real-controller bench or physical flight. Record the procedure/profile and its version where applicable.

For a support question, it is fine to have an observation rather than a pass limit. For an automated check, record the measured quantity, units, threshold, method and timeout. Do not invent a universal acceptable GPS count, vibration limit, link-loss percentage or latency limit for every aircraft.

**Guided prompt:** “What are you trying to check, and what should happen?”

**Example:** “In SITL, change from Hold to Mission using the existing GCS. The uploaded mission should become active. Record which mission and firmware are used, mark the switch, and retain the observed mode and original logs.”

## 2 Save the starting conditions

Record aircraft/platform, flight controller, relevant connected components, firmware version/source commit, GCS/App version and computer environment. Include the simulator/model and middleware versions when relevant.

For a connected PX4/ArduPilot vehicle, the recorder can collect a parameter snapshot before recording. Choose the connected target, then Collect parameters. Collection metadata retains its time and vehicle identity. Use the existing GCS for signed links or receive-only forwarding.

Save the configuration using its existing tool: QGC parameter export, ArduPilot/MAVProxy parameter file, or Betaflight support data and `diff all`. Attach the mission/fence/plan when it affects the test. Preserve original output and any incomplete-download indication. Note recent changes and their reasons. Reuse a Forge build record where one already exists.

Methodic Configurator is a useful reference for staged configuration and documenting why a parameter changes. Do not treat a parameter diff as a complete model of changed wiring, payload, environment or firmware behavior. [Configuration workflow](https://github.com/ArduPilot/MethodicConfigurator).

**Guided prompt:** “Which aircraft and software are you using? What changed since it worked?”

## 3 Choose the evidence

| Investigation | Usually useful evidence |
| --- | --- |
| PX4 flight behavior | Original ULog, configuration/build identity, marked moment and relevant screen/video. |
| ArduPilot flight behavior | Original DataFlash log, parameters and vehicle details; telemetry/video as additional context. |
| Betaflight flight behavior | Native Blackbox, Support ID/configuration, versions, components and wiring; flight video when useful. |
| GCS/App interaction | Screen capture, app/version, reproduction steps, connection details and original console/telemetry logs where relevant. |
| Companion-computer/ROS issue | Relevant bag with all split files/metadata, topic/type/QoS details, node/build versions and selected logs. |
| Automated regression | Exact command/case, commit/build, configuration, exit/result output and native artifacts. |

Choose only sources relevant to the question. A screen capture cannot replace an onboard log's internal state; a GCS `.tlog` cannot recreate every onboard sensor field. [ArduPilot log distinctions](https://ardupilot.org/dev/docs/common-logs.html).

If an original file is not available until after the activity, leave a visible “attach afterward” task. For a software-only problem, mark an onboard flight log as not applicable rather than always requiring one.

## 4 Check capture and test setup

Keep the existing GCS as the normal vehicle interface. Receive a forwarded copy of telemetry where possible instead of opening an already-owned serial port. Document the source, endpoint, dialect and any routing/filtering. A passive capture should not silently upload missions, alter stream rates, change parameters or arm a vehicle.

Add each relevant window/monitor separately (for example Mission Planner, its CLI and a terminal). Choose each camera, including integrated and USB cameras, and name the previews. A microphone is recorded once. Use All selected inputs or Focus to inspect a source; changing the preview does not change which inputs record.

Verify that selected sources are actually producing data: video preview, audio indication when selected, advancing telemetry timestamps and local storage availability. Record the requested sources separately from those observed.

For active bench tests, follow the upstream test's setup and gates. For example, px4bench separates non-arming bench checks from a gated simulated-flight stage and restores changed settings. Do not run its complete suite merely to establish a recorder connection. [px4bench procedure](https://github.com/PX4/PX4-Autopilot/blob/main/Tools/bench_test/README.md).

**Guided prompt:** “We can see your screen and vehicle messages. The onboard log still needs to be attached after the test.”

## 5 Start before the event and mark it

Begin recording before reproducing the behavior. Capture a short baseline, then follow numbered steps. Mark the action and the unexpected result with a brief factual note. Keep enough context afterward to show recovery or persistence.

If aligning imported flight video and logs, use a shared visible/audible event and check another reference near the end. Record manual alignment and its uncertainty. A single starting offset does not measure drift. Keep reconnects and clock resets visible.

Record what happened separately from a suspected cause. “No vehicle messages received between these times” is an observation. “The radio failed” needs additional evidence.

**Guided prompt:** “Tap Mark when the problem happens, then say what you saw.”

## 6 Finish and inspect the files

Stop recording, wait for pending media/log writes and save the session. For supported PX4/ArduPilot links, select List onboard logs, choose a completed log, then Collect selected log while disarmed. Cancellation leaves existing evidence intact and discards partial downloads. Attach the original onboard log, exported configuration and any test output. Preserve original filenames and bytes. Label trimmed/transcoded clips and decoded CSV as derivatives.

Reopen the saved session. Check that selected media plays, marked moments are in range, logs are present and sources have correct status. Open the native log in an upstream analyzer when its contents are needed. For PX4, the official reporting workflow includes downloading logs with QGC and sharing an appropriate Flight Review link. Encrypted logs require their supported handling path. [PX4 flight reporting](https://docs.px4.io/main/en/getting_started/flight_reporting).

Record three conclusions independently:

- **Capture:** complete, interrupted or failed; specify affected sources.
- **Evidence:** sufficient for this question, missing items or unknown.
- **Test:** pass, fail, blocked, skipped, inconclusive or not run; include the criterion and reason.

An interrupted recording can still contain useful evidence. A complete recording can still be too sparse to decide the test.

## 7 Prepare the support report

Use a specific title describing the behavior and conditions. Keep the main report short enough to understand without watching the entire recording. Include exact steps, expected/actual result, frequency, versions, relevant changes and marked times. Link each factual claim to the relevant evidence when practical.

Fill unknown fields as unknown; do not fabricate versions or classify an observation as a confirmed software defect. Retain missing-evidence notes.

```markdown
Title: [stack / vehicle] observed behavior under specific conditions

What I am trying to do:

Expected behavior:

Actual behavior:

Steps to reproduce:
1.
2.
3.

Frequency: [times observed / attempts, or unknown]
Last known working version/configuration:

Environment:
- Vehicle / flight controller / relevant components:
- Firmware version and build/commit:
- GCS/App and computer environment:
- Test mode / simulator and model, if applicable:

Changes since the working baseline:

Relevant moments:
- Session time / source log time / observation:

Evidence:
- Original log and configuration:
- Recording / relevant clip:
- Test output and result:
- Missing evidence or uncertain alignment:

Question or requested help:
Previous related discussion / issue:
```

Choose PX4 / Dronecode forum for its reviewed draft composer, or Betaflight firmware bug form for matching per-field copy buttons. Use Betaflight configuration / community support for setup questions. GitHub form fields and attachments still need user review and submission.

The final exporter adds the chosen platform's fields and formatting. Betaflight's GitHub Support ID field already adds code formatting; a forum report may instead use an appropriate code block. The app must respect that distinction. [Betaflight firmware template](https://github.com/betaflight/betaflight/blob/master/.github/ISSUE_TEMPLATE/firmware-bug-report.yml).

## 8 Choose the destination and review sharing

Use the relevant support forum for an uncertain configuration/problem diagnosis, and the relevant project issue tracker for an established code defect. ArduPilot explicitly directs user questions to its forum. Betaflight distinguishes firmware, App and manufacturer support. [ArduPilot reporting rules](https://github.com/ArduPilot/ardupilot/blob/master/.github/ISSUE_TEMPLATE/bug_report.md), [Betaflight routing](https://betaflight.com/docs/wiki/getting-started/hardware-support).

Review the rendered text, selected files and destination. Decide whether the intended audience should receive raw logs, location/build details and the full screen recording. Any redaction creates a derivative with its omissions documented; retain the original locally.

Copy/download the report or open the destination composer. Forum category, attachments and login may need user action. For Slack, ClickUp or Jira, show whether the text, task and each attachment succeeded. Save the returned URL/key. A local filesystem path is not an accessible team link.

Do not lose a useful report because a destination upload is unavailable. Keep the session export and a manual posting path.

## 9 Retest and close the loop

Change one relevant factor where practical, record why, then repeat the same procedure. Create a new session linked to the original and existing issue/task. Compare configurations, the same measured quantities and the same test criteria. Document any different conditions.

If the behavior cannot be reproduced, report attempts and conditions rather than claiming a fix from a single silent recording. For a software regression, add a narrowly targeted upstream simulator/test case when feasible. ArduPilot AutoTest explicitly supports reproducible behavior and regression coverage. [AutoTest workflow](https://ardupilot.org/dev/docs/the-ardupilot-autotest-framework.html).

Close the investigation with the retest result and supporting evidence. A named acceptance gate remains open until its own required evidence and reviewer conditions are satisfied.
