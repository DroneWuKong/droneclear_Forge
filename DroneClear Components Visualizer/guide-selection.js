/* ═══════════════════════════════════════════════════════════
   guide-selection.js — Landing page grid + guide loading
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    cacheGuideDOMRefs();
    loadGuideSettings();
    applySettingsToUI();
    initGuidePage();
});

async function initGuidePage() {
    // Wire up mode toggle
    guideDOM['btn-mode-browse']?.addEventListener('click', () => switchMode('browse'));
    guideDOM['btn-mode-edit']?.addEventListener('click', () => switchMode('edit'));

    // Wire up settings
    guideDOM['btn-guide-settings']?.addEventListener('click', toggleSettingsPanel);
    guideDOM['btn-close-settings']?.addEventListener('click', toggleSettingsPanel);
    guideDOM['setting-photo-quality']?.addEventListener('change', onSettingChange);
    guideDOM['setting-auto-advance']?.addEventListener('change', onSettingChange);
    guideDOM['setting-safety-warnings']?.addEventListener('change', onSettingChange);

    // Load guides and show selection
    await loadGuideList();
    setGuidePhase('selection');
}

function switchMode(mode) {
    guideDOM['btn-mode-browse']?.classList.toggle('active', mode === 'browse');
    guideDOM['btn-mode-edit']?.classList.toggle('active', mode === 'edit');

    // Show/hide sidebar guide list for edit mode
    const sidebarList = guideDOM['sidebar-guide-list-panel'];
    if (sidebarList) sidebarList.style.display = mode === 'edit' ? '' : 'none';

    if (mode === 'edit') {
        setGuidePhase('editing');
        if (typeof initGuideEditor === 'function') initGuideEditor();
    } else {
        setGuidePhase('selection');
        renderGuideSelection();
    }
}

// ── Load guide list from API ─────────────────────────────
async function loadGuideList() {
    try {
        guideState.guides = await apiFetch(GUIDE_API.guides);
        renderGuideSelection();
    } catch (err) {
        console.error('Failed to load guides:', err);
        if (typeof showToast === "function") showToast("Load guides:", "error");
        guideState.guides = [];
        renderGuideSelection();
    }
}

// ── Render guide card grid ───────────────────────────────
function renderGuideSelection() {
    const grid = guideDOM['guide-grid'];
    const empty = guideDOM['guide-empty-state'];
    if (!grid) return;

    if (!guideState.guides.length) {
        grid.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
    }
    empty?.classList.add('hidden');

    grid.innerHTML = guideState.guides.map(g => `
        <div class="guide-card" data-pid="${g.pid}" tabindex="0" role="button" onclick="selectGuide('${g.pid}')">
    // POLISH-010: Keyboard accessible
            <div class="guide-card-thumb">
                ${g.thumbnail
                    ? `<img src="${g.thumbnail}" alt="${g.name}" onerror="this.parentElement.innerHTML='<i class=\\'ph ph-clipboard-text\\'></i>'">`
                    : '<i class="ph ph-clipboard-text"></i>'}
            </div>
            <div class="guide-card-body">
                <div class="guide-card-title">${escHTML(g.name)}</div>
                <div class="guide-card-desc">${escHTML(g.description || '')}</div>
                <div class="guide-card-meta">
                    <span class="difficulty-${g.difficulty}">
                        <i class="ph ph-gauge"></i> ${capitalise(g.difficulty)}
                    </span>
                    <span><i class="ph ph-clock"></i> ${g.estimated_time_minutes} min</span>
                    <span><i class="ph ph-stack"></i> ${g.step_count ?? '?'} steps</span>
                    ${g.drone_class ? `<span><i class="ph ph-drone"></i> ${escHTML(g.drone_class)}</span>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

// ── Select a guide → fetch detail → resolve components → show overview
async function selectGuide(pid) {
    try {
        guideState.selectedGuide = await apiFetch(GUIDE_API.guideDetail(pid));

        // Resolve all component PIDs to full objects before rendering
        const allPids = collectGuidePids(guideState.selectedGuide);
        if (allPids.length > 0) {
            await resolveComponents(allPids);
        }

        renderBuildOverview();
        setGuidePhase('overview');
    } catch (err) {
        console.error('Failed to load guide:', err);
        showToast('Failed to load guide details.', 'error');
    }
}

// ── Render build overview ────────────────────────────────
function renderBuildOverview() {
    const g = guideState.selectedGuide;
    if (!g) return;

    setText('overview-title', g.name);
    setText('overview-description', g.description || '');
    setHTML('overview-difficulty', `<i class="ph ph-gauge"></i> ${capitalise(g.difficulty)}`);
    if (guideDOM['overview-difficulty']) guideDOM['overview-difficulty'].className = `guide-meta-badge difficulty-${g.difficulty}`;
    setText('overview-time', `${g.estimated_time_minutes} min`);
    setText('overview-steps-count', g.steps?.length ?? 0);

    // Required tools
    const toolsList = guideDOM['overview-tools-list'];
    if (toolsList) {
        toolsList.innerHTML = (g.required_tools || []).map(t => `<li>${escHTML(t)}</li>`).join('');
        if (!g.required_tools?.length) toolsList.innerHTML = '<li style="color:var(--text-muted);">None specified</li>';
    }

    // ── Enriched component checklist ──────────────────────
    const allComponents = [];
    const stepMapping = {};  // PID → [step orders that use it]

    (g.steps || []).forEach(step => {
        (step.required_components || []).forEach(pid => {
            if (!allComponents.includes(pid)) allComponents.push(pid);
            if (!stepMapping[pid]) stepMapping[pid] = [];
            if (!stepMapping[pid].includes(step.order)) stepMapping[pid].push(step.order);
        });
    });

    // Also include drone_model parts not explicitly in steps
    // Values may be plain PID strings or arrays of {pid, quantity} objects
    if (g.drone_model?.relations) {
        Object.values(g.drone_model.relations).flat().forEach(entry => {
            const pid = typeof entry === 'string' ? entry : entry?.pid;
            if (pid && !allComponents.includes(pid)) allComponents.push(pid);
        });
    }

    guideState.checklist = {};
    const checklistEl = guideDOM['overview-checklist'];
    if (checklistEl) {
        if (!allComponents.length) {
            checklistEl.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No components listed.</p>';
        } else {
            // Group by category
            const groups = {};
            allComponents.forEach(pid => {
                const comp = guideState.resolvedComponents[pid];
                const cat = comp?.category || 'unknown';
                if (!groups[cat]) groups[cat] = [];
                groups[cat].push({ pid, comp });
            });

            let html = '';

            Object.entries(groups).forEach(([category, items]) => {
                html += `<div class="guide-checklist-group">
                    <h4 class="guide-checklist-group-title">${formatCategoryName(category)}</h4>`;

                const displayFields = g.settings?.checklist_fields?.length
                    ? g.settings.checklist_fields
                    : DEFAULT_CHECKLIST_FIELDS;
                const extras = { stepMapping };

                items.forEach(({ pid, comp }) => {
                    guideState.checklist[pid] = false;

                    if (comp) {
                        // Rich component card with configurable attribute badges
                        const imgSrc = compImageUrl(comp);
                        const manualLink = comp.manual_link
                            ? `<a href="${escHTML(comp.manual_link)}" target="_blank" class="guide-comp-action" title="Manual"><i class="ph ph-file-pdf"></i></a>`
                            : '';
                        const productLink = comp.link
                            ? `<a href="${escHTML(comp.link)}" target="_blank" class="guide-comp-action" title="Product page"><i class="ph ph-arrow-square-out"></i></a>`
                            : '';

                        // Dynamic attribute badges
                        const badges = displayFields.map(key => {
                            const fv = resolveChecklistFieldValue(key, comp, extras);
                            return fv ? `<span class="guide-checklist-attr" title="${escHTML(fv.label)}"><i class="ph ${fv.icon}"></i> ${escHTML(fv.value)}</span>` : '';
                        }).filter(Boolean).join('');

                        html += `<label class="guide-checklist-item guide-checklist-rich">
                            <input type="checkbox" data-pid="${escHTML(pid)}"
                                   onchange="toggleChecklistItem('${escHTML(pid)}', this.checked)">
                            ${imgSrc
                                ? `<img class="guide-checklist-thumb" src="${escHTML(imgSrc)}"
                                        alt="${escHTML(comp.name)}"
                                        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                   <div class="guide-checklist-thumb-placeholder" style="display:none;"><i class="ph ph-package"></i></div>`
                                : `<div class="guide-checklist-thumb-placeholder"><i class="ph ph-package"></i></div>`}
                            <div class="guide-checklist-info">
                                <span class="guide-checklist-name">${escHTML(comp.name)}</span>
                                <span class="guide-checklist-meta">${badges}</span>
                            </div>
                            <div class="guide-checklist-actions">
                                ${productLink}${manualLink}
                            </div>
                        </label>`;
                    } else {
                        // Unresolved PID fallback
                        html += `<label class="guide-checklist-item guide-checklist-unresolved">
                            <input type="checkbox" data-pid="${escHTML(pid)}"
                                   onchange="toggleChecklistItem('${escHTML(pid)}', this.checked)">
                            <span class="guide-checklist-pid-fallback">
                                <i class="ph ph-warning" style="color:var(--accent-red);"></i>
                                ${escHTML(pid)} <em style="color:var(--text-muted);">(not found in library)</em>
                            </span>
                        </label>`;
                    }
                });

                html += '</div>';
            });

            // BOM summary
            html += renderBomSummary(allComponents);

            checklistEl.innerHTML = html;
        }
    }

    // Wire overview buttons
    guideDOM['btn-back-to-selection']?.addEventListener('click', () => {
        setGuidePhase('selection');
    }, { once: true });

    guideDOM['btn-start-build']?.addEventListener('click', startBuild, { once: true });
}

/**
 * Render BOM (Bill of Materials) summary with total cost and weight.
 */
function renderBomSummary(pidList) {
    let totalCost = 0;
    let totalWeight = 0;
    let costCount = 0;
    let weightCount = 0;

    pidList.forEach(pid => {
        const comp = guideState.resolvedComponents[pid];
        if (!comp) return;

        const price = guideParsePriceNum(comp.approx_price);
        if (!isNaN(price)) { totalCost += price; costCount++; }

        const w = parseFloat(comp.schema_data?.weight_g || comp.schema_data?.weight);
        if (!isNaN(w)) { totalWeight += w; weightCount++; }
    });

    if (costCount === 0 && weightCount === 0) return '';

    return `<div class="guide-bom-summary">
        <h4 class="guide-bom-title"><i class="ph ph-receipt"></i> Bill of Materials</h4>
        <div class="guide-bom-stats">
            ${costCount > 0 ? `<div class="guide-bom-stat">
                <span class="guide-bom-label">Est. Total</span>
                <span class="guide-bom-value guide-bom-cost">$${totalCost.toFixed(2)}</span>
                <span class="guide-bom-note">${costCount} of ${pidList.length} parts priced</span>
            </div>` : ''}
            ${weightCount > 0 ? `<div class="guide-bom-stat">
                <span class="guide-bom-label">Total Weight</span>
                <span class="guide-bom-value">${totalWeight.toFixed(1)}g</span>
                <span class="guide-bom-note">${weightCount} of ${pidList.length} parts weighed</span>
            </div>` : ''}
        </div>
    </div>`;
}

function toggleChecklistItem(pid, checked) {
    guideState.checklist[pid] = checked;
}

// ── Start build → create session ─────────────────────────
async function startBuild() {
    const g = guideState.selectedGuide;
    if (!g) return;

    const builderName = guideDOM['overview-builder-name']?.value?.trim() || '';

    try {
        guideState.session = await apiFetch(GUIDE_API.sessions, {
            method: 'POST',
            body: JSON.stringify({
                guide: g.pid,
                builder_name: builderName,
                component_checklist: guideState.checklist,
            }),
        });

        guideState.currentStepIndex = 0;
        guideState.photos = {};
        guideState.stepChecklists = {};
        if (!guideState.session.step_notes) guideState.session.step_notes = {};
        setGuidePhase('running');
        renderStep(0);
        startBuildTimer();
        updateSidebarSession();
    } catch (err) {
        console.error('Failed to start build:', err);
        showToast('Failed to start build session.', 'error');
        // Re-enable button
        guideDOM['btn-start-build']?.addEventListener('click', startBuild, { once: true });
    }
}

// ── Settings ─────────────────────────────────────────────
function toggleSettingsPanel() {
    const panel = guideDOM['guide-settings-panel'];
    if (panel) panel.classList.toggle('hidden');
}

function applySettingsToUI() {
    if (guideDOM['setting-photo-quality']) guideDOM['setting-photo-quality'].value = guideSettings.photoQuality;
    if (guideDOM['setting-auto-advance']) guideDOM['setting-auto-advance'].checked = guideSettings.autoAdvance;
    if (guideDOM['setting-safety-warnings']) guideDOM['setting-safety-warnings'].checked = guideSettings.showSafetyWarnings;
}

function onSettingChange() {
    guideSettings.photoQuality = guideDOM['setting-photo-quality']?.value || 'medium';
    guideSettings.autoAdvance = guideDOM['setting-auto-advance']?.checked ?? false;
    guideSettings.showSafetyWarnings = guideDOM['setting-safety-warnings']?.checked ?? true;
    saveGuideSettings();
}

// ── Util ─────────────────────────────────────────────────
function escHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function setText(id, text) {
    const el = guideDOM[id];
    if (el) el.textContent = text;
}
function setHTML(id, html) {
    const el = guideDOM[id];
    if (el) el.innerHTML = html;
}
