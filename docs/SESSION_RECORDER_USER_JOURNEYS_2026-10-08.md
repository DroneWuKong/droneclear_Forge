# Session recorder user journey review

8 October 2026. The walkthrough identified three practical barriers: recording was hard to find, attaching a log cleared an unsaved report draft, and Guided mode presented Jira API JSON. The revised interface provides a short capture path, preserves the draft, and separates readable Jira editor text from the ADF download.

## Scenarios and findings

| User and task | Observed barrier | Resulting behavior | Verification |
| --- | --- | --- | --- |
| First-time user records an app problem and prepares a support request | At 1366 × 768, Start recording was 2,656 pixels down the initial standalone page. Technical forms competed with source selection. After stopping, review required finding another section. | Shorter header and Guided setup; technical fields collapse until needed. Choose inputs → Continue to recording puts Start in the viewport. Review saved session moves to the evidence section and gives its heading keyboard focus. | Guided notes-only capture, marked moment, review navigation and detail recovery pass in Chromium. Screenshots and overflow checks cover 320, 390 and 1366 pixels. |
| Developer captures telemetry offline, attaches logs and exports an issue | Typing actual behavior and then attaching a log reset the typed text. The disk-copy message could still describe an earlier revision. Jira JSON was easy to mistake for text intended for the task editor. | Attachments persist the draft before refreshing. Updated evidence has a Save updated disk copy reminder. Guided Jira copy produces readable plain text; downloads and Developer copy/preview retain structured ADF. | Draft preservation, actual clipboard contents and ADF parsing pass. Native checks cover local UDP, real synthetic video, disk updates and fresh-profile recovery with non-loopback requests blocked. |
| Field operator presents a live session to a team | A long header and stacked content pushed previews down the page. Raw MAVLink message names added jargon in Guided mode. | Compact live layout places previews and controls beside vehicle observations and marked events. Guided labels use Vehicle state, GPS position and Battery; Developer mode retains protocol names. Switching view preserves capture. | Live/workspace switching during capture, telemetry observation age, markers, reflow and local persistence through an offline event pass. Teams/Meet use ordinary window sharing. |

## Review method and limits

These are scenario walkthroughs and automated browser interactions, with synthetic media, telemetry and report text. No participants were recruited. Pixel position describes the interface geometry; it is not a measurement of human completion time, adoption or task success rate.

Screenshots are saved in the ignored design-review directory and CI artifacts. Browser checks exercise the actual local store, clipboard, file attachments, report export and native executable. Target-OS CI checks Windows and Linux separately. A Windows encoding failure was corrected before release; a timestamp-dependent ZIP fixture was made deterministic so a retry test always reuses the same bytes.

Physical camera/microphone/USB behavior, real field datalinks and live meeting/workspace accounts remain outside these software checks. A useful participant follow-up is to ask a novice to record and submit a problem without coaching, ask a developer to recover a session after restarting, and have a field team review the shared live view on their actual meeting setup. Record confusion, incorrect choices and recovery attempts before changing the interface further.

## Regression coverage

- `tests/browser_session_journeys.cjs`: guided capture navigation, review focus, attachment draft retention, Jira clipboard/ADF behavior and desktop/mobile layout.
- `tests/browser_session_desktop.cjs`: cold offline native startup, local UDP, media encoding, live view, disk save/update and recovery in a fresh browser profile.
- `tests/browser_session_recorder.cjs`: existing recording, evidence integrity, alignment, report formats, recovery and cached web reopening.

Native build outputs now live in `build-desktop/`, separate from the Pages site output. They cannot contaminate a local site audit or be removed by a normal static-site rebuild.

## Version 1.2 follow-up: multi-input field workflow

A developer chooses Mission Planner, its CLI and a terminal one at a time, then adds the laptop camera and a USB camera. Names remain attached to separate recordings; Focus changes the preview without changing capture. The camera chooser advances to an unused device. Duplicate cameras, cancelled pickers and a ninth input leave the existing choices intact. One microphone avoids duplicate narration. An ended terminal source records an interruption while the remaining inputs continue.

Before reproducing, the operator selects a connected PX4/ArduPilot target and collects parameters. A complete snapshot creates a prepared session; Start recording retains its evidence in the same session. The operator can list and collect completed logs while disarmed before/after recording. Interrupted transfers attach no partial file. Afterward, PX4/Dronecode opens a reviewed draft; Betaflight offers each official bug-form field separately and copies its Support ID without wrappers. Configuration questions have their own official community destination.

The fixed 1,120-pixel maximum left unused space on desktop. The wide workspace now puts setup beside capture, fills the viewport width, expands preview columns and provides fullscreen. Replay spans the workspace. Live mode uses smaller grid cells for several simultaneous inputs, with a focused view for detailed reading. A sticky-panel trial obscured report controls during the walkthrough and was removed. The live board now includes source interruptions as well as marked notes.

The frozen Linux app passes this five-input journey offline, including actual MediaRecorder, one audio stream, loopback parameter/log requests, separate media files, interrupted-source metadata, ZIP integrity, replay and fresh-profile disk recovery. Geometry checks cover 320, 390, 1366, 1920 and 2560 pixels and fullscreen entry/exit. The same executable journey runs on both native CI platforms. These remain synthetic software checks; physical hardware and participant validation are separate.

## Version 1.3 follow-up: reduce reading and scrolling

User feedback on the shipped wide layout identified the long “What are you checking?” column: it continued down to Replay and share, making the app overwhelming. Width/reflow checks had missed the vertical task flow. Version 1.3 removes that column and uses direct Record, Evidence and Report workspaces. Saved sessions and Help are utility destinations. Stop opens Evidence without scrolling past setup.

Record contains a compact source bar and transport/mark controls above the previews. Report holds expected/actual/reproduction facts, optional version/configuration details and collapsed report/field previews. Developer mode changes evidence detail without automatically opening all forms. Draft fields stay mounted across workspaces, so attachment and navigation preserve unsaved text. Preview grids adapt their video height to the window. Keyboard navigation focuses the selected workspace heading and leaves the workspace navigation reachable.

The guided walkthrough checks Start on first load at 1366×768, immediate Evidence after Stop, draft retention across Report/Evidence, clipboard/ADF exports, missing-detail navigation, terminal help and mobile reflow. Native checks retain the five-input offline capture, telemetry/log reads, interruption, disk recovery and clipboard verification across the new workspaces. Synthetic picker tests check distinct window/monitor preferences; real Windows terminal enumeration still belongs to the OS/browser.
