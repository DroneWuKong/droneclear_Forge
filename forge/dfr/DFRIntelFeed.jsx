import { useState, useEffect, useRef } from "react";
import { loadDFRData } from "./dfrData.js";

const SEED_CARDS = [
  {
    id: "dfr-001", channel: "Gray Zone", channelColor: "#ff6b35", locked: true, date: "4/4/2026",
    title: "[GRAY ZONE] Oregon/NASAO white paper: 467 drones grounded, $50M–$2B national exposure across 25 states",
    body: "Oregon Dept of Aviation compiled first multi-state accounting via NASAO. 25 state transportation depts surveyed. 467 drone airframes grounded across 23 states. National exposure $50M–$2B. Wisconsin: 100% fleet grounded. Colorado: 90% capacity lost. Nebraska: 86%. Indiana: 85% ($400K at risk). Georgia: 80% ($225K). Oregon: 1 compliant drone out of 22. Idaho: $15K drone → $42K to replace. White paper recommends waiver until Sept 2027.",
    confidence: 90, tags: ["grounding", "NASAO", "Wisconsin", "ASDA"],
    source_url: "https://www.oregon.gov/aviation/agency/about/Documents/Press%20Releases/OMB-FCC-Order%20Impact-White-Paper.pdf",
    vertical: "dfr", data_category: "regulatory",
  },
  {
    id: "dfr-002", channel: "Program Watch", channelColor: "#00d4ff", locked: false, date: "3/24/2026",
    title: "BRINC Guardian: first Starlink-connected drone, 900+ agency deployments, NLC exclusive partnership",
    body: "BRINC launched Guardian March 24 2026. Starlink connectivity is a first for DFR. 900+ agency deployments across all 50 states and 25%+ of US SWAT teams. NLC (2,600+ member cities) named BRINC exclusive drone partner. Seattle manufacturing. Blue UAS listed.",
    confidence: 95, tags: ["BRINC", "Guardian", "Starlink", "NLC"],
    source_url: "https://droneresponders.org", vertical: "dfr", data_category: "platform_intel",
  },
  {
    id: "dfr-003", channel: "Regulatory", channelColor: "#ffb300", locked: false, date: "3/10/2026",
    title: "FAA leadership at DRONERESPONDERS conference: shift from case-by-case waivers to standardized frameworks",
    body: "FAA Deputy Executive Director Paul Strande opened DRONERESPONDERS National Conference in Williamsburg VA. FAA priority shifting toward standardized rules over individual waivers — direct signal toward Part 108 finalization. Remote ID and cooperative airspace integration are parallel tracks.",
    confidence: 98, tags: ["FAA", "Part108", "DRONERESPONDERS", "BVLOS"],
    source_url: "https://dronelife.com/2026/03/10/faa-highlights-public-safety-drone-progress-at-droneresponders-national-conference/",
    vertical: "dfr", data_category: "regulatory",
  },
  {
    id: "dfr-004", channel: "Market Signal", channelColor: "#00e676", locked: false, date: "3/17/2026",
    title: "National League of Cities + BRINC: DFR program support rolling out to 2,600+ member cities",
    body: "NLC and BRINC announced national initiative. BRINC is exclusive drone partner. Focus on education, direct engagement with local officials, and implementation guidance. NLC has 2,600+ member cities — every city that adopts DFR is a BRINC procurement signal.",
    confidence: 95, tags: ["NLC", "BRINC", "municipal", "procurement"],
    source_url: "https://dronelife.com/2026/03/17/brinc-nlc-drone-as-first-responder-program/",
    vertical: "dfr", data_category: "market_signal",
  },
  {
    id: "dfr-005", channel: "CAD Intel", channelColor: "#00d4ff", locked: false, date: "2/26/2026",
    title: "Skydio DFR Command hits 10M calls — 25+ integrated public safety systems, NG911 pre-CAD dispatch",
    body: "Skydio DFR Command now most deployed DFR solution in the US. 10M+ calls processed. 25+ public safety system integrations. NG911 integration dispatches drone before call is entered into CAD. CJIS-compliant. Brookhaven PD: under 60 seconds, drone on scene while you're still typing the call.",
    confidence: 99, tags: ["Skydio", "DFRCommand", "NG911", "CAD"],
    source_url: "https://www.prnewswire.com/news-releases/skydio-dfr-command-surpasses-10-million-calls-for-service",
    vertical: "dfr", data_category: "platform_intel",
  },
  {
    id: "dfr-006", channel: "Acquisition", channelColor: "#ff6b35", locked: true, date: "2/19/2026",
    title: "[ACQUISITION] Versaterm acquires Aloft — DroneSense now controls fleet mgmt + LAANC + CAD in single stack",
    body: "Versaterm acquired DroneSense (July 2025) then Aloft (Feb 2026). Aloft powers majority of US LAANC authorizations. Combined: fleet management + airspace intelligence + CAD dispatch in one vendor. Agencies can dispatch drones like patrol/fire/EMS units from CAD.",
    confidence: 97, tags: ["Versaterm", "DroneSense", "Aloft", "LAANC"],
    source_url: "https://dronelife.com/2026/02/19/versaterm-acquires-aloft-to-expand-drone-capabilities-for-public-safety/",
    vertical: "dfr", data_category: "vendor_intel",
  },
  {
    id: "dfr-008", channel: "FCC Watch", channelColor: "#ffb300", locked: false, date: "3/18/2026",
    title: "FCC introduces Conditional Approvals for drone systems — 4 systems approved through Dec 31 2026",
    body: "FCC March 18 2026: first Conditional Approvals for drone systems. 4 systems approved through December 31 2026. New pathway sits alongside Blue UAS and Green UAS. Does not replace NDAA requirements. All 4 expire end of 2026. Grant eligibility matrices must be updated.",
    confidence: 99, tags: ["FCC", "ConditionalApproval", "compliance", "NDAA"],
    source_url: "https://dronelife.com/2026/03/20/fcc-updates-covered-list-introduces-first-conditional-approvals-for-drone-systems/",
    vertical: "dfr", data_category: "regulatory",
  },
  {
    id: "dfr-010", channel: "State Watch", channelColor: "#00d4ff", locked: false, date: "2/26/2026",
    title: "Ohio DFR Pilot: first participants identified — SkyfireAI managing statewide rollout under ODOT",
    body: "Ohio identified first municipal participants in nation's only statewide DFR pilot. SkyfireAI program manager. Pre-approved vendor list closed Jan 1 2026 (Skydio, BRINC, Parrot). Package: $110–230K per site. Template for TX, CA, FL, MI state programs.",
    confidence: 96, tags: ["Ohio", "SkyfireAI", "statewide", "ODOT"],
    source_url: "https://dronelife.com/", vertical: "dfr", data_category: "grant",
  },
  {
    id: "dfr-011", channel: "Wisconsin", channelColor: "#ff6b35", locked: true, date: "4/6/2026", exclusive: true,
    title: "[EXCLUSIVE] Wisconsin 100% grounded, Seiler still pushing DJI, no replacement budget — highest-impact Midwest transition market",
    body: "NASAO white paper confirms Wisconsin DOT at 100% grounded — worst in survey. No replacement budget. Seiler GeoDrones (DJI dealer, 9 Midwest states) still featuring Matrice 400 as flagship. Known at-risk programs: Manitowoc County Sheriff (13 FAA-cert pilots), Beaver Dam PD, Wisconsin Rapids PD. $15K→$42K replacement premium. COPS + HSGP grants available but agencies need guidance.",
    confidence: 92, tags: ["Wisconsin", "Seiler", "grounded", "Midwest"],
    source_url: "https://www.oregon.gov/aviation/agency/about/Documents/Press%20Releases/OMB-FCC-Order%20Impact-White-Paper.pdf",
    vertical: "dfr", data_category: "regulatory", exclusive: true,
  },
];

const CATEGORY_COLORS = {
  regulatory: "#ffb300",
  platform_intel: "#00d4ff",
  market_signal: "#00e676",
  vendor_intel: "#ff6b35",
  grant: "#00e676",
};

const CHANNEL_ICONS = {
  "Gray Zone": "⬡",
  "Program Watch": "◈",
  "Regulatory": "⊞",
  "Market Signal": "◉",
  "CAD Intel": "◈",
  "Acquisition": "⬡",
  "Grant Intel": "◉",
  "FCC Watch": "⊞",
  "State Watch": "◈",
  "Wisconsin": "⬡",
};

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500;600&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --ink: #080a0e;
    --ink2: #0e1118;
    --ink3: #141920;
    --ink4: #1a2130;
    --border: rgba(255,255,255,0.06);
    --border2: rgba(255,255,255,0.10);
    --border3: rgba(255,255,255,0.16);
    --accent: #00d4ff;
    --warn: #ff6b35;
    --ok: #00e676;
    --mid: #ffb300;
    --muted: #3a4a5a;
    --text: #b8c8d8;
    --text2: #6a7e92;
    --text3: #3a4e62;
    --display: 'Syne', sans-serif;
    --mono: 'JetBrains Mono', monospace;
  }

  body {
    background: var(--ink);
    color: var(--text);
    font-family: var(--mono);
    min-height: 100vh;
  }

  .feed-root {
    background:
      radial-gradient(ellipse 120% 60% at 10% -10%, rgba(0,212,255,0.03) 0%, transparent 50%),
      radial-gradient(ellipse 80% 50% at 90% 110%, rgba(255,107,53,0.02) 0%, transparent 50%),
      var(--ink);
    min-height: 100vh;
  }

  /* ── HEADER ── */
  .feed-header {
    padding: 0 24px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border2);
    background: rgba(8,10,14,0.96);
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(16px);
  }
  .feed-wordmark {
    display: flex; align-items: center; gap: 10px;
  }
  .feed-hex {
    width: 22px; height: 22px;
    background: var(--warn);
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    animation: hex-pulse 3s ease-in-out infinite;
  }
  @keyframes hex-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
  .feed-wordmark-text {
    font-family: var(--display); font-size: 13px; font-weight: 800;
    letter-spacing: 0.1em; color: #fff;
  }
  .feed-wordmark-sub { font-size: 9px; color: var(--text3); letter-spacing: 0.14em; }
  .feed-header-right {
    display: flex; align-items: center; gap: 16px;
    font-size: 10px; color: var(--text3); letter-spacing: 0.1em;
  }
  .live-pill {
    display: flex; align-items: center; gap: 5px;
    padding: 3px 8px; background: rgba(0,230,118,0.08);
    border: 1px solid rgba(0,230,118,0.2); font-size: 9px; color: var(--ok);
    letter-spacing: 0.12em;
  }
  .live-dot { width: 5px; height: 5px; background: var(--ok); border-radius: 50%; animation: blink 2s ease-in-out infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }

  /* ── VERTICAL TABS ── */
  .vertical-tabs {
    display: flex; gap: 0;
    padding: 0 24px;
    border-bottom: 1px solid var(--border);
    background: var(--ink2);
    overflow-x: auto;
  }
  .vtab {
    padding: 11px 18px; font-size: 10px; letter-spacing: 0.1em;
    cursor: pointer; color: var(--text3); border-bottom: 2px solid transparent;
    text-transform: uppercase; transition: all 0.15s; white-space: nowrap;
    display: flex; align-items: center; gap: 6px;
  }
  .vtab:hover { color: var(--text2); }
  .vtab.active-defense { color: #00d4ff; border-bottom-color: #00d4ff; }
  .vtab.active-dfr { color: #ff6b35; border-bottom-color: #ff6b35; }
  .vtab.active-commercial { color: #00e676; border-bottom-color: #00e676; }
  .vtab-count {
    padding: 1px 5px; border-radius: 2px; font-size: 9px; font-weight: 600;
  }
  .vtab-count-defense { background: rgba(0,212,255,0.12); color: #00d4ff; }
  .vtab-count-dfr { background: rgba(255,107,53,0.12); color: #ff6b35; }
  .vtab-count-commercial { background: rgba(0,230,118,0.12); color: #00e676; }

  /* ── LAYOUT ── */
  .feed-layout { display: grid; grid-template-columns: 220px 1fr; min-height: calc(100vh - 52px - 40px); }

  /* ── SIDEBAR ── */
  .feed-sidebar {
    border-right: 1px solid var(--border);
    padding: 20px 0;
    background: var(--ink2);
  }
  .sidebar-section { margin-bottom: 24px; }
  .sidebar-label {
    padding: 0 16px; margin-bottom: 8px;
    font-size: 9px; letter-spacing: 0.14em; color: var(--text3); text-transform: uppercase;
  }
  .sidebar-filter {
    padding: 7px 16px; font-size: 11px; cursor: pointer;
    color: var(--text2); display: flex; align-items: center; gap: 8px;
    transition: all 0.12s; border-left: 2px solid transparent;
  }
  .sidebar-filter:hover { color: var(--text); background: rgba(255,255,255,0.02); }
  .sidebar-filter.active { color: #ff6b35; border-left-color: #ff6b35; background: rgba(255,107,53,0.04); }
  .sidebar-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .sidebar-count { margin-left: auto; font-size: 10px; color: var(--text3); }

  .sidebar-stat {
    margin: 0 12px 6px;
    padding: 10px 12px;
    background: var(--ink3);
    border: 1px solid var(--border);
  }
  .sidebar-stat-val { font-size: 20px; font-family: var(--display); font-weight: 800; color: #fff; }
  .sidebar-stat-val.warn { color: var(--warn); }
  .sidebar-stat-val.ok { color: var(--ok); }
  .sidebar-stat-label { font-size: 9px; color: var(--text3); letter-spacing: 0.1em; margin-top: 3px; text-transform: uppercase; }

  /* ── MAIN FEED ── */
  .feed-main { padding: 20px 24px; }
  .feed-topbar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px;
  }
  .feed-title-area { display: flex; align-items: center; gap: 12px; }
  .feed-title {
    font-family: var(--display); font-size: 13px; font-weight: 800;
    letter-spacing: 0.08em; color: #fff; text-transform: uppercase;
  }
  .feed-title-accent { color: var(--warn); }
  .feed-subtitle { font-size: 10px; color: var(--text3); letter-spacing: 0.08em; }
  .feed-controls { display: flex; gap: 8px; }
  .ctrl-btn {
    padding: 5px 10px; font-size: 10px; letter-spacing: 0.08em; cursor: pointer;
    background: var(--ink3); border: 1px solid var(--border); color: var(--text2);
    text-transform: uppercase; transition: all 0.12s;
  }
  .ctrl-btn:hover { border-color: var(--border2); color: var(--text); }
  .ctrl-btn.active { border-color: var(--warn); color: var(--warn); background: rgba(255,107,53,0.06); }

  /* ── CARDS ── */
  .card-stack { display: flex; flex-direction: column; gap: 8px; }

  .intel-card {
    background: var(--ink2);
    border: 1px solid var(--border);
    transition: border-color 0.15s;
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }
  .intel-card::before {
    content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: 2px;
    background: var(--channel-color, var(--border2));
    opacity: 0.7;
  }
  .intel-card:hover { border-color: var(--border3); }
  .intel-card:hover::before { opacity: 1; }
  .intel-card.locked { opacity: 0.9; }

  .card-inner { padding: 14px 16px 14px 20px; }
  .card-top {
    display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  }
  .card-channel {
    font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; display: flex; align-items: center; gap: 5px;
  }
  .card-lock { font-size: 10px; }
  .card-date { font-size: 10px; color: var(--text3); margin-left: auto; }
  .card-title {
    font-size: 13px; color: #fff; font-weight: 600; line-height: 1.45;
    margin-bottom: 8px; font-family: var(--display);
  }
  .card-body {
    font-size: 11px; color: var(--text2); line-height: 1.65;
    margin-bottom: 10px;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-body.expanded { -webkit-line-clamp: unset; }
  .card-footer {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  }
  .conf-badge {
    padding: 2px 7px; font-size: 10px; font-weight: 600;
    background: rgba(0,230,118,0.1); color: var(--ok);
    border: 1px solid rgba(0,230,118,0.2); letter-spacing: 0.04em;
  }
  .conf-badge.med {
    background: rgba(255,179,0,0.1); color: var(--mid);
    border-color: rgba(255,179,0,0.2);
  }
  .conf-badge.low {
    background: rgba(255,107,53,0.1); color: var(--warn);
    border-color: rgba(255,107,53,0.2);
  }
  .tag-pill {
    padding: 2px 6px; font-size: 9px; letter-spacing: 0.06em;
    background: rgba(255,255,255,0.04); border: 1px solid var(--border);
    color: var(--text3); text-transform: uppercase;
  }
  .exclusive-badge {
    padding: 2px 7px; font-size: 9px; font-weight: 700;
    background: rgba(255,107,53,0.15); color: var(--warn);
    border: 1px solid rgba(255,107,53,0.3); letter-spacing: 0.08em;
  }
  .card-source {
    margin-left: auto; font-size: 9px; color: var(--text3);
    text-decoration: none; display: flex; align-items: center; gap: 3px;
  }
  .card-source:hover { color: var(--accent); }

  /* ── PAYWALL OVERLAY ── */
  .card-paywall {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, transparent 30%, rgba(8,10,14,0.97) 70%);
    display: flex; align-items: flex-end; justify-content: center;
    padding-bottom: 16px;
  }
  .paywall-cta {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 16px;
    background: rgba(255,107,53,0.12); border: 1px solid rgba(255,107,53,0.3);
    font-size: 11px; color: var(--warn); letter-spacing: 0.08em; cursor: pointer;
    transition: all 0.15s;
  }
  .paywall-cta:hover { background: rgba(255,107,53,0.2); }

  /* ── EMPTY ── */
  .feed-empty {
    padding: 48px; text-align: center; color: var(--text3); font-size: 12px;
  }

  /* ── CATEGORY INDICATOR ── */
  .cat-dot {
    width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; display: inline-block;
  }

  /* ── TOP BANNER ── */
  .dfr-banner {
    background: rgba(255,107,53,0.05);
    border-bottom: 1px solid rgba(255,107,53,0.15);
    padding: 8px 24px;
    display: flex; align-items: center; gap: 12px; font-size: 11px;
  }
  .dfr-banner-icon { font-size: 12px; }
  .dfr-banner-text { color: var(--text2); line-height: 1.5; }
  .dfr-banner-text strong { color: var(--warn); }
  .dfr-banner-link { color: var(--accent); cursor: pointer; margin-left: auto; font-size: 10px; white-space: nowrap; }

  /* ── RESPONSIVE ── */
  @media (max-width: 768px) {
    .feed-layout { grid-template-columns: 1fr; }
    .feed-sidebar { display: none; }
    .feed-main { padding: 16px; }
  }
`;

function ConfBadge({ score }) {
  const cls = score >= 95 ? "" : score >= 85 ? "med" : "low";
  return <span className={`conf-badge ${cls}`}>{score}% confidence</span>;
}

function IntelCard({ item, expanded, onToggle }) {
  const channelIcon = CHANNEL_ICONS[item.channel] || "◆";
  const catColor = CATEGORY_COLORS[item.data_category] || "#ffffff44";

  return (
    <div
      className={`intel-card ${item.locked ? "locked" : ""}`}
      style={{ "--channel-color": item.channelColor }}
      onClick={onToggle}
    >
      <div className="card-inner">
        <div className="card-top">
          <span className="card-channel" style={{ color: item.channelColor }}>
            <span>{channelIcon}</span>
            {item.channel}
          </span>
          {item.locked && <span className="card-lock">🔒</span>}
          {item.exclusive && <span className="exclusive-badge">EXCLUSIVE</span>}
          <span className="card-date">{item.date}</span>
        </div>

        <div className="card-title">{item.title}</div>
        <div className={`card-body ${expanded ? "expanded" : ""}`}>{item.body}</div>

        <div className="card-footer">
          <ConfBadge score={item.confidence} />
          {item.tags.slice(0, 3).map(t => (
            <span key={t} className="tag-pill">{t}</span>
          ))}
          {item.source_url && (
            <a
              className="card-source"
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
            >
              src ↗
            </a>
          )}
        </div>
      </div>

      {item.locked && !expanded && (
        <div className="card-paywall">
          <div className="paywall-cta">
            🔒 UNLOCK — DFR Full Intel $449/report
          </div>
        </div>
      )}
    </div>
  );
}

export default function DFRIntelFeed() {
  const [activeVertical, setActiveVertical] = useState("dfr");
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedCards, setExpandedCards] = useState(new Set());
  const [sortOrder, setSortOrder] = useState("newest");

  // ── LIVE DATA ──
  const [feedCards, setFeedCards] = useState(SEED_CARDS);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    loadDFRData().then(data => {
      if (data.feedCards?.length) {
        // Merge live cards with seed cards — dedup by id, live cards win
        const seedIds = new Set(SEED_CARDS.map(c => c.id));
        const liveOnly = data.feedCards.filter(c => !seedIds.has(c.id));
        setFeedCards([...SEED_CARDS, ...liveOnly]);
        setDataLoaded(true);
        setLastUpdated(new Date().toLocaleDateString());
      }
    }).catch(() => {
      // Stay on SEED_CARDS — already loaded
    });
  }, []);

  const toggleCard = (id) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const CATEGORIES = [
    { id: "all", label: "All Intel", color: "#fff" },
    { id: "regulatory", label: "Regulatory", color: "#ffb300" },
    { id: "platform_intel", label: "Platform Intel", color: "#00d4ff" },
    { id: "market_signal", label: "Market Signal", color: "#00e676" },
    { id: "vendor_intel", label: "Vendor Intel", color: "#ff6b35" },
    { id: "grant", label: "Grant", color: "#00e676" },
  ];

  const filtered = feedCards.filter(item =>
    activeFilter === "all" || item.data_category === activeFilter
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortOrder === "confidence") return b.confidence - a.confidence;
    return b.date.localeCompare(a.date);
  });

  const catCounts = {};
  feedCards.forEach(item => {
    catCounts[item.data_category] = (catCounts[item.data_category] || 0) + 1;
  });

  return (
    <>
      <style>{styles}</style>
      <div className="feed-root">

        {/* HEADER */}
        <header className="feed-header">
          <div className="feed-wordmark">
            <div className="feed-hex" />
            <div>
              <div className="feed-wordmark-text">DRONECLEAR FORGE</div>
              <div className="feed-wordmark-sub">INTELLIGENCE FEED</div>
            </div>
          </div>
          <div className="feed-header-right">
            <span>geprole.netlify.app</span>
            <div className="live-pill">
              <div className="live-dot" />
              LIVE
            </div>
          </div>
        </header>

        {/* VERTICAL TABS */}
        <nav className="vertical-tabs">
          {[
            { id: "defense", label: "Defense", count: 24 },
            { id: "dfr", label: "DFR", count: feedCards.length },
            { id: "commercial", label: "Commercial", count: 18 },
          ].map(v => (
            <div
              key={v.id}
              className={`vtab ${activeVertical === v.id ? `active-${v.id}` : ""}`}
              onClick={() => setActiveVertical(v.id)}
            >
              {v.label}
              <span className={`vtab-count vtab-count-${v.id}`}>{v.count}</span>
            </div>
          ))}
        </nav>

        {/* DFR BANNER */}
        {activeVertical === "dfr" && (
          <div className="dfr-banner">
            <span className="dfr-banner-icon">⚡</span>
            <div className="dfr-banner-text">
              <strong>Wisconsin: 100% fleet grounded</strong> — Oregon/NASAO white paper documents 467 airframes grounded across 25 states. National exposure $50M–$2B.
              &nbsp;FAA Part 108 expected mid-2026.
            </div>
            <span className="dfr-banner-link">Full Report →</span>
          </div>
        )}

        <div className="feed-layout">

          {/* SIDEBAR */}
          <aside className="feed-sidebar">
            <div className="sidebar-section">
              <div className="sidebar-label">Live Stats</div>
              <div className="sidebar-stat">
                <div className="sidebar-stat-val warn">100%</div>
                <div className="sidebar-stat-label">WI Fleet Grounded</div>
              </div>
              <div className="sidebar-stat">
                <div className="sidebar-stat-val">214+</div>
                <div className="sidebar-stat-label">BEYOND Approvals</div>
              </div>
              <div className="sidebar-stat">
                <div className="sidebar-stat-val ok">≤7 days</div>
                <div className="sidebar-stat-label">Avg Waiver Time</div>
              </div>
              <div className="sidebar-stat">
                <div className="sidebar-stat-val">10M+</div>
                <div className="sidebar-stat-label">Skydio DFR Calls</div>
              </div>
            </div>

            <div className="sidebar-section">
              <div className="sidebar-label">Category</div>
              {CATEGORIES.map(cat => (
                <div
                  key={cat.id}
                  className={`sidebar-filter ${activeFilter === cat.id ? "active" : ""}`}
                  onClick={() => setActiveFilter(cat.id)}
                >
                  <span className="sidebar-dot" style={{ background: cat.color }} />
                  {cat.label}
                  <span className="sidebar-count">
                    {cat.id === "all" ? feedCards.length : (catCounts[cat.id] || 0)}
                  </span>
                </div>
              ))}
            </div>

            <div className="sidebar-section">
              <div className="sidebar-label">Watch List</div>
              {["Wisconsin", "FAA Part 108", "BRINC Guardian", "Versaterm/Aloft", "FCC Conditional"].map(w => (
                <div key={w} className="sidebar-filter">
                  <span className="sidebar-dot" style={{ background: "#ff6b35" }} />
                  {w}
                </div>
              ))}
            </div>
          </aside>

          {/* MAIN FEED */}
          <main className="feed-main">
            <div className="feed-topbar">
              <div className="feed-title-area">
                <div>
                  <div className="feed-title">
                    <span className="feed-title-accent">DFR</span> Intel Feed
                  </div>
                  <div className="feed-subtitle">
                    {sorted.length} items · {dataLoaded ? `Live · ${lastUpdated}` : "Cached · seeding"}
                  </div>
                </div>
              </div>
              <div className="feed-controls">
                <button
                  className={`ctrl-btn ${sortOrder === "newest" ? "active" : ""}`}
                  onClick={() => setSortOrder("newest")}
                >
                  Newest
                </button>
                <button
                  className={`ctrl-btn ${sortOrder === "confidence" ? "active" : ""}`}
                  onClick={() => setSortOrder("confidence")}
                >
                  Confidence
                </button>
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="feed-empty">No items match current filter.</div>
            ) : (
              <div className="card-stack">
                {sorted.map(item => (
                  <IntelCard
                    key={item.id}
                    item={item}
                    expanded={expandedCards.has(item.id)}
                    onToggle={() => toggleCard(item.id)}
                  />
                ))}
              </div>
            )}
          </main>
        </div>

      </div>
    </>
  );
}
