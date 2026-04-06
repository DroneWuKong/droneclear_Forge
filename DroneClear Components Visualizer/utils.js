// =============================================================
// utils.js — Shared utility functions
// =============================================================

function formatTitle(text) {
    if (!text) return '';

    if (currentLang === 'fr') {
        const frMap = {
            frames: 'Châssis', motors: 'Moteurs',
            flight_controllers: 'Contrôleurs de Vol (FC)',
            escs: 'Contrôleurs de Vitesse (ESC)',
            video_transmitters: 'Émetteurs Vidéo (VTX)',
            receivers: 'Récepteurs radio', fpv_cameras: 'Caméras FPV',
            propellers: 'Hélices', batteries: 'Batteries LiPo',
            action_cameras: 'Caméras HD', antennas: 'Antennes'
        };
        if (frMap[text]) return frMap[text];
    }

    const acronyms = {
        fpv: 'FPV', aio: 'AIO', fc: 'FC', esc: 'ESC', pdb: 'PDB',
        vtx: 'VTX', dji: 'DJI', kv: 'KV', rx: 'RX', tx: 'TX',
        hd: 'HD', pid: 'PID', osd: 'OSD', led: 'LED', usb: 'USB',
        mcu: 'MCU', imu: 'IMU', bec: 'BEC', gps: 'GPS', lipo: 'LiPo',
        lihv: 'LiHV', mah: 'mAh', g: 'g', mm: 'mm', pcb: 'PCB',
        cmos: 'CMOS', tvl: 'TVL', wdr: 'WDR', cvbs: 'CVBS',
        mipi: 'MIPI', hdmi: 'HDMI', pc: 'PC', tpu: 'TPU', rf: 'RF'
    };

    return text.toString().replace(/_/g, ' ').split(' ').map(word => {
        const lower = word.toLowerCase();
        if (acronyms[lower]) return acronyms[lower];
        if (lower.endsWith('s') && acronyms[lower.slice(0, -1)]) return acronyms[lower.slice(0, -1)] + 's';
        if (word.includes('-')) {
            return word.split('-').map(p => {
                const pLower = p.toLowerCase();
                return acronyms[pLower] || (p.charAt(0).toUpperCase() + p.slice(1));
            }).join('-');
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

function parsePrice(str) {
    if (!str) return null;
    const num = parseFloat(str.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? null : num;
}

function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)'));
    return match ? match[2] : '';
}

// --- UI State Helpers ---
function showLoader() {
    elements.loader.classList.remove('hidden');
    elements.errorScreen.classList.add('hidden');
    elements.componentsGrid.classList.add('hidden');
}

function hideLoader() {
    elements.loader.classList.add('hidden');
}

function hideError() {
    elements.errorScreen.classList.add('hidden');
}

function showError(message) {
    hideLoader();
    elements.componentsGrid.classList.add('hidden');
    elements.errorMessage.textContent = message;
    elements.errorScreen.classList.remove('hidden');
}

// --- HTML Escaping ---
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- Toast Notification ---
let _toastTimer = null;
function showToast(message, type = 'info') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        document.body.appendChild(toast);
    }
    const icons = {
        success: 'ph-check-circle',
        error: 'ph-warning-circle',
        warning: 'ph-warning',
        info: 'ph-info'
    };
    toast.className = `app-toast app-toast--${type} show`;
    toast.innerHTML = `<i class="ph-fill ${icons[type] || 'ph-info'}"></i><span>${escapeHTML(message)}</span>`;

    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// =============================================================
// Currency conversion — global price display utility
// =============================================================
const _currencyRates = {
    USD: 1, EUR: 0.92, GBP: 0.79, UAH: 41.0, PLN: 4.05,
    HRK: 6.93, TRY: 36.5, ILS: 3.62, AUD: 1.55, CAD: 1.36, JPY: 150.0
};
const _currencySymbols = {
    USD: '$', EUR: '\u20AC', GBP: '\u00A3', UAH: '\u20B4', PLN: 'z\u0142',
    HRK: 'kn', TRY: '\u20BA', ILS: '\u20AA', AUD: 'A$', CAD: 'C$', JPY: '\u00A5'
};

function _getSelectedCurrency() {
    return localStorage.getItem('forge-currency') || 'USD';
}

function formatPrice(usdAmount) {
    if (!usdAmount && usdAmount !== 0) return '';
    const cur = _getSelectedCurrency();
    const rate = _currencyRates[cur] || 1;
    const sym = _currencySymbols[cur] || cur + ' ';
    const converted = usdAmount * rate;
    // JPY and UAH: no decimals. Others: 2 decimals.
    const decimals = (cur === 'JPY' || cur === 'UAH' || cur === 'HRK') ? 0 : 2;
    return sym + converted.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Init currency picker
document.addEventListener('DOMContentLoaded', () => {
    const picker = document.getElementById('currency-picker');
    if (picker) {
        picker.value = _getSelectedCurrency();
        picker.addEventListener('change', () => {
            localStorage.setItem('forge-currency', picker.value);
            // Re-render current view if components are loaded
            if (typeof renderCurrentView === 'function') renderCurrentView();
            // Re-open modal if one is active
            if (typeof activeModalComponent !== 'undefined' && activeModalComponent) {
                openModal(activeModalComponent);
            }
            showToast('Currency: ' + picker.value, 'info');
        });
    }
});
