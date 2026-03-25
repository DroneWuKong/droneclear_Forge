#!/usr/bin/env python3
"""
mine_troubleshooting.py — Scrape drone community knowledge bases for troubleshooting data.

Sources:
  1. Betaflight Wiki (betaflight.com/docs)
  2. ArduPilot Wiki (ardupilot.org/copter/docs)
  3. iNav Wiki (github.com/iNavFlight/inav/wiki)
  4. Oscar Liang (oscarliang.com) — FPV bible
  5. RCGroups forums (rcgroups.com)
  6. DroneCodes / PX4 (docs.px4.io)

Extracts structured troubleshooting entries:
  symptom → cause → diagnostic steps → fix

Run locally — requires network access to community sites.

Usage:
    python3 miners/troubleshooting/mine_troubleshooting.py
    python3 miners/troubleshooting/mine_troubleshooting.py --source betaflight
    python3 miners/troubleshooting/mine_troubleshooting.py --dry-run
"""

import json
import re
import os
import sys
import time
from urllib.request import urlopen, Request
from html.parser import HTMLParser

HEADERS = {
    "User-Agent": "Forge-Intel-Miner/1.0 (drone troubleshooting knowledge base)",
    "Accept": "text/html,application/xhtml+xml",
}
RATE_LIMIT = 2.0

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..',
                       'DroneClear Components Visualizer', 'forge_troubleshooting.json')

# ══════════════════════════════════════════════════════════════
# Source configurations
# ══════════════════════════════════════════════════════════════

SOURCES = {
    "betaflight": {
        "name": "Betaflight",
        "base_url": "https://betaflight.com",
        "pages": [
            "/docs/wiki/getting-started/troubleshooting",
            "/docs/wiki/guides/failsafe",
            "/docs/wiki/configurator/motors-tab",
            "/docs/wiki/configurator/receiver-tab",
            "/docs/wiki/guides/gyro-and-dterm-filtering",
        ],
        "tags": ["betaflight"],
    },
    "ardupilot": {
        "name": "ArduPilot",
        "base_url": "https://ardupilot.org",
        "pages": [
            "/copter/docs/troubleshooting.html",
            "/copter/docs/common-diagnosing-problems-using-logs.html",
            "/copter/docs/failsafe-landing-page.html",
            "/copter/docs/common-compass-setup-advanced.html",
            "/copter/docs/common-esc-calibration.html",
            "/copter/docs/ekf-inav-failsafe.html",
            "/copter/docs/gps-failsafe-glitch-protection.html",
            "/copter/docs/radio-failsafe.html",
            "/copter/docs/common-prearm-safety-checks.html",
        ],
        "tags": ["ardupilot", "px4"],
    },
    "inav": {
        "name": "iNav",
        "base_url": "https://github.com",
        "pages": [
            "/iNavFlight/inav/wiki/Troubleshooting",
            "/iNavFlight/inav/wiki/GPS-and-Compass-setup",
            "/iNavFlight/inav/wiki/Failsafe",
            "/iNavFlight/inav/wiki/Fixed-Wing-Guide",
            "/iNavFlight/inav/wiki/Calibration",
        ],
        "tags": ["inav"],
    },
    "oscarliang": {
        "name": "Oscar Liang",
        "base_url": "https://oscarliang.com",
        "pages": [
            "/avoid-quadcopter-technical-issues/",
            "/fix-esc-desync/",
            "/test-esc/",
            "/fix-faulty-motor-output/",
            "/fpv-troubleshooting/",
            "/no-signal-betaflight/",
            "/fix-motor-not-spinning/",
            "/capacitor-low-esr-motor-noise/",
            "/common-fpv-drone-mistakes/",
            "/fix-pid-oscillation/",
            "/fix-propwash-oscillation/",
            "/fix-flyaway/",
        ],
        "tags": ["oscarliang", "fpv"],
    },
    "rcgroups": {
        "name": "RCGroups Forum",
        "base_url": "https://www.rcgroups.com",
        "pages": [
            "/forums/showthread.php?4281901-BetaFlight-troubleshooting-guide",
            "/forums/showthread.php?3837829-ESC-troubleshooting-thread",
        ],
        "tags": ["rcgroups", "forum"],
    },
    "px4": {
        "name": "PX4/Dronecode",
        "base_url": "https://docs.px4.io",
        "pages": [
            "/main/en/flying/basic_flying.html",
            "/main/en/config/safety.html",
            "/main/en/advanced_config/esc_calibration.html",
            "/main/en/gps_compass/",
        ],
        "tags": ["px4", "dronecode"],
    },
}


class TextExtractor(HTMLParser):
    """Extract readable text from HTML, preserving paragraph structure."""
    def __init__(self):
        super().__init__()
        self.text = []
        self._in_content = False
        self._skip = False
        self._skip_tags = {'script', 'style', 'nav', 'header', 'footer', 'aside'}
        self._block_tags = {'p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'tr', 'br'}

    def handle_starttag(self, tag, attrs):
        if tag in self._skip_tags:
            self._skip = True
        if tag in self._block_tags:
            self.text.append('\n')

    def handle_endtag(self, tag):
        if tag in self._skip_tags:
            self._skip = False
        if tag in self._block_tags:
            self.text.append('\n')

    def handle_data(self, data):
        if not self._skip:
            self.text.append(data)

    def get_text(self):
        raw = ''.join(self.text)
        # Collapse whitespace within lines
        lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in raw.split('\n')]
        # Remove empty lines (keep max 1 blank)
        cleaned = []
        for l in lines:
            if l or (cleaned and cleaned[-1]):
                cleaned.append(l)
        return '\n'.join(cleaned).strip()


def fetch(url):
    """Fetch URL with rate limiting."""
    time.sleep(RATE_LIMIT)
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=20) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  WARN: Failed {url}: {e}", file=sys.stderr)
        return ''


def extract_text(html):
    """Extract clean text from HTML."""
    parser = TextExtractor()
    parser.feed(html)
    return parser.get_text()


def extract_sections(text):
    """Split text into sections by headers."""
    sections = []
    current_heading = "Introduction"
    current_lines = []

    for line in text.split('\n'):
        # Detect header-like lines (short, no trailing period, likely a heading)
        stripped = line.strip()
        if (stripped and len(stripped) < 80 and not stripped.endswith('.')
            and not stripped.startswith('-') and not stripped.startswith('*')
            and stripped[0:1].isupper()):
            if current_lines:
                sections.append({
                    'heading': current_heading,
                    'content': '\n'.join(current_lines).strip()
                })
            current_heading = stripped
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines:
        sections.append({
            'heading': current_heading,
            'content': '\n'.join(current_lines).strip()
        })

    return sections


def page_to_troubleshooting_hints(url, text, source_tags):
    """
    Extract troubleshooting-relevant content from a page.
    Returns raw hints that can be manually curated into entries.
    """
    sections = extract_sections(text)

    hints = []
    for s in sections:
        content = s['content']
        if len(content) < 50:
            continue

        # Look for troubleshooting-relevant sections
        heading_lower = s['heading'].lower()
        is_relevant = any(kw in heading_lower for kw in [
            'troubleshoot', 'problem', 'issue', 'fix', 'error',
            'not working', 'fail', 'won\'t', 'doesn\'t', 'debug',
            'diagnos', 'solution', 'resolve', 'crash', 'desync',
            'calibrat', 'check', 'common', 'faq',
        ])

        if is_relevant or len(content) > 200:
            hints.append({
                'heading': s['heading'],
                'content': content[:500],  # Cap length
                'url': url,
                'source_tags': source_tags,
                'relevant': is_relevant,
            })

    return hints


def scrape_source(source_key):
    """Scrape all pages for a given source."""
    config = SOURCES[source_key]
    all_hints = []

    print(f"\n{'='*50}")
    print(f"Source: {config['name']}")
    print(f"{'='*50}")

    for page_path in config['pages']:
        url = config['base_url'] + page_path
        print(f"  Fetching: {url}")
        html = fetch(url)
        if not html:
            continue

        text = extract_text(html)
        hints = page_to_troubleshooting_hints(url, text, config['tags'])
        all_hints.extend(hints)
        print(f"    → {len(hints)} hints extracted ({len(text)} chars)")

    return all_hints


def hints_to_entries(hints, source_key):
    """
    Convert raw hints into structured troubleshooting entries.
    This is a best-effort automatic conversion — results should be curated.
    """
    entries = []
    config = SOURCES[source_key]

    for i, hint in enumerate(hints):
        if not hint['relevant']:
            continue

        entry = {
            'id': f"TS-{source_key.upper()[:3]}-{i+1:03d}",
            'title': hint['heading'][:80],
            'category': _guess_category(hint['heading'], hint['content']),
            'severity': 'medium',
            'symptoms': _extract_list_items(hint['content'], 'symptom'),
            'causes': _extract_list_items(hint['content'], 'cause'),
            'diagnostics': _extract_list_items(hint['content'], 'diagnostic'),
            'fixes': _extract_list_items(hint['content'], 'fix'),
            'related_parts': [],
            'difficulty': 'intermediate',
            'tags': config['tags'] + [source_key],
            'source_url': hint['url'],
            'auto_extracted': True,  # Flag for curation
        }

        # Only include if we got meaningful content
        if entry['symptoms'] or entry['fixes']:
            entries.append(entry)

    return entries


def _guess_category(heading, content):
    """Guess troubleshooting category from heading/content."""
    text = (heading + ' ' + content).lower()
    if any(w in text for w in ['motor', 'spin', 'stutter', 'desync']):
        return 'motors'
    if any(w in text for w in ['esc', 'blheli', 'dshot']):
        return 'escs'
    if any(w in text for w in ['video', 'vtx', 'fpv', 'camera', 'osd']):
        return 'video'
    if any(w in text for w in ['gps', 'compass', 'satellite', 'fix']):
        return 'gps'
    if any(w in text for w in ['receiver', 'bind', 'sbus', 'crsf', 'elrs', 'failsafe']):
        return 'radio_link'
    if any(w in text for w in ['arm', 'disarm', 'pre-arm']):
        return 'arming'
    if any(w in text for w in ['pid', 'tune', 'filter', 'oscillat', 'propwash']):
        return 'pid_tuning'
    if any(w in text for w in ['battery', 'voltage', 'power', 'lipo']):
        return 'power'
    if any(w in text for w in ['gyro', 'accelerometer', 'baro', 'sensor']):
        return 'sensors'
    if any(w in text for w in ['frame', 'arm', 'crack', 'prop']):
        return 'mechanical'
    if any(w in text for w in ['firmware', 'flash', 'update', 'configurator']):
        return 'firmware'
    return 'flight_controllers'


def _extract_list_items(text, item_type):
    """Extract list-like items from text content."""
    items = []
    lines = text.split('\n')

    for line in lines:
        stripped = line.strip()
        # Match bullet points, numbered lists, dashes
        if re.match(r'^[-•*]\s+', stripped) or re.match(r'^\d+[.)]\s+', stripped):
            clean = re.sub(r'^[-•*\d.)]+\s*', '', stripped).strip()
            if len(clean) > 10 and len(clean) < 200:
                items.append(clean)

    return items[:8]  # Cap at 8 items


def merge_into_db(new_entries, dry_run=False):
    """Merge new entries into forge_troubleshooting.json."""
    with open(DB_PATH) as f:
        db = json.load(f)

    existing_ids = {e['id'] for e in db['entries']}
    existing_titles = {e['title'].lower() for e in db['entries']}

    added = 0
    for entry in new_entries:
        # Skip duplicates by ID or similar title
        if entry['id'] in existing_ids:
            continue
        if entry['title'].lower() in existing_titles:
            continue

        db['entries'].append(entry)
        existing_ids.add(entry['id'])
        existing_titles.add(entry['title'].lower())
        added += 1

    db['meta']['total_entries'] = len(db['entries'])
    db['meta']['last_updated'] = time.strftime('%Y-%m-%d')

    print(f"\n  Added {added} entries (skipped {len(new_entries) - added} duplicates)")
    print(f"  Total: {db['meta']['total_entries']} entries")

    if not dry_run:
        with open(DB_PATH, 'w') as f:
            json.dump(db, f, indent=2)
        print(f"  Written to {DB_PATH}")

    return added


# ══════════════════════════════════════════════════════════════
# Embedded knowledge — doesn't need network
# These are structured entries from known community knowledge
# ══════════════════════════════════════════════════════════════

EMBEDDED_ENTRIES = [
    # ═══ ArduPilot specific ═══
    {
        "id": "TS-APL-001",
        "title": "ArduPilot pre-arm check failures",
        "category": "arming",
        "severity": "blocking",
        "symptoms": ["Mission Planner shows pre-arm check failed", "Cannot arm in Loiter/Auto modes", "HUD shows 'PreArm: ...' message"],
        "causes": [
            "GPS not locked (need 3D fix with HDOP < 2.0)",
            "Compass not calibrated or inconsistent with GPS heading",
            "Accelerometer not calibrated",
            "Battery failsafe voltage set higher than current battery",
            "RC calibration not performed",
            "EKF variance too high (vibration or sensor disagreement)"
        ],
        "diagnostics": [
            "Read the exact PreArm message on HUD or in Messages tab",
            "Mission Planner → Flight Data → Messages tab shows specific failure",
            "Check GPS status: need 3D lock, HDOP < 2.0, >6 satellites for Loiter",
            "Check compass health: Mission Planner → Setup → Compass → offsets should be < 600"
        ],
        "fixes": [
            "GPS: wait for 3D fix outdoors. Cold start can take 5-10 min",
            "Compass: redo calibration away from metal. Offsets > 600 = bad placement",
            "Accel: redo calibration on flat surface via Mission Planner → Setup",
            "EKF: reduce vibrations (soft mount FC, balance props)",
            "To bypass in emergency: set ARMING_CHECK = 0 (not recommended for normal flight)",
            "BRD_SAFETYENABLE = 0 to disable safety switch requirement"
        ],
        "related_parts": ["flight_controllers", "gps_modules"],
        "difficulty": "intermediate",
        "tags": ["ardupilot", "pre-arm", "mission-planner", "compass", "gps"]
    },
    {
        "id": "TS-APL-002",
        "title": "ArduPilot compass/EKF errors",
        "category": "sensors",
        "severity": "high",
        "symptoms": ["EKF VARIANCE warning", "Toilet bowling in Loiter", "Compass inconsistency error", "Bad compass health"],
        "causes": [
            "Compass too close to power wires or ESCs (magnetic interference)",
            "Multiple compasses disagreeing (internal vs external)",
            "Compass calibration done near metal objects",
            "Motor magnetic interference not compensated"
        ],
        "diagnostics": [
            "Check compass offsets: > 600 on any axis = bad location",
            "Flight log: compare compass heading vs GPS ground course — divergence = interference",
            "MAG_ENABLE compass order: external should be primary",
            "Test: rotate drone 360° in Mission Planner → compass should track smoothly"
        ],
        "fixes": [
            "Mount external compass on GPS mast ABOVE frame, away from wires",
            "Disable internal compass if external available: COMPASS_USE2 = 0",
            "Redo compass calibration outdoors away from cars/buildings/metal",
            "Enable compass-motor calibration (MOT_COMP_TYPE = 2) for motor interference",
            "Set COMPASS_ORIENT correctly for external compass mounting direction"
        ],
        "related_parts": ["gps_modules", "flight_controllers"],
        "difficulty": "intermediate",
        "tags": ["ardupilot", "compass", "ekf", "gps", "interference"]
    },
    {
        "id": "TS-APL-003",
        "title": "ArduPilot EKF failsafe / flight mode change rejected",
        "category": "sensors",
        "severity": "critical",
        "symptoms": ["Mode change to Loiter/Auto rejected", "EKF failsafe triggered mid-flight", "Altitude jump on mode switch", "Drone switches to Land or AltHold unexpectedly"],
        "causes": [
            "EKF position estimate unreliable (vibrations or sensor issues)",
            "GPS glitch or loss of lock",
            "Barometer affected by airflow (not covered)",
            "IMU clipping from excessive vibrations"
        ],
        "diagnostics": [
            "Download and review .bin flight log",
            "Check Vibe message: clipping events should be 0. Any clipping = vibration problem",
            "Check EKF status flags in log for innovation failures",
            "Check GPS log: satellite count drops or HDOP spikes"
        ],
        "fixes": [
            "Soft-mount flight controller to reduce vibrations",
            "Balance propellers (or use pre-balanced)",
            "Cover barometer with open-cell foam",
            "Ensure GPS has clear sky view (not blocked by battery)",
            "Consider setting EKF_CHECK_THRESH slightly higher if marginal",
            "Add GPS mast to raise GPS/compass above frame interference"
        ],
        "related_parts": ["flight_controllers", "gps_modules"],
        "difficulty": "advanced",
        "tags": ["ardupilot", "ekf", "failsafe", "vibration", "critical"]
    },

    # ═══ iNav specific ═══
    {
        "id": "TS-INA-001",
        "title": "iNav navigation modes not working",
        "category": "gps",
        "severity": "high",
        "symptoms": ["NAV POSHOLD/RTH won't engage", "Position hold drifts badly", "RTH goes wrong direction"],
        "causes": [
            "GPS fix quality poor (need 3D fix, >6 sats)",
            "Compass not calibrated or interfered",
            "iNav navigation settings not configured",
            "Accelerometer not calibrated on level surface",
            "Board alignment incorrect"
        ],
        "diagnostics": [
            "iNav Configurator → GPS tab: verify 3D fix with >6 sats",
            "Check compass alignment: rotate drone, heading in configurator should match",
            "Verify nav_extra_arming_safety is allowing arm",
            "Check nav_mc_pos_xy_p and nav_mc_pos_z_p aren't zeroed"
        ],
        "fixes": [
            "Calibrate compass: iNav Configurator → Calibration → Compass calibration",
            "Set correct board alignment in Configuration tab",
            "Calibrate accelerometer on level surface",
            "Ensure GPS TX/RX wired to correct UART, GPS protocol set correctly",
            "For first-time setup: use iNav's 'Navigation' preset as baseline",
            "Set nav_user_control_mode to match your preference (CRUISE vs ATTI)"
        ],
        "related_parts": ["gps_modules", "flight_controllers"],
        "difficulty": "intermediate",
        "tags": ["inav", "navigation", "gps", "rth", "poshold"]
    },
    {
        "id": "TS-INA-002",
        "title": "iNav fixed-wing launch / VTOL transition issues",
        "category": "flight_controllers",
        "severity": "high",
        "symptoms": ["Fixed-wing won't launch properly", "Spirals after hand launch", "VTOL transition crashes", "Altitude lost during transition"],
        "causes": [
            "Motor mix / servo configuration incorrect",
            "Launch parameters not set (nav_fw_launch_*)",
            "CG (center of gravity) too far forward or aft",
            "Control surface throws too large or reversed",
            "Transition speed/altitude settings wrong for VTOL"
        ],
        "diagnostics": [
            "Verify control surface direction: pitch stick forward → elevator down",
            "Check motor direction and thrust direction",
            "Check CG: should be 25-33% of wing chord from leading edge",
            "For VTOL: verify transition_air_speed and transition_min_time"
        ],
        "fixes": [
            "Set nav_fw_launch_thr for launch power (typically 1700-1800)",
            "Set nav_fw_launch_motor_delay for safe hand-launch clearance",
            "Adjust servo direction/endpoints in iNav Configurator → Servos tab",
            "Ensure nav_fw_cruise_thr is sufficient for level flight",
            "Balance aircraft at correct CG before flight",
            "For VTOL: increase transition altitude and use ANGLE mode during transition"
        ],
        "related_parts": ["flight_controllers", "motors"],
        "difficulty": "advanced",
        "tags": ["inav", "fixed-wing", "vtol", "launch", "servo"]
    },

    # ═══ PX4/Dronecode specific ═══
    {
        "id": "TS-PX4-001",
        "title": "PX4 sensor calibration failures",
        "category": "sensors",
        "severity": "medium",
        "symptoms": ["QGroundControl calibration won't complete", "Gyro/Accel calibration fails", "Compass calibration stuck"],
        "causes": [
            "Not holding vehicle still enough during gyro calibration",
            "Not rotating through all 6 orientations during accel calibration",
            "Magnetic interference during compass calibration",
            "Sensor hardware fault"
        ],
        "diagnostics": [
            "QGroundControl → Sensors page shows specific failure",
            "Check QGC messages for timeout or inconsistency errors",
            "Try calibration outdoors away from metal/concrete reinforcing"
        ],
        "fixes": [
            "Gyro: place on flat surface, don't touch for 10 seconds",
            "Accel: follow QGC prompts for each orientation — hold steady 3 seconds each",
            "Compass: calibrate outdoors. Rotate smoothly, not jerky",
            "If persistent failure: check SYS_HAS_MAG, SYS_HAS_BARO parameters",
            "Try power cycling and recalibrating from scratch"
        ],
        "related_parts": ["flight_controllers", "gps_modules"],
        "difficulty": "beginner",
        "tags": ["px4", "qgroundcontrol", "calibration", "sensors"]
    },
    {
        "id": "TS-PX4-002",
        "title": "PX4 failsafe cascade / unexpected landing",
        "category": "radio_link",
        "severity": "critical",
        "symptoms": ["Vehicle lands unexpectedly", "Mode switches to Return/Land without input", "Multiple failsafe warnings in QGC"],
        "causes": [
            "RC signal loss triggering COM_RC_LOSS_T timeout",
            "Data link loss (telemetry radio)",
            "Low battery failsafe (BAT_LOW_THR / BAT_CRIT_THR)",
            "Geofence violation",
            "Mission completion action set to Land"
        ],
        "diagnostics": [
            "Download ULog flight log from SD card",
            "Check QGC messages for specific failsafe trigger",
            "Review COM_RC_LOSS_T, NAV_RCL_ACT, NAV_DLL_ACT parameters",
            "Check battery cell voltages for imbalance/sag"
        ],
        "fixes": [
            "Set appropriate RC loss timeout: COM_RC_LOSS_T (default 0.5s may be too aggressive)",
            "Configure NAV_RCL_ACT to desired action (0=disabled, 1=loiter, 2=return, 3=land)",
            "Set battery thresholds appropriately for your pack capacity",
            "Verify geofence boundaries if GF_ACTION is set",
            "For telemetry loss: set NAV_DLL_ACT appropriately"
        ],
        "related_parts": ["receivers", "flight_controllers", "batteries"],
        "difficulty": "intermediate",
        "tags": ["px4", "failsafe", "return-to-launch", "battery", "rc-loss"]
    },

    # ═══ Community forum patterns (common across all platforms) ═══
    {
        "id": "TS-CMN-001",
        "title": "ELRS 3.x / 4.x binding issues",
        "category": "radio_link",
        "severity": "blocking",
        "symptoms": ["ELRS receiver won't bind after firmware update", "LED pattern shows WiFi mode not bind mode", "Binding phrase doesn't work after cross-version flash"],
        "causes": [
            "TX and RX on different major ELRS versions (3.x vs 4.x incompatible)",
            "Binding phrase set on one but not other",
            "WiFi mode entered instead of bind mode",
            "Regulatory domain mismatch (EU vs FCC vs AU)"
        ],
        "diagnostics": [
            "Check ELRS version on TX module (ELRS Lua script on radio)",
            "Check ELRS version on RX (WiFi page at 10.0.0.1)",
            "LED blink pattern: slow blink = binding, fast blink = no connection, solid = connected",
            "Double-check regulatory domain matches between TX and RX"
        ],
        "fixes": [
            "Flash TX and RX to SAME version using ExpressLRS Configurator",
            "Set IDENTICAL binding phrase on both TX and RX firmware builds",
            "To enter bind mode: power on RX, wait 60s for auto-WiFi, or triple-press button if available",
            "For version mismatch: flash RX via WiFi (connect to ELRS_RX hotspot, navigate to 10.0.0.1)",
            "Ensure regulatory domain (ISM band) matches between TX/RX"
        ],
        "related_parts": ["receivers", "control_link_tx"],
        "difficulty": "intermediate",
        "tags": ["elrs", "expresslrs", "binding", "firmware", "common"]
    },
    {
        "id": "TS-CMN-002",
        "title": "DJI FPV system latency / OSD issues",
        "category": "video",
        "severity": "medium",
        "symptoms": ["DJI OSD elements not showing", "OSD layout wrong after BF update", "Custom OSD not displaying in DJI goggles", "Latency feels higher than expected"],
        "causes": [
            "Betaflight OSD font not updated for DJI compatibility",
            "MSP DisplayPort not configured (for custom OSD)",
            "DJI air unit needs firmware update",
            "UART baud rate mismatch between FC and DJI air unit"
        ],
        "diagnostics": [
            "Check if analog OSD works (connect analog camera) — if yes, MSP issue",
            "Verify UART config: DJI TX goes to FC RX on a free UART",
            "Check Betaflight Ports tab: is MSP enabled on DJI UART?",
            "Update DJI air unit firmware via DJI Assistant 2"
        ],
        "fixes": [
            "Enable MSP on the UART connected to DJI air unit (Ports tab → MSP toggle)",
            "Set display_port_msp_speed = 115200 in CLI (Betaflight 4.4+)",
            "Flash correct OSD font: use INAV or BF font flasher for DJI",
            "For custom OSD: WTFOS or similar custom firmware on DJI goggles",
            "For latency: ensure DJI is in LOW LATENCY mode (not High Quality)"
        ],
        "related_parts": ["video_transmitters", "flight_controllers"],
        "difficulty": "intermediate",
        "tags": ["dji", "osd", "displayport", "msp", "video"]
    },
    {
        "id": "TS-CMN-003",
        "title": "HDZero / Walksnail no video or poor signal",
        "category": "video",
        "severity": "blocking",
        "symptoms": ["HDZero goggles show no signal", "Walksnail breaks up at close range", "Digital video freezes then recovers"],
        "causes": [
            "VTX and goggles on different channels (not auto-matching)",
            "VTX power set to minimum (25mW)",
            "Antenna mismatch (LHCP vs RHCP or linear vs circular)",
            "Firmware version mismatch between goggles and VTX",
            "UFL antenna connector not fully seated after crash"
        ],
        "diagnostics": [
            "HDZero: check channel in VTX menu via Betaflight OSD",
            "Walksnail: check Avatar HD settings app on goggles",
            "Wiggle UFL connector gently — any change in signal?",
            "Check VTX power setting is appropriate (200-400mW for flying)"
        ],
        "fixes": [
            "Match channel/band between VTX and goggles",
            "Increase VTX power from pit mode to flight power",
            "Re-seat UFL connector firmly (use antenna wrench if available)",
            "Use matched antennas: same polarization on both ends",
            "Update firmware on both goggles and VTX to latest matching version"
        ],
        "related_parts": ["video_transmitters", "antennas"],
        "difficulty": "beginner",
        "tags": ["hdzero", "walksnail", "digital-fpv", "video", "common"]
    },
    {
        "id": "TS-CMN-004",
        "title": "LiPo battery puffing / swelling",
        "category": "power",
        "severity": "critical",
        "symptoms": ["Battery visibly swollen/puffy", "Battery won't fit in strap anymore", "Chemical smell from battery", "Reduced flight time with puffed pack"],
        "causes": [
            "Over-discharged below safe voltage (< 3.3V/cell)",
            "Overcharged above 4.2V/cell",
            "Crash damage to cell (internal short forming)",
            "Charged/stored in extreme heat",
            "Old age — natural cell degradation"
        ],
        "diagnostics": [
            "Visual: any swelling = gas generation inside cell = damage",
            "Measure cell voltages: any cell > 0.1V different from others = imbalanced",
            "Measure internal resistance: > 30mΩ per cell = degraded",
            "Slight puff after hard flight that goes away = OK (temporary gas). Permanent puff = retire"
        ],
        "fixes": [
            "Mildly puffed (< 3mm): can fly at reduced capacity but monitor closely",
            "Significantly puffed: RETIRE IMMEDIATELY. Discharge to storage voltage via charger",
            "Disposal: discharge fully, tape terminals, take to battery recycling",
            "NEVER puncture, crush, or throw in fire",
            "Prevention: storage charge (3.8V/cell) when not flying for > 2 days",
            "Prevention: never discharge below 3.5V/cell under load (set OSD warning)"
        ],
        "related_parts": ["batteries"],
        "difficulty": "beginner",
        "tags": ["lipo", "battery", "puffing", "safety", "critical"]
    },
    {
        "id": "TS-CMN-005",
        "title": "Betaflight blackbox logging not working",
        "category": "firmware",
        "severity": "low",
        "symptoms": ["No blackbox log files on SD card", "Blackbox viewer shows no data", "SD card not detected by FC"],
        "causes": [
            "SD card not formatted correctly (needs FAT32)",
            "SD card too large (some FCs don't support > 32GB)",
            "Blackbox not enabled in Betaflight",
            "SD card slot contacts dirty/damaged",
            "SD card full"
        ],
        "diagnostics": [
            "CLI: 'blackbox' command — shows logging status",
            "Check Configuration tab → Blackbox logging toggle",
            "Remove SD card, format as FAT32 on computer, reinsert",
            "Try different SD card (use quality brand, Class 10+)"
        ],
        "fixes": [
            "Enable blackbox in Configuration tab",
            "Format SD card as FAT32 (not exFAT) — max 32GB",
            "Set blackbox logging rate (recommended: 500Hz for 8K PID loop)",
            "Use onboard flash if no SD slot: set blackbox_device = SPIFLASH in CLI",
            "Clean SD card contacts with isopropyl alcohol if intermittent"
        ],
        "related_parts": ["flight_controllers"],
        "difficulty": "beginner",
        "tags": ["blackbox", "logging", "sd-card", "betaflight"]
    },
    {
        "id": "TS-CMN-006",
        "title": "Propwash oscillation on descent",
        "category": "pid_tuning",
        "severity": "medium",
        "symptoms": ["Oscillation / wobble when descending through own prop wash", "Visible shake in video on dive pullouts", "Worse in sharp turns and quick stops"],
        "causes": [
            "Propellers re-entering their own disturbed air vortex",
            "PID controller unable to compensate fast enough for turbulent airflow",
            "D-term filtering too aggressive (delays response)",
            "Low motor authority at low throttle (idle speed too low)"
        ],
        "diagnostics": [
            "Reproducible: do a punch-out, then cut throttle and descend — wobble on descent",
            "Worse at specific throttle range (usually 30-50%)",
            "Blackbox: look at gyro traces during descent — oscillation visible"
        ],
        "fixes": [
            "Increase motor idle speed: set dshot_idle_value slightly higher (6-8%)",
            "Increase D-term (counterintuitive but helps track through turbulence)",
            "Reduce D-term lowpass filtering (allow faster D response)",
            "Enable dynamic idle in Betaflight 4.3+ (adjusts idle per motor RPM)",
            "Use RPM filtering to allow lower overall filtering",
            "Fly through propwash rather than hovering in it (technique)"
        ],
        "related_parts": ["propellers", "motors", "flight_controllers"],
        "difficulty": "advanced",
        "tags": ["propwash", "pid", "tuning", "oscillation", "descent"]
    },
    {
        "id": "TS-CMN-007",
        "title": "GPS rescue / RTH flyaway",
        "category": "gps",
        "severity": "critical",
        "symptoms": ["GPS rescue sends drone wrong direction", "RTH altitude too low — crashes into obstacles", "Drone flies away instead of returning"],
        "causes": [
            "GPS home point set before good fix (inaccurate home)",
            "Compass interference causing wrong heading",
            "GPS rescue altitude set too low for terrain",
            "Wind stronger than drone can fight at rescue throttle",
            "GPS rescue not tested before needed"
        ],
        "diagnostics": [
            "Check home point location: was GPS fix solid at arm time? (>8 sats, HDOP <2)",
            "Did compass heading agree with GPS heading before takeoff?",
            "Check GPS_RESCUE_MIN_SATS (Betaflight) or GPS_MIN_SATS (ArduPilot)"
        ],
        "fixes": [
            "Always wait for solid GPS fix before arming (>10 sats preferred)",
            "Set GPS rescue altitude above all nearby obstacles + 20m margin",
            "Test GPS rescue in safe area at low altitude first",
            "Betaflight: configure GPS_RESCUE_* parameters properly",
            "ArduPilot: set RTL_ALT to safe altitude (in cm — e.g. 5000 = 50m)",
            "Set minimum satellite requirement: don't arm without >8 sats in GPS modes"
        ],
        "related_parts": ["gps_modules", "flight_controllers"],
        "difficulty": "intermediate",
        "tags": ["gps", "rescue", "rth", "flyaway", "critical"]
    },
]


def seed_embedded():
    """Add embedded entries to the troubleshooting database."""
    with open(DB_PATH) as f:
        db = json.load(f)

    existing_ids = {e['id'] for e in db['entries']}
    added = 0

    for entry in EMBEDDED_ENTRIES:
        if entry['id'] not in existing_ids:
            db['entries'].append(entry)
            existing_ids.add(entry['id'])
            added += 1

    db['meta']['total_entries'] = len(db['entries'])
    db['meta']['last_updated'] = time.strftime('%Y-%m-%d')

    with open(DB_PATH, 'w') as f:
        json.dump(db, f, indent=2)

    print(f"Seeded {added} embedded entries. Total: {db['meta']['total_entries']}")
    return added


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Mine troubleshooting data from drone communities')
    parser.add_argument('--source', choices=list(SOURCES.keys()), help='Specific source')
    parser.add_argument('--seed-only', action='store_true', help='Only add embedded entries (no network)')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    if args.seed_only:
        print("Seeding embedded troubleshooting entries...")
        seed_embedded()
    else:
        sources = [args.source] if args.source else list(SOURCES.keys())

        # Always seed embedded first
        print("Seeding embedded entries...")
        seed_embedded()

        # Then scrape sources
        all_entries = []
        for src in sources:
            hints = scrape_source(src)
            entries = hints_to_entries(hints, src)
            all_entries.extend(entries)
            print(f"  {SOURCES[src]['name']}: {len(entries)} structured entries")

        if all_entries:
            merge_into_db(all_entries, dry_run=args.dry_run)

        print(f"\nTotal scraped entries: {len(all_entries)}")
