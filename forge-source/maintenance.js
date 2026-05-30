/**
 * maintenance.js — Shared maintenance panel handlers.
 * DEBT-007: Extracted from inline <script> blocks duplicated across
 * index.html, editor.html, and template.html.
 */
document.addEventListener('DOMContentLoaded', () => {
    const btnRestart = document.getElementById('btn-restart-server');
    const btnReport = document.getElementById('btn-report-bug');
    const btnResetGolden = document.getElementById('btn-reset-golden');
    const btnResetExamples = document.getElementById('btn-reset-examples');
    const bugModal = document.getElementById('bug-report-modal');
    const btnCancelBug = document.getElementById('btn-cancel-bug');
    const btnSubmitBug = document.getElementById('btn-submit-bug');
    const titleInput = document.getElementById('bug-title-input');
    const descInput = document.getElementById('bug-desc-input');

    function getCSRFToken() {
        return (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
    }

    async function maintenanceAction(btn, url, opts = {}) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Working...';
        btn.disabled = true;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken(),
                },
                ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                if (opts.onSuccess) opts.onSuccess(data);
                else if (opts.reload !== false) setTimeout(() => window.location.reload(), 800);
            } else {
                alert(opts.failMsg || ('Failed: ' + (data.error || res.statusText)));
            }
        } catch (e) {
            alert('Error connecting to backend.');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    if (btnRestart) {
        btnRestart.addEventListener('click', () => {
            maintenanceAction(btnRestart, '/api/maintenance/restart/');
        });
    }

    if (btnReport && bugModal) {
        btnReport.addEventListener('click', () => {
            bugModal.classList.remove('hidden');
            if (titleInput) { titleInput.value = ''; titleInput.focus(); }
            if (descInput) descInput.value = '';
        });
    }

    if (btnCancelBug && bugModal) {
        btnCancelBug.addEventListener('click', () => bugModal.classList.add('hidden'));
    }

    if (btnSubmitBug) {
        btnSubmitBug.addEventListener('click', () => {
            if (!titleInput?.value.trim()) { alert('Please enter a brief description.'); return; }
            maintenanceAction(btnSubmitBug, '/api/maintenance/bug-report/', {
                body: { title: titleInput.value.trim(), description: descInput?.value.trim() || '' },
                onSuccess: () => { bugModal?.classList.add('hidden'); alert('Bug report submitted.'); },
                reload: false,
            });
        });
    }

    if (btnResetGolden) {
        btnResetGolden.addEventListener('click', () => {
            if (!confirm('This will DELETE all current parts and drone models, then re-import from the golden schema file.\n\nAre you sure?')) return;
            maintenanceAction(btnResetGolden, '/api/maintenance/reset-to-golden/', {
                onSuccess: (data) => {
                    alert(`Reset complete!\n\nCreated: ${data.created?.categories || 0} categories, ${data.created?.components || 0} components, ${data.created?.drone_models || 0} drone models.`);
                    window.location.reload();
                },
            });
        });
    }

    if (btnResetExamples) {
        btnResetExamples.addEventListener('click', () => {
            if (!confirm('This will DELETE all current parts and drone models, then re-import the schema examples.\n\nAre you sure?')) return;
            maintenanceAction(btnResetExamples, '/api/maintenance/reset-to-examples/', {
                onSuccess: (data) => {
                    alert(`Reset complete!\n\nCreated: ${data.created?.categories || 0} categories, ${data.created?.components || 0} components, ${data.created?.drone_models || 0} drone models.`);
                    window.location.reload();
                },
            });
        });
    }
});
