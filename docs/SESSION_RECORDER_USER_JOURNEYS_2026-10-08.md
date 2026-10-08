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
