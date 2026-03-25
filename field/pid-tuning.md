# PID Tuning — Field Guide

> Comprehensive PID tuning reference for FPV drones and autonomous platforms.
> Covers manual tuning workflows, autotuning algorithms, Blackbox analysis, firmware-specific features, filter interaction, and emerging ML-based approaches.
> Intended audience: Wingman AI knowledge base, FPV pilots, drone integrators.

---

## PID Controller Fundamentals

A PID controller continuously computes the error between the desired rotation rate (setpoint) and the actual gyro measurement, then adjusts motor outputs to minimize that error.

**The control equation:**
```
u(t) = Kp·e(t) + Ki·∫e(t)dt + Kd·de(t)/dt
```

| Term | What It Does | Too High | Too Low |
|------|-------------|----------|---------|
| **P (Proportional)** | Corrects present error — responsiveness/sharpness | High-frequency oscillation, overshoot, hot motors | Sloppy, sluggish stick feel |
| **I (Integral)** | Cancels steady-state drift (wind, CG offset) | Slow wobble, bounceback after flips, "sticky" feel | Drift, won't hold attitude |
| **D (Derivative)** | Damps motion, reduces overshoot from P | Hot motors (amplifies HF noise), audible buzz | Overshoot on quick moves, propwash |
| **F (Feedforward)** | Anticipates stick movement, reduces latency | Overshoot on snap rolls, twitchy | Lag between stick input and response |

**Key insight**: In modern Betaflight (4.3+), the controller is actually **PIDF** — Feedforward is a separate term driven by stick velocity, not error. Unlike P, feedforward cannot cause oscillation regardless of gain.

**On yaw axis**: Yaw inherently has less control authority than pitch/roll. Higher P and I with lower D is normal. Betaflight's Integrated Yaw feature normalizes yaw control by integrating PID output before the mixer.

---

## Firmware-Specific PID Implementations

### Betaflight (FPV Racing/Freestyle)

| Feature | Version | What It Does |
|---------|---------|-------------|
| PIDF controller | 4.0+ | Feedforward as 4th term driven by stick rate-of-change |
| Simplified Sliders | 4.3+ | PI, D, FF sliders in Basic; I, Dmax, pitch:roll ratio in Expert |
| I-term Relax | 4.0+ | Prevents I buildup during stick moves → reduces bounceback |
| D-Min / Dynamic Damping | 4.2+ | Lower D in cruise, higher D during snaps and propwash events |
| TPA (Throttle PID Attenuation) | All | Reduces D (or P+D) above configurable throttle breakpoint |
| Anti-Gravity | 4.0+ | Boosts I during rapid throttle changes to counter nose-dip |
| Dynamic Idle | 4.3+ | Increases motor RPM at zero throttle → better PID authority |
| Thrust Linearization | 4.3+ | Normalizes PID response across throttle range |
| RPM Filtering | 4.1+ | Motor-harmonic notch filters via bidirectional DShot |
| Advanced Feedforward (rise/decay) | 4.6 | New rise/decay control for sharper response without oscillation |
| S-term (PIDF_S) | 4.6 | Fixed-wing: stick-proportional term for direct servo control |
| SPA (Setpoint PID Attenuation) | 4.6 | Disables/freezes PID terms during high-rate maneuvers |

**Default PID loop frequency**: 8KHz gyro / 4KHz PID on F4; 8KHz/8KHz on F7/H7.

**Key CLI commands:**
```
# View current PIDs
get p_roll
get i_roll
get d_min_roll
get f_roll

# Simplified tuning sliders (4.3+)
set simplified_master_multiplier = 100
set simplified_i_gain = 100
set simplified_d_gain = 100
set simplified_pi_gain = 100
set simplified_dmax_gain = 100
set simplified_feedforward_gain = 100
set simplified_pitch_d_gain = 100
set simplified_pitch_pi_gain = 100
simplified_tuning apply

# I-term relax
set iterm_relax = RP         # RP = roll+pitch, RPY = all axes
set iterm_relax_cutoff = 15  # Freestyle default; 30 for racing; 10 for cinelifters

# TPA
set tpa_rate = 75
set tpa_breakpoint = 1750

# Dynamic Idle
set dyn_idle_min_rpm = 3000  # 3000-3500 for 5"

# Thrust Linearization
set thrust_linear = 20       # 20% recommended starting point
```

### ArduPilot/ArduCopter (Autonomous/Commercial)

ArduPilot uses a **cascaded PID architecture**: outer position loop → rate loop → motor mixer.

**AutoTune mode**: The built-in autotuning algorithm performs controlled "twitches" on each axis, measuring step response to determine optimal rate P, rate D, and stabilize P gains.

```
# Enable AutoTune
ATC_RAT_RLL_AUTOTUNE = 1
ATC_RAT_PIT_AUTOTUNE = 1
ATC_RAT_YAW_AUTOTUNE = 1

# Aggressiveness (0.05=gentle, 0.1=default, 0.2=aggressive)
AUTOTUNE_AGGR = 0.1

# Axes to tune (bitmask: 1=roll, 2=pitch, 4=yaw, 7=all)
AUTOTUNE_AXES = 7
```

**Process**: Switch to AutoTune flight mode → hover in calm conditions → FC performs axis-by-axis twitches → land → gains saved automatically. Takes 5-15 minutes depending on conditions.

**Battery voltage scaling**: ArduPilot supports automatic PID gain scaling with battery voltage to maintain consistent flight characteristics as the pack drains.

### iNav (GPS/Navigation Builds)

iNav uses standard PID with navigation-specific additions. No built-in autotune for multirotors.

**Key differences from Betaflight:**
- Navigation PID loops (position, altitude) layered on top of rate PIDs
- `nav_mc_vel_*` and `nav_mc_pos_*` parameters for position hold tuning
- Anti-windup on nav I-terms to prevent overshoot on waypoint approaches
- Rate PIDs tuned similarly to Betaflight but typically more conservative

### PX4 (Commercial/Enterprise)

PX4 supports autotuning around hover thrust point.

```
# Trigger autotune via QGroundControl or:
MC_AT_START = 1   # Start autotuning
MC_AT_APPLY = 1   # Apply results
```

**Architecture**: Attitude controller (quaternion-based) → rate controller (PID) → mixer. Supports gain scheduling across flight envelope.

### KISS / FalcoX

Same PID principles as Betaflight. KISS firmware historically ran tighter loops with less filtering overhead. FalcoX targeted ultra-low-latency racing with its own PID implementation but same tunable P/I/D/F structure.

---

## Manual Tuning Workflow (Betaflight)

### Prerequisites
1. Flash latest firmware, start from default PIDs
2. Use 4KHz PID loop (F4) or 8KHz (F7/H7) with DShot300/600
3. Enable RPM filtering if ESCs support bidirectional DShot
4. Load appropriate RC link preset (ELRS, Crossfire, etc.)
5. Enable Expert Mode in Configurator for full slider access

### Step-by-Step Process

**Step 1 — Isolate P**
- Set Feedforward slider to 0 and Dynamic Damping to 0
- Increase P (via PI slider) in 0.2 increments per flight
- Test with quick snap rolls, pitch flips, rapid direction reversals
- Stop when you hear/see oscillation → back off 10-15%

**Step 2 — Set D for damping**
- Increase D (Damping slider) in 0.2 increments per flight
- Check: do motors sound rough? → D too high
- Check: overshoot on flips? → D too low
- P:D ratio matters — moving both together preserves the ratio

**Step 3 — Tune Feedforward**
- Re-enable Feedforward slider, start at ~100 (1.0)
- Fly snap rolls: does gyro lag behind setpoint? → increase FF
- Does gyro overshoot setpoint? → decrease FF
- Transition parameter: 0.3-0.5 for freestyle (soft center), 0 for racing

**Step 4 — Adjust I**
- Cruise forward with minimal stick → drone should hold attitude
- Drifting? → increase I
- Bounceback after flips? → lower iterm_relax_cutoff (not necessarily I itself)
- I has a very wide acceptable range for 5" quads (slider 0.5-1.5)

**Step 5 — Yaw**
- Start with Yaw P at half of roll/pitch P
- Increase until roughness in forward flight or punch-outs
- Back off slightly; verify in Blackbox that yaw gyro is smooth

**Step 6 — TPA and Dynamic Idle**
- If oscillation only at high throttle → configure TPA breakpoint just below where it starts
- Set Dynamic Idle RPM: 3000-3500 for 5", higher for smaller/lower-pitch props

**Step 7 — Validate**
- Propwash test: punch up → cut throttle → descend through wake
- Some oscillation normal; violent shaking → more D or motor authority
- Check motor temperatures after 2-minute flight — warm is OK, too hot to touch is not

---

## Blackbox Analysis Methodology

### Tools
| Tool | Status | Purpose |
|------|--------|---------|
| Betaflight Blackbox Explorer | Active | Official log viewer, gyro/PID traces, FFT |
| PIDToolbox | Ended May 2024 (paid); PIDscope fork available | Step response analysis, noise spectra |
| FPVtune (fpvtune.com) | Active | Neural network auto-analysis, generates CLI commands |
| UAV Painkillers Tuning Tools | Active | Web-based slider sweep analyzer |

### What to Log
- Blackbox logging rate: 500Hz recommended for 8KHz PID loop
- 16MB flash ≈ six 30-second flights
- Log throttle sweeps, snap maneuvers, and cruise separately

### Key Frequency Ranges
| Range | What Lives There |
|-------|-----------------|
| < 20 Hz | Normal flight movement (stick inputs) |
| 20-100 Hz | Propwash, PID oscillation, bad ESC config, poor RC settings |
| 100-250 Hz | Frame resonance, bent props, unbalanced motors |
| > 250 Hz | Motor/prop noise and harmonics — filter territory |

### Diagnostic Patterns
- **D-term oscillation**: High-frequency noise on D trace → lower D or improve filtering
- **P oscillation**: Visible in P trace and gyro → P too high
- **Setpoint tracking gap**: Gyro lags setpoint on moves → increase FF
- **Bounceback**: I-term spikes at end of flips → lower iterm_relax_cutoff
- **Gyro noise floor**: Compare axes — if one axis much noisier below 200Hz, suspect bad gyro or vibration source on that axis

### Filter Tuning via Blackbox
1. Do throttle sweep flights (hover → full throttle → hover, 30 seconds)
2. View unfiltered gyro (Gyro_Scaled) FFT in Blackbox Explorer
3. Identify motor noise peak frequencies
4. Set gyro lowpass cutoff above the flight envelope but below noise floor
5. Dynamic notch should track motor RPM harmonics automatically (with RPM filter)
6. D-term lowpass: more aggressive filtering needed since D amplifies noise 10-100x

---

## Filter ↔ PID Interaction

Filters and PIDs are deeply intertwined. The golden rule: **minimum filtering needed, maximum PID authority possible**.

| More Filtering → | Less Filtering → |
|------------------|-----------------|
| Cooler motors | Hotter motors (noise reaches motors) |
| More latency/delay | Less latency/delay |
| Mushy stick feel | Crisper response |
| PID can't correct fast enough | PID can respond to real disturbances |

### Filter Stack (Betaflight 4.3+)
1. **RPM Filter** (best filter available) — requires bidirectional DShot + BLHeli_32/AM32
2. **Dynamic Notch** — auto-tracks remaining resonances
3. **Gyro Lowpass 1** — PT1 or Biquad, catches remaining HF noise
4. **Gyro Lowpass 2** — additional filtering if needed (disable if possible)
5. **D-term Lowpass 1 & 2** — critical because D amplifies noise

**Rule of thumb**: With RPM filter enabled, you can run higher PIDs with less software filtering. Without RPM filter, you need more aggressive lowpass filtering which adds delay.

### Common Filter CLI
```
# RPM filter (requires bidirectional DShot)
set rpm_filter_harmonics = 3
set rpm_filter_min_hz = 100

# Dynamic notch
set dyn_notch_count = 3
set dyn_notch_q = 300
set dyn_notch_min_hz = 100
set dyn_notch_max_hz = 600

# Gyro lowpass (simplified slider)
set simplified_gyro_filter_multiplier = 100  # higher = less filtering

# D-term lowpass (simplified slider)
set simplified_dterm_filter_multiplier = 100  # higher = less filtering
```

---

## Autotuning Algorithms

### Classical: Ziegler-Nichols Ultimate Gain Method

The foundational autotuning algorithm (1942). Process:
1. Set I=0, D=0
2. Increase P (Kp) until sustained oscillation at constant amplitude
3. Record ultimate gain (Ku) and ultimate period (Tu)
4. Apply empirical formulas:

| Controller | Kp | Ti | Td |
|-----------|----|----|-----|
| P only | 0.5·Ku | — | — |
| PI | 0.45·Ku | Tu/1.2 | — |
| PID | 0.6·Ku | Tu/2 | Tu/8 |

**Limitations for drones**: Deliberately inducing sustained oscillation is dangerous on a flying vehicle. The resulting gains are typically too aggressive (quarter-wave decay) and need detuning.

### Åström-Hägglund Relay Method

Safer alternative: replace PID with an ON/OFF relay → system oscillates in a controlled limit cycle without risk of instability. Measure amplitude and period of the limit cycle to derive Ku and Tu.

**Benefits over Ziegler-Nichols cycling**: loop output stays close to setpoint, little a priori knowledge needed, no risk of runaway instability.

**ArduPilot's AutoTune** is conceptually based on this approach — performing controlled "twitches" (relay-like step inputs) and measuring the response.

### Tyreus-Luyben (Less Aggressive)

Modified Ziegler-Nichols for less overshoot:
- Kp = 0.31·Ku (vs 0.6·Ku for Z-N PID)
- Ti = 2.2·Tu (vs Tu/2 for Z-N PID)

More conservative but often more appropriate for real-world systems.

### Iterative Feedback Tuning (IFT)

Combines relay autotuning with gradient-descent optimization to achieve specified phase margin and bandwidth. Overcomes limitation of Z-N formulas giving only rough tuning. Demonstrated on laboratory systems with improved results over standard relay methods.

---

## Emerging: ML/AI-Based Tuning

### Neural Network Blackbox Analysis (FPVtune)

FPVtune fills the gap of Betaflight having no built-in autotune by using a neural network trained on thousands of real-world blackbox logs.

**Pipeline**: Blackbox log → spectral analysis (gyro noise, FFT) → step response measurement → PID error evaluation → optimized P/I/D/F + filter settings → CLI commands

**What it analyzes**: gyro noise spectrum, D-term resonance, step response characteristics, filter performance. Accounts for RPM filter presence, firmware version (4.3/4.4/4.5+), and flying style.

**Motor thermal prediction**: Included to prevent recommending settings that overheat motors.

### Reinforcement Learning Controllers

Research frontier — replacing PID entirely with learned controllers:

- **Neuroflight** (2018): First neural-network-enabled drone controller. Replaced PID with NN trained in simulation. Rationale: PID is linear but the environment is nonlinear.
- **RAPTOR** (2025): Single end-to-end NN policy controlling quadrotors from 32g to 2.4kg across different motor types and frame configurations.
- **TD3 curriculum learning**: Achieved 94% success in dynamic mass scenarios, 60%+ reduction in positional error vs static PID.
- **Hybrid NN + Fuzzy Logic**: Maintained trajectory tracking with <2% error under 25% mass increase and 10% inertia variation.

### Model Reference Adaptive Control (MRAC)

Implemented on PX4-based quadrotors carrying unknown suspended payloads. Maintained stability and damped oscillations across different payload masses, outperforming static PID.

### LQR/LQG (Optimal Control)

Linear Quadratic Regulator offers optimal tradeoff between state error and control effort. In drone applications: faster stabilization, minimal overshoot, lower energy consumption vs hand-tuned PID. Trade-off: requires accurate system model, harder to implement and tune intuitively.

---

## Tuning by Drone Class

| Class | P Range | D Range | I Notes | FF Notes | Special |
|-------|---------|---------|---------|----------|---------|
| Tiny Whoop (1S) | Low-Med | Low | Moderate | Low | 48KHz PWM helps; thrust linear 25% |
| 3" Cinewhoop | Med | Med | Med | Med | Propguards add drag; lower authority |
| 5" Freestyle | Med-High | Med-High | Wide range OK | 80-140 | Standard tuning target |
| 5" Racing | High | Med | Med, relax cutoff 30 | High (150+) | Minimize latency; TPA important |
| 7" Long Range | Med | Med-Low | Low, relax cutoff 10 | Med | Lower authority; conservative PIDs |
| Cinelifter (8-10") | Low-Med | Low-Med | Low, relax cutoff 10 | Low-Med | Heavy; careful with D; oversized props |
| Fixed Wing (BF 4.6) | Start low (5-10) | Start low | Use SPA I_FREEZE | Experimental | S-term primary; TPA = airspeed attenuation |

---

## Troubleshooting Quick Reference

| Symptom | Most Likely Cause | Fix |
|---------|------------------|-----|
| High-frequency buzz/oscillation | P too high, or D amplifying noise | Lower P by 10%; check filters |
| Wobble at end of flips (bounceback) | I-term windup | Lower iterm_relax_cutoff (15→10) |
| Slow/mushy response | P too low, or too much filtering | Raise P; increase filter multiplier |
| Propwash on descent | Physics + low D authority at low throttle | Increase D; Dynamic Idle; accept some propwash |
| Hot motors (no visible oscillation) | D-term noise, insufficient filtering | Enable RPM filter; lower D-term filter multiplier |
| Oscillation only at high throttle | PID gains too high at top of range | Configure TPA: set tpa_rate, tpa_breakpoint |
| Nose dip on punch-out | Anti-gravity too low, or thrust linear off | Enable anti_gravity_gain; set thrust_linear = 20 |
| One axis much noisier in Blackbox | Bad gyro, vibration, or wiring near gyro | Rotate FC 90°; if noise follows = bad gyro |
| Drift in cruise (no wind) | I gain too low | Increase I; check CG balance |
| Twitchy around center stick | FF too high for freestyle | Set feedforward_transition = 0.3-0.5 |

---

## Recommended Tuning Resources

| Resource | URL | Notes |
|----------|-----|-------|
| Oscar Liang PID Guide | oscarliang.com/pid/ | Best conceptual overview |
| Oscar Liang Blackbox Tuning | oscarliang.com/pid-filter-tuning-blackbox/ | 8000-word practical Blackbox tutorial |
| UAV Tech Tuning Principles | theuavtech.com/tuning/ | Video-based, covers all quad classes |
| Betaflight Wiki PID Guide | github.com/betaflight/betaflight/wiki/PID-Tuning-Guide | Official reference |
| FPVtune | fpvtune.com | Neural network auto-tuning from Blackbox logs |
| UAV Painkillers Tuning Tools | fpv-drone.info/tools/tuning-tools/ | Web-based slider sweep analysis |
| ArduPilot AutoTune Docs | ardupilot.org/copter/docs/autotune.html | Built-in autotune for ArduCopter |
| PIDscope (PIDToolbox fork) | github.com/dzikus/PIDscope | Open-source Blackbox analysis (Octave) |

---

## Version History
- v1.0 — March 2026: Initial comprehensive PID tuning knowledge base for Wingman AI
