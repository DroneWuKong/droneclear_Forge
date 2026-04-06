import { useState, useEffect, useRef } from "react";
import { loadDFRData, FALLBACK_PLATFORMS, FALLBACK_GRANTS, FALLBACK_BEYOND, FALLBACK_NASAO } from "./dfrData.js";

// Static mission recs — derived from mission_recommender.py logic, stable
const MISSION_RECS = {
  patrol: { top: "Flock Alpha", runner_up: "Skydio R10", rationale: "Fastest (60mph) + 911 auto-dispatch. R10 if chain of custody critical." },
  sar: { top: "Skydio X10D", runner_up: "Parrot ANAFI USA", rationale: "AI autonomy + GPS-denied + ESRI integration. Parrot for thermal/zoom at lower cost." },
  indoor_tactical: { top: "BRINC Lemur 2", runner_up: "N/A", rationale: "Only platform class that qualifies. Collision-tolerant, GPS-denied, two-way audio." },
  structure_fire: { top: "Skydio F10", runner_up: "Parrot ANAFI USA", rationale: "Thermal + ESRI purpose-built for fire. Parrot strong SAR/fire option at lower price." },
  traffic: { top: "Parrot ANAFI USA", runner_up: "Skydio X10D", rationale: "32x optical zoom + FLIR ideal for accident reconstruction. ESRI integration for mapping." },
  crowd: { top: "Flock Alpha", runner_up: "Skydio R10", rationale: "ALPR from 2000ft + 45min flight time + Fusus RTCC for command center integration." },
};

const DFR_PROGRAMS = { active: 300, growth_yoy: "6x", first_arrival_pct: 74, states_with_programs: 38 };

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --ink: #0a0c10;
    --ink2: #11141b;
    --ink3: #181d27;
    --border: rgba(255,255,255,0.07);
    --border2: rgba(255,255,255,0.12);
    --accent: #00d4ff;
    --accent2: #0096cc;
    --warn: #ff6b35;
    --ok: #00e676;
    --mid: #ffb300;
    --muted: #4a5568;
    --text: #c8d4e0;
    --text2: #7a8fa6;
    --text3: #4a5a6a;
    --display: 'Syne', sans-serif;
    --mono: 'JetBrains Mono', monospace;
  }

  body { background: var(--ink); color: var(--text); font-family: var(--mono); }

  .app {
    min-height: 100vh;
    background:
      radial-gradient(ellipse 80% 50% at 20% 0%, rgba(0,212,255,0.04) 0%, transparent 60%),
      radial-gradient(ellipse 60% 40% at 80% 100%, rgba(0,150,204,0.03) 0%, transparent 50%),
      var(--ink);
  }

  /* HEADER */
  .header {
    border-bottom: 1px solid var(--border2);
    padding: 0 32px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(10,12,16,0.95);
    position: sticky; top: 0; z-index: 100;
    backdrop-filter: blur(12px);
  }
  .logo { display: flex; align-items: center; gap: 12px; }
  .logo-mark {
    width: 28px; height: 28px;
    background: var(--accent);
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    display: flex; align-items: center; justify-content: center;
    animation: pulse-hex 3s ease-in-out infinite;
  }
  @keyframes pulse-hex {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  .logo-text { font-family: var(--display); font-size: 15px; font-weight: 800; letter-spacing: 0.08em; color: #fff; }
  .logo-sub { font-size: 10px; color: var(--text2); letter-spacing: 0.12em; margin-top: 1px; }
  .header-right { display: flex; align-items: center; gap: 20px; font-size: 11px; color: var(--text2); }
  .live-dot { width: 6px; height: 6px; background: var(--ok); border-radius: 50%; animation: blink 2s ease-in-out infinite; }
  @keyframes blink { 0%,100% { opacity:1; } 50% { opacity: 0.3; } }

  /* NAV TABS */
  .nav { display: flex; gap: 2px; padding: 0 32px; border-bottom: 1px solid var(--border); background: var(--ink2); }
  .tab {
    padding: 12px 20px; font-size: 11px; letter-spacing: 0.1em; cursor: pointer;
    color: var(--text3); border-bottom: 2px solid transparent; transition: all 0.2s;
    font-family: var(--mono); text-transform: uppercase;
  }
  .tab:hover { color: var(--text2); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab .badge {
    display: inline-block; margin-left: 6px; padding: 1px 5px;
    background: rgba(0,212,255,0.12); border-radius: 3px; font-size: 9px; color: var(--accent);
  }

  /* MAIN */
  .main { padding: 28px 32px; max-width: 1400px; }

  /* STAT ROW */
  .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  .stat-card {
    background: var(--ink2); border: 1px solid var(--border);
    padding: 18px 20px; position: relative; overflow: hidden;
  }
  .stat-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--accent), transparent);
  }
  .stat-val { font-family: var(--display); font-size: 32px; font-weight: 800; color: #fff; line-height: 1; }
  .stat-val.warn { color: var(--warn); }
  .stat-val.ok { color: var(--ok); }
  .stat-label { font-size: 10px; color: var(--text2); letter-spacing: 0.12em; margin-top: 6px; text-transform: uppercase; }
  .stat-delta { font-size: 10px; color: var(--ok); margin-top: 4px; }

  /* SECTION TITLE */
  .section-header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 16px; }
  .section-title { font-family: var(--display); font-size: 14px; font-weight: 700; letter-spacing: 0.06em; color: #fff; text-transform: uppercase; }
  .section-line { flex: 1; height: 1px; background: var(--border); }
  .section-meta { font-size: 10px; color: var(--text3); letter-spacing: 0.08em; }

  /* PLATFORM TABLE */
  .platform-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .platform-table th {
    text-align: left; padding: 8px 12px; font-size: 10px; letter-spacing: 0.1em;
    color: var(--text3); border-bottom: 1px solid var(--border2); font-weight: 500;
    text-transform: uppercase; font-family: var(--mono);
  }
  .platform-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .platform-table tr:hover td { background: rgba(255,255,255,0.02); }
  .platform-name { color: #fff; font-weight: 500; font-size: 12px; }
  .platform-sub { font-size: 10px; color: var(--text2); margin-top: 2px; }

  /* BADGES */
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 2px; font-size: 10px; letter-spacing: 0.06em; font-weight: 500; }
  .badge-ok { background: rgba(0,230,118,0.1); color: var(--ok); border: 1px solid rgba(0,230,118,0.2); }
  .badge-warn { background: rgba(255,107,53,0.1); color: var(--warn); border: 1px solid rgba(255,107,53,0.2); }
  .badge-mid { background: rgba(255,179,0,0.1); color: var(--mid); border: 1px solid rgba(255,179,0,0.2); }
  .badge-info { background: rgba(0,212,255,0.08); color: var(--accent); border: 1px solid rgba(0,212,255,0.15); }
  .badge-muted { background: rgba(255,255,255,0.04); color: var(--text2); border: 1px solid var(--border); }

  /* FRICTION */
  .friction-low { color: var(--ok); font-weight: 600; }
  .friction-med { color: var(--mid); font-weight: 600; }
  .friction-high { color: var(--warn); font-weight: 600; }

  /* TWO COL */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
  .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 28px; }

  /* CARD */
  .card { background: var(--ink2); border: 1px solid var(--border); padding: 20px; }

  /* GRANT CARD */
  .grant-card { padding: 16px 20px; border-bottom: 1px solid var(--border); }
  .grant-card:last-child { border-bottom: none; }
  .grant-name { font-size: 13px; color: #fff; font-weight: 600; font-family: var(--display); }
  .grant-agency { font-size: 10px; color: var(--text2); margin-top: 2px; }
  .grant-meta { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .grant-award { font-size: 11px; color: var(--ok); font-family: var(--mono); }

  /* MISSION REC */
  .mission-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .mission-card {
    background: var(--ink3); border: 1px solid var(--border);
    padding: 16px; cursor: pointer; transition: border-color 0.2s;
  }
  .mission-card:hover { border-color: var(--accent2); }
  .mission-card.selected { border-color: var(--accent); background: rgba(0,212,255,0.03); }
  .mission-label { font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
  .mission-top { font-size: 14px; color: #fff; font-weight: 600; font-family: var(--display); }
  .mission-rationale { font-size: 10px; color: var(--text2); margin-top: 6px; line-height: 1.5; }

  /* BEYOND STATUS */
  .beyond-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .beyond-row:last-child { border-bottom: none; }
  .beyond-key { color: var(--text2); }
  .beyond-val { color: #fff; font-family: var(--mono); }

  /* FILTER BAR */
  .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .filter-btn {
    padding: 5px 12px; font-size: 10px; letter-spacing: 0.08em; cursor: pointer;
    background: var(--ink3); border: 1px solid var(--border); color: var(--text2);
    text-transform: uppercase; transition: all 0.15s; font-family: var(--mono);
  }
  .filter-btn:hover { border-color: var(--border2); color: var(--text); }
  .filter-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(0,212,255,0.06); }

  /* PAYWALL */
  .paywall {
    background: linear-gradient(135deg, rgba(0,212,255,0.06), rgba(0,150,204,0.03));
    border: 1px solid rgba(0,212,255,0.2);
    padding: 32px; text-align: center; position: relative; overflow: hidden;
  }
  .paywall::before {
    content: ''; position: absolute; inset: 0;
    background: repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,212,255,0.01) 10px, rgba(0,212,255,0.01) 11px);
  }
  .paywall-title { font-family: var(--display); font-size: 20px; font-weight: 800; color: #fff; position: relative; }
  .paywall-sub { font-size: 12px; color: var(--text2); margin-top: 8px; position: relative; }
  .paywall-tiers { display: flex; gap: 16px; justify-content: center; margin-top: 24px; flex-wrap: wrap; }
  .tier-card {
    background: var(--ink2); border: 1px solid var(--border);
    padding: 20px 24px; min-width: 180px; position: relative;
  }
  .tier-card.featured { border-color: var(--accent); }
  .tier-card.featured::before { content: 'MOST POPULAR'; position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: var(--accent); color: var(--ink); font-size: 9px; font-weight: 700; padding: 2px 8px; letter-spacing: 0.1em; }
  .tier-name { font-family: var(--display); font-size: 14px; font-weight: 800; color: #fff; }
  .tier-price { font-size: 28px; font-weight: 800; font-family: var(--display); color: var(--accent); margin-top: 8px; }
  .tier-price-sub { font-size: 10px; color: var(--text2); }
  .tier-features { margin-top: 14px; }
  .tier-feature { font-size: 11px; color: var(--text2); padding: 4px 0; border-top: 1px solid var(--border); display: flex; gap: 6px; }
  .tier-feature::before { content: '›'; color: var(--accent); flex-shrink: 0; }
  .cta-btn {
    margin-top: 14px; width: 100%; padding: 9px; font-size: 11px; letter-spacing: 0.1em;
    background: var(--accent); color: var(--ink); font-weight: 700; cursor: pointer;
    border: none; font-family: var(--mono); text-transform: uppercase; transition: opacity 0.2s;
  }
  .cta-btn:hover { opacity: 0.85; }
  .cta-btn.outline { background: transparent; color: var(--accent); border: 1px solid var(--accent); }

  /* PART 108 ALERT */
  .alert {
    background: rgba(255,179,0,0.06); border: 1px solid rgba(255,179,0,0.2);
    padding: 12px 16px; display: flex; gap: 12px; align-items: flex-start;
    margin-bottom: 20px; font-size: 11px;
  }
  .alert-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
  .alert-text { color: var(--text2); line-height: 1.6; }
  .alert-text strong { color: var(--mid); }

  /* SCROLLBAR */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: var(--ink); }
  ::-webkit-scrollbar-thumb { background: var(--muted); }

  /* RESPONSIVE */
  @media (max-width: 900px) {
    .stat-row { grid-template-columns: repeat(2, 1fr); }
    .two-col { grid-template-columns: 1fr; }
    .three-col { grid-template-columns: 1fr 1fr; }
    .mission-grid { grid-template-columns: repeat(2, 1fr); }
    .paywall-tiers { flex-direction: column; align-items: center; }
  }
  @media (max-width: 600px) {
    .main { padding: 20px 16px; }
    .header { padding: 0 16px; }
    .nav { padding: 0 16px; overflow-x: auto; }
    .mission-grid { grid-template-columns: 1fr; }
    .three-col { grid-template-columns: 1fr; }
  }
`;

function CheckIcon({ ok }) {
  return ok
    ? <span style={{color:'var(--ok)'}}>✓</span>
    : <span style={{color:'var(--warn)'}}>✗</span>;
}

function FrictionBadge({ level }) {
  const cls = level === "LOW" ? "friction-low" : level === "MED" ? "friction-mid" : "friction-high";
  return <span className={cls}>{level}</span>;
}

export default function DFRForgeDashboard() {
  const [activeTab, setActiveTab] = useState("platforms");
  const [missionFilter, setMissionFilter] = useState("all");
  const [selectedMission, setSelectedMission] = useState("patrol");
  const [grantFilter, setGrantFilter] = useState("all");
  const [tick, setTick] = useState(0);

  // ── LIVE DATA STATE ──
  const [platforms, setPlatforms] = useState(FALLBACK_PLATFORMS);
  const [grants, setGrants] = useState(FALLBACK_GRANTS);
  const [beyond, setBeyond] = useState(FALLBACK_BEYOND);
  const [nasaoStates, setNasaoStates] = useState(FALLBACK_NASAO);
  const [grantMatrix, setGrantMatrix] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  // ── FETCH LIVE DATA ON MOUNT ──
  useEffect(() => {
    loadDFRData().then(data => {
      if (data.platforms?.length) setPlatforms(data.platforms);
      if (data.grants?.length) setGrants(data.grants);
      if (data.beyond) setBeyond(data.beyond);
      if (data.nasaoStates?.length) setNasaoStates(data.nasaoStates);
      if (data.grantMatrix) setGrantMatrix(data.grantMatrix);
      if (data.vendors?.length) setVendors(data.vendors);
      setDataLoaded(true);
      setLastUpdated(new Date().toLocaleDateString());
    }).catch(err => {
      console.warn("[DFR] Data load failed, using fallbacks:", err);
      setDataLoaded(false);
    });
  }, []);

  const filteredPlatforms = missionFilter === "all"
    ? platforms
    : platforms.filter(p => p.use_cases.includes(missionFilter));

  const missionKeys = Object.keys(MISSION_RECS);

  return (
    <>
      <style>{styles}</style>
      <div className="app">

        {/* HEADER */}
        <header className="header">
          <div className="logo">
            <div className="logo-mark" />
            <div>
              <div className="logo-text">DRONECLEAR FORGE</div>
              <div className="logo-sub">DFR INTELLIGENCE PLATFORM</div>
            </div>
          </div>
          <div className="header-right">
            <span style={{color:'var(--text3)', fontSize:10}}>AEL 03OE-07-SUAS</span>
            <span style={{color:'var(--border2)'}}>|</span>
            <span>NDAA §848 TRACKER</span>
            <span style={{color:'var(--border2)'}}>|</span>
            <div className="live-dot" />
            <span style={{color: dataLoaded ? 'var(--ok)' : 'var(--mid)', fontSize:10}}>
              {dataLoaded ? `LIVE · ${lastUpdated}` : "CACHED"}
            </span>
          </div>
        </header>

        {/* NAV */}
        <nav className="nav">
          {[
            { id: "platforms", label: "Platforms", count: platforms.length },
            { id: "grants", label: "Grant Programs", count: grants.length },
            { id: "missions", label: "Mission Recommender" },
            { id: "beyond", label: "BEYOND Status" },
            { id: "reports", label: "Reports", locked: true },
          ].map(t => (
            <div
              key={t.id}
              className={`tab ${activeTab === t.id ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
              {t.count && <span className="badge">{t.count}</span>}
              {t.locked && <span className="badge" style={{background:'rgba(255,107,53,0.1)',color:'var(--warn)',border:'1px solid rgba(255,107,53,0.2)'}}>PRO</span>}
            </div>
          ))}
        </nav>

        <div className="main">

          {/* ALERT */}
          <div className="alert">
            <span className="alert-icon">⚡</span>
            <div className="alert-text">
              <strong>FAA Part 108</strong> — National BVLOS framework expected mid-2026. Will replace case-by-case BEYOND waivers. All BEYOND pathway reports will be updated when rule drops.
              &nbsp;<span style={{color:'var(--accent)',cursor:'pointer'}}>Monitor →</span>
            </div>
          </div>

          {/* STAT ROW — always visible */}
          <div className="stat-row">
            <div className="stat-card">
              <div className="stat-val ok">214+</div>
              <div className="stat-label">BEYOND Waivers Approved</div>
              <div className="stat-delta">↑ 6x YoY growth</div>
            </div>
            <div className="stat-card">
              <div className="stat-val" style={{color:'var(--accent)'}}>≤7 days</div>
              <div className="stat-label">Avg Approval Time</div>
              <div className="stat-delta">↓ from 11+ months (pre-May 2025)</div>
            </div>
            <div className="stat-card">
              <div className="stat-val">300+</div>
              <div className="stat-label">Active DFR Programs</div>
              <div className="stat-delta">38 states with programs</div>
            </div>
            <div className="stat-card">
              <div className="stat-val ok">74%</div>
              <div className="stat-label">Drone First Arrival Rate</div>
              <div className="stat-delta">Before ground units</div>
            </div>
          </div>

          {/* PLATFORMS TAB */}
          {activeTab === "platforms" && (
            <>
              <div className="section-header">
                <span className="section-title">NDAA-Compliant DFR Platforms</span>
                <span className="section-line" />
                <span className="section-meta">FREE TIER — Updated weekly</span>
              </div>

              <div className="filter-bar">
                {[
                  { id: "all", label: "All Platforms" },
                  { id: "patrol", label: "Patrol / Crime" },
                  { id: "sar", label: "SAR" },
                  { id: "fire", label: "Fire" },
                  { id: "indoor_tactical", label: "Indoor Tactical" },
                  { id: "traffic", label: "Traffic" },
                ].map(f => (
                  <button key={f.id} className={`filter-btn ${missionFilter === f.id ? "active" : ""}`} onClick={() => setMissionFilter(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>

              <div style={{overflowX:'auto', marginBottom:28}}>
                <table className="platform-table">
                  <thead>
                    <tr>
                      <th>Platform</th>
                      <th>NDAA</th>
                      <th>Blue UAS</th>
                      <th>AEL 03OE-07</th>
                      <th>Grant Friction</th>
                      <th>Speed</th>
                      <th>Flight Time</th>
                      <th>Thermal</th>
                      <th>CAD Integration</th>
                      <th>Mfg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlatforms.map(p => (
                      <tr key={p.id}>
                        <td>
                          <div className="platform-name">
                            {p.name}
                            {p.dfr_native && <span className="badge badge-info" style={{marginLeft:6}}>DFR-NATIVE</span>}
                            {p.indoor && <span className="badge badge-muted" style={{marginLeft:6}}>INDOOR</span>}
                          </div>
                          <div className="platform-sub">{p.price_signal}</div>
                        </td>
                        <td><CheckIcon ok={p.ndaa} /></td>
                        <td><CheckIcon ok={p.blue_uas} /></td>
                        <td><CheckIcon ok={p.ael} /></td>
                        <td><FrictionBadge level={p.grant_friction} /></td>
                        <td style={{color:'var(--text)', fontFamily:'var(--mono)'}}>{p.speed} mph</td>
                        <td style={{color:'var(--text)', fontFamily:'var(--mono)'}}>{p.flight_time} min</td>
                        <td><CheckIcon ok={p.thermal} /></td>
                        <td>
                          <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
                            {p.cad.length > 0
                              ? p.cad.slice(0,2).map(c => <span key={c} className="badge badge-muted">{c}</span>)
                              : <span style={{color:'var(--text3)', fontSize:10}}>None documented</span>
                            }
                            {p.cad.length > 2 && <span className="badge badge-muted">+{p.cad.length-2}</span>}
                          </div>
                        </td>
                        <td style={{fontSize:10, color:'var(--text2)'}}>{p.mfg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PAYWALL TEASER */}
              <div className="paywall">
                <div className="paywall-title">Full Platform Intelligence</div>
                <div className="paywall-sub">Vendor support ratings · CAD integration depth · Grant eligibility by program · Dock compatibility · Agency deployment references</div>
                <div className="paywall-tiers">
                  <div className="tier-card">
                    <div className="tier-name">DFR Basic</div>
                    <div className="tier-price">$149<span className="tier-price-sub"> /report</span></div>
                    <div className="tier-features">
                      {["Grant eligibility matrix (3 platforms)", "Compliance documentation checklist", "1 mission type recommendation", "State SAA contacts"].map(f => (
                        <div key={f} className="tier-feature">{f}</div>
                      ))}
                    </div>
                    <button className="cta-btn outline">Get Report</button>
                  </div>
                  <div className="tier-card featured">
                    <div className="tier-name">DFR Full Intel</div>
                    <div className="tier-price">$449<span className="tier-price-sub"> /report</span></div>
                    <div className="tier-features">
                      {["FAA BEYOND pathway guide", "Full CAD integration matrix", "Program standup checklist", "3 mission type recommendations", "Vendor support ratings"].map(f => (
                        <div key={f} className="tier-feature">{f}</div>
                      ))}
                    </div>
                    <button className="cta-btn">Get Report</button>
                  </div>
                  <div className="tier-card">
                    <div className="tier-name">State Program</div>
                    <div className="tier-price">$899<span className="tier-price-sub"> /report</span></div>
                    <div className="tier-features">
                      {["Statewide DFR program landscape", "Ohio pilot replication guide", "Vendor pre-approval benchmarking", "Legislative tracking"].map(f => (
                        <div key={f} className="tier-feature">{f}</div>
                      ))}
                    </div>
                    <button className="cta-btn outline">Get Report</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* GRANTS TAB */}
          {activeTab === "grants" && (
            <>
              <div className="section-header">
                <span className="section-title">DFR Grant Programs</span>
                <span className="section-line" />
                <span className="section-meta">FREE TIER</span>
              </div>

              <div className="two-col" style={{marginBottom:20}}>
                <div className="card" style={{padding:0}}>
                  {grants.map(g => (
                    <div key={g.id} className="grant-card">
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                        <div>
                          <div className="grant-name">{g.name}</div>
                          <div className="grant-agency">{g.agency}</div>
                        </div>
                        <div className="grant-award">{g.typical_award}</div>
                      </div>
                      <div className="grant-meta">
                        <span className="badge badge-ok">NDAA Req</span>
                        {g.ael_req && <span className="badge badge-info">AEL 03OE-07</span>}
                        {!g.blue_uas_req && <span className="badge badge-muted">Blue UAS optional</span>}
                        <span className="badge badge-muted">{g.cycle}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card">
                  <div style={{fontSize:12, color:'var(--text)', fontFamily:'var(--display)', fontWeight:700, marginBottom:14}}>REAL PROGRAM AWARDS</div>
                  {[
                    { agency: "San Bernardino County Sheriff, CA", amount: "$562,500", year: 2025, grant: "COPS Tech" },
                    { agency: "Sterling Heights PD, MI", amount: "$678,822", year: 2026, grant: "COPS Tech (5yr)" },
                    { agency: "Yonkers PD, NY", amount: "~$100K", year: 2024, grant: "Pilot program" },
                    { agency: "Ohio DFR Pilot (statewide)", amount: "$110–230K per site", year: 2025, grant: "State funded" },
                  ].map((a, i) => (
                    <div key={i} style={{padding:'10px 0', borderBottom:'1px solid var(--border)', fontSize:11}}>
                      <div style={{display:'flex', justifyContent:'space-between', marginBottom:4}}>
                        <span style={{color:'#fff', fontWeight:600}}>{a.agency}</span>
                        <span style={{color:'var(--ok)', fontFamily:'var(--mono)', fontWeight:600}}>{a.amount}</span>
                      </div>
                      <div style={{display:'flex', gap:8}}>
                        <span className="badge badge-muted">{a.year}</span>
                        <span className="badge badge-info">{a.grant}</span>
                      </div>
                    </div>
                  ))}

                  <div style={{marginTop:20, padding:16, background:'rgba(0,212,255,0.04)', border:'1px solid rgba(0,212,255,0.1)', fontSize:11, color:'var(--text2)', lineHeight:1.7}}>
                    <span style={{color:'var(--accent)'}}>PRO</span> — Full grant eligibility matrix, SAA contacts by state, application timelines, and budget templates available in DFR Basic ($149) and Full Intel ($449) reports.
                  </div>
                </div>
              </div>
            </>
          )}

          {/* MISSIONS TAB */}
          {activeTab === "missions" && (
            <>
              <div className="section-header">
                <span className="section-title">Mission Recommender</span>
                <span className="section-line" />
                <span className="section-meta">FREE TIER — Detailed reports PRO</span>
              </div>

              <div className="mission-grid" style={{marginBottom:24}}>
                {missionKeys.map(mid => {
                  const rec = MISSION_RECS[mid];
                  const labels = {
                    patrol: "Patrol / Crime Response",
                    sar: "Search & Rescue",
                    indoor_tactical: "Indoor Tactical",
                    structure_fire: "Structure Fire",
                    traffic: "Traffic / Reconstruction",
                    crowd: "Crowd Monitoring",
                  };
                  return (
                    <div
                      key={mid}
                      className={`mission-card ${selectedMission === mid ? "selected" : ""}`}
                      onClick={() => setSelectedMission(mid)}
                    >
                      <div className="mission-label">{labels[mid] || mid}</div>
                      <div className="mission-top">#{1} {rec.top}</div>
                      {selectedMission === mid && (
                        <>
                          {rec.runner_up !== "N/A" && <div style={{fontSize:11, color:'var(--text2)', marginTop:4}}>#2 {rec.runner_up}</div>}
                          <div className="mission-rationale">{rec.rationale}</div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedMission && (
                <div style={{padding:16, background:'rgba(0,212,255,0.03)', border:'1px solid rgba(0,212,255,0.12)', fontSize:11, color:'var(--text2)', lineHeight:1.7}}>
                  <span style={{color:'var(--accent)', fontWeight:700}}>PRO</span> — Full scored recommendation with grant eligibility, CAD matrix, dock options, and budget estimate available in DFR Full Intel report ($449).
                </div>
              )}
            </>
          )}

          {/* BEYOND TAB */}
          {activeTab === "beyond" && (
            <>
              <div className="section-header">
                <span className="section-title">FAA BEYOND Authorization Status</span>
                <span className="section-line" />
                <span className="section-meta">FREE TIER</span>
              </div>

              <div className="two-col">
                <div className="card">
                  <div style={{fontSize:12, color:'var(--text)', fontFamily:'var(--display)', fontWeight:700, marginBottom:14}}>WAIVER STATUS SNAPSHOT</div>
                  {[
                    ["Process change", "May 2025"],
                    ["Waivers approved (as of Jun 2025)", `${beyond.approved}+`],
                    ["Pending review", `${beyond.pending}`],
                    ["Avg approval time", `< ${beyond.avg_days} days`],
                    ["Fastest approval", `< ${beyond.fastest_hours} hours`],
                    ["YoY program growth", "6×"],
                    ["Required equipment", "Parachute + anti-collision lighting + DAA"],
                    ["Part 108 status", beyond.part_108],
                  ].map(([k, v]) => (
                    <div key={k} className="beyond-row">
                      <span className="beyond-key">{k}</span>
                      <span className="beyond-val" style={v === beyond.part_108 ? {color:'var(--mid)'} : {}}>{v}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="card" style={{marginBottom:16}}>
                    <div style={{fontSize:12, color:'var(--text)', fontFamily:'var(--display)', fontWeight:700, marginBottom:12}}>PATHWAY OPTIONS</div>
                    {[
                      { name: "Part 107 BVLOS Waiver", time: "< 1 week", best: "Most DFR programs" },
                      { name: "Certificate of Authorization (COA)", time: "Varies", best: "Persistent / large-area ops" },
                      { name: "Part 107 + COA combined", time: "Sequential", best: "Maximum flexibility" },
                    ].map((p, i) => (
                      <div key={i} style={{padding:'10px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none'}}>
                        <div style={{display:'flex', justifyContent:'space-between', marginBottom:4}}>
                          <span style={{color:'#fff', fontSize:12, fontWeight:600}}>{p.name}</span>
                          <span className="badge badge-ok">{p.time}</span>
                        </div>
                        <div style={{fontSize:10, color:'var(--text2)'}}>Best for: {p.best}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{padding:16, background:'rgba(255,107,53,0.04)', border:'1px solid rgba(255,107,53,0.15)', fontSize:11, color:'var(--text2)', lineHeight:1.7}}>
                    <span style={{color:'var(--warn)', fontWeight:700}}>⚠ Most common failure:</span> Incomplete/illegible application. 58 of 78 pending waivers as of Jun 2025 were stalled due to incomplete submissions.
                  </div>
                </div>
              </div>

              <div style={{marginTop:20, padding:20, background:'rgba(0,212,255,0.03)', border:'1px solid rgba(0,212,255,0.1)'}}>
                <div style={{fontSize:12, color:'var(--accent)', fontWeight:700, marginBottom:8, fontFamily:'var(--display)'}}>PRO — BEYOND Pathway Guide</div>
                <div style={{fontSize:11, color:'var(--text2)', lineHeight:1.7}}>
                  Full jurisdiction-specific BEYOND pathway guide including 5-phase eligibility checklist, safety case requirements, COA vs Part 107 decision tree, service provider comparison (Flying Lion vs SkyfireAI), and Part 108 monitoring updates. Available in DFR Full Intel report ($449).
                </div>
              </div>
            </>
          )}

          {/* REPORTS TAB */}
          {activeTab === "reports" && (
            <div className="paywall">
              <div className="paywall-title">DFR Intelligence Reports</div>
              <div className="paywall-sub">Neutral, data-driven procurement intelligence for public safety agencies and grant administrators</div>
              <div className="paywall-tiers">
                <div className="tier-card">
                  <div className="tier-name">DFR Basic</div>
                  <div className="tier-price">$149<span className="tier-price-sub"> /report</span></div>
                  <div style={{fontSize:10, color:'var(--text2)', marginTop:4}}>or $99/mo subscription</div>
                  <div className="tier-features">
                    {["Grant eligibility for 3 platforms", "Compliance documentation checklist", "1 mission type recommendation", "State SAA contacts + cycle"].map(f => (
                      <div key={f} className="tier-feature">{f}</div>
                    ))}
                  </div>
                  <button className="cta-btn outline">Get Report</button>
                </div>
                <div className="tier-card featured">
                  <div className="tier-name">DFR Full Intel</div>
                  <div className="tier-price">$449<span className="tier-price-sub"> /report</span></div>
                  <div style={{fontSize:10, color:'var(--text2)', marginTop:4}}>or $299/mo subscription</div>
                  <div className="tier-features">
                    {["FAA BEYOND authorization guide", "Full CAD integration matrix", "Vendor support ratings (6 vendors)", "Program standup checklist (7 phases)", "3 mission type recommendations", "DFR service provider comparison"].map(f => (
                      <div key={f} className="tier-feature">{f}</div>
                    ))}
                  </div>
                  <button className="cta-btn">Get Full Intel</button>
                </div>
                <div className="tier-card">
                  <div className="tier-name">State Program</div>
                  <div className="tier-price">$899<span className="tier-price-sub"> /report</span></div>
                  <div style={{fontSize:10, color:'var(--text2)', marginTop:4}}>or $4,999/yr</div>
                  <div className="tier-features">
                    {["Statewide DFR program landscape", "Ohio pilot replication guide", "Vendor pre-approval benchmarking", "Legislative tracking (target state)", "Competitive RFP analysis"].map(f => (
                      <div key={f} className="tier-feature">{f}</div>
                    ))}
                  </div>
                  <button className="cta-btn outline">Contact</button>
                </div>
              </div>
              <div style={{marginTop:28, fontSize:11, color:'var(--text3)'}}>
                DroneClear Forge is vendor-neutral. No manufacturer pays to be listed or recommended. Data updated weekly.
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
