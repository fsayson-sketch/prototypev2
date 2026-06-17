// ─── FACIAL METRICS + HISTORY ─────────────────────────────
const facialMetricHistory = [];
const earHistory = [];
const auHistory = [];
const arousalHistory = [];
const distanceHistory = [];
const MAX_METRIC_HISTORY = 30;
const MAX_HISTORY = 60;

function getSmileCategory(score) {
    if (score < 30) return 'Slight Smile';
    if (score < 55) return 'Open Smile';
    if (score < 80) return 'Intense Smile';
    return 'Grin';
}

function computeFacialMetrics(landmarks) {
    if (!landmarks || landmarks.length < 475) return null;

    const p = key => getPoint(landmarks, MP_IDX[key]);

    const leftEyeW = distance(p('left_eye_outer'), p('left_eye_inner'));
    const rightEyeW = distance(p('right_eye_outer'), p('right_eye_inner'));
    const leftEyeH = distance(p('left_eye_top'), p('left_eye_bottom'));
    const rightEyeH = distance(p('right_eye_top'), p('right_eye_bottom'));
    const mouthW = distance(p('mouth_left'), p('mouth_right'));
    const mouthH = distance(p('mouth_top'), p('mouth_bottom'));
    const faceW = distance(p('jaw_left'), p('jaw_right'));
    const faceH = distance(p('nose_tip'), p('chin'));

    if (faceW <= 0 || faceH <= 0) return null;

    // EAR — Soukupová & Čech formula
    const leftEAR = leftEyeH / Math.max(leftEyeW, 1);
    const rightEAR = rightEyeH / Math.max(rightEyeW, 1);
    const EAR = (leftEAR + rightEAR) / 2;

    const mouthOpen = mouthH / Math.max(faceH, 1);
    const lipCornerCurve = (((p('mouth_left')?.y ?? 0) + (p('mouth_right')?.y ?? 0)) / 2
        - (p('upper_lip_top')?.y ?? 0)) / Math.max(faceH, 1);
    const smileBase = (mouthW / Math.max(faceW, 1)) * 100;
    const smileScore = clamp(smileBase + (lipCornerCurve * 70) + (mouthOpen * 30), 0, 100);
    const lipStretch = clamp((mouthW / Math.max(faceW, 1)) * 120, 0, 100);
    const jawOpen = clamp(distance(p('chin'), p('lower_lip_bottom')) / Math.max(faceH, 1) * 120, 0, 100);
    const browRaise = clamp(
        ((distance(p('left_brow_peak'), p('left_eye_top')) +
            distance(p('right_brow_peak'), p('right_eye_top'))) / 2)
        / Math.max(faceH, 1) * 200, 0, 100
    );
    const browLower = clamp(
        100 - ((distance(p('left_brow_inner'), p('left_eye_top')) +
            distance(p('right_brow_inner'), p('right_eye_top'))) / 2)
        / Math.max(faceH, 1) * 250, 0, 100
    );

    // AU proxies (FACS-based)
    const au = {
        AU1: clamp(distance(p('left_brow_inner'), p('left_eye_top')) / Math.max(faceH, 1) * 300, 0, 100),
        AU2: clamp(distance(p('left_brow_outer'), p('left_eye_top')) / Math.max(faceH, 1) * 300, 0, 100),
        AU4: browLower,
        AU6: clamp(distance(p('left_cheek'), p('left_cheek2')) / Math.max(faceW, 1) * 250, 0, 100),
        AU12: clamp((mouthW / Math.max(faceW, 1)) * 150, 0, 100),
        AU17: clamp(distance(p('chin'), p('lower_lip_bottom')) / Math.max(faceH, 1) * 200, 0, 100),
        AU25: clamp(mouthOpen * 200, 0, 100)
    };

    return {
        EAR,
        isBlink: EAR < 0.21,
        isDuchenne: au.AU6 > 25 && au.AU12 > 35,
        eyeContact: clamp(EAR * 220, 0, 100),
        smileScore,
        smileCategory: getSmileCategory(smileScore),
        micro: [
            Math.round(browRaise),
            Math.round(clamp(EAR * 100, 0, 100)),
            Math.round(clamp(mouthOpen * 150, 0, 100)),
            Math.round(lipStretch),
            Math.round(jawOpen)
        ],
        au
    };
}

function appendFacialMetrics(metrics) {
    if (!metrics) return;

    facialMetricHistory.push(metrics);
    if (facialMetricHistory.length > MAX_METRIC_HISTORY) facialMetricHistory.shift();

    earHistory.push({ ear: metrics.EAR, blink: metrics.isBlink });
    if (earHistory.length > MAX_HISTORY) earHistory.shift();

    auHistory.push(metrics.au);
    if (auHistory.length > MAX_HISTORY) auHistory.shift();
}

function appendDistanceMetric(cm) {
    if (cm == null) return;
    const zone = getDistanceZone(cm);
    distanceHistory.push({ cm, zone });
    if (distanceHistory.length > MAX_HISTORY) distanceHistory.shift();
}

function clearMetricHistory() {
    facialMetricHistory.length = 0;
    earHistory.length = 0;
    auHistory.length = 0;
    arousalHistory.length = 0;
    distanceHistory.length = 0;
}

(function () {
    /* ── Emotion colour map (matches rest of app) ── */
    // const EMO_COLORS = {
    //     Happy: '#39ffb4',
    //     Sad: '#ff55aa',
    //     Fear: '#aa55ff',
    //     Angry: '#ff5555',
    //     Disgust: '#8DB600',
    //     Surprise: '#FF6B00',
    //     Neutral: '#55AAFF'
    // };
    // const EMOTION_ORDER = ['Happy', 'Neutral', 'Sad', 'Fear', 'Angry', 'Disgust', 'Surprise'];

    let metricsData = null;
    let activeModel = 'ensemble_cnn_catboost';
    let aucChart = null;
    let f1Chart = null;

    /* ── Fetch once and wire up ── */
    async function loadMetrics() {
        try {
            const res = await fetch('/model_metrics');
            metricsData = await res.json();
            renderHero();
            renderCharts();
            renderTable(activeModel);
            renderCallouts();
        } catch (e) {
            console.error('Could not load model_metrics.json:', e);
        }
    }

    /* ── Hero numbers ── */
    function pct(v) { return (v * 100).toFixed(1) + '%'; }
    function renderHero() {
        const cnn = metricsData.models.cnn_resnet50.overall;
        const ens = metricsData.models.ensemble_cnn_catboost.overall;
        const imp = metricsData.improvements;

        document.querySelector('#hero-cnn-acc .hero-value').textContent = pct(cnn.accuracy);
        document.querySelector('#hero-ens-acc .hero-value').textContent = pct(ens.accuracy);
        document.querySelector('#hero-delta-acc').textContent = `+${pct(imp.accuracy_delta)}`;

        document.querySelector('#hero-cnn-f1 .hero-value').textContent = pct(cnn.macro_f1);
        document.querySelector('#hero-ens-f1 .hero-value').textContent = pct(ens.macro_f1);
        document.querySelector('#hero-delta-f1').textContent = `+${pct(imp.f1_delta)}`;

        document.querySelector('#hero-cnn-ece .hero-value').textContent = cnn.ece.toFixed(4);
        document.querySelector('#hero-ens-ece .hero-value').textContent = ens.ece.toFixed(4);
        const eceDelta = (imp.ece_delta * 100).toFixed(1);
        document.querySelector('#hero-delta-ece').textContent = `${eceDelta}% (better)`;
        document.querySelector('#hero-delta-ece').classList.add('negative');
    }

    /* ── Charts ── */
    function renderCharts() {
        const cnn = metricsData.models.cnn_resnet50.per_class;
        const ens = metricsData.models.ensemble_cnn_catboost.per_class;

        /* Radar — AUC per emotion */
        const radarCtx = document.getElementById('auc-radar-chart').getContext('2d');
        if (aucChart) aucChart.destroy();
        aucChart = new Chart(radarCtx, {
            type: 'radar',
            data: {
                labels: EMOTION_ORDER,
                datasets: [
                    {
                        label: 'CNN',
                        data: EMOTION_ORDER.map(e => +(cnn[e].auc * 100).toFixed(2)),
                        borderColor: 'rgba(128,0,0,0.75)',
                        backgroundColor: 'rgba(128,0,0,0.08)',
                        pointBackgroundColor: 'rgba(128,0,0,0.85)',
                        borderWidth: 2
                    },
                    {
                        label: 'Ensemble',
                        data: EMOTION_ORDER.map(e => +(ens[e].auc * 100).toFixed(2)),
                        borderColor: 'rgba(255,170,0,0.9)',
                        backgroundColor: 'rgba(255,170,0,0.1)',
                        pointBackgroundColor: '#FFD700',
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    r: {
                        min: 85, max: 100,
                        ticks: { color: 'rgba(0,0,0,0.35)', font: { size: 10 }, stepSize: 5, backdropColor: 'transparent' },
                        grid: { color: 'rgba(0,0,0,0.08)' },
                        angleLines: { color: 'rgba(0,0,0,0.08)' },
                        pointLabels: { color: 'rgba(0,0,0,0.65)', font: { size: 11 } }
                    }
                },
                plugins: {
                    legend: { labels: { color: 'rgba(0,0,0,0.6)', font: { size: 11 }, boxWidth: 10 } }
                }
            }
        });

        /* Bar — F1 per emotion */
        const barCtx = document.getElementById('f1-bar-chart').getContext('2d');
        if (f1Chart) f1Chart.destroy();
        f1Chart = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: EMOTION_ORDER,
                datasets: [
                    {
                        label: 'CNN',
                        data: EMOTION_ORDER.map(e => +(cnn[e].f1 * 100).toFixed(1)),
                        backgroundColor: 'rgba(128,0,0,0.5)',
                        borderColor: 'rgba(128,0,0,0.85)',
                        borderWidth: 1,
                        borderRadius: 3
                    },
                    {
                        label: 'Ensemble',
                        data: EMOTION_ORDER.map(e => +(ens[e].f1 * 100).toFixed(1)),
                        backgroundColor: 'rgba(255,170,0,0.5)',
                        borderColor: 'rgba(255,170,0,0.9)',
                        borderWidth: 1,
                        borderRadius: 3
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: 'rgba(0,0,0,0.5)', font: { size: 10 } }, grid: { display: false } },
                    y: {
                        min: 50, max: 100,
                        ticks: { color: 'rgba(0,0,0,0.4)', font: { size: 10 }, callback: v => v + '%' },
                        grid: { color: 'rgba(0,0,0,0.06)' }
                    }
                },
                plugins: {
                    legend: { labels: { color: 'rgba(0,0,0,0.6)', font: { size: 11 }, boxWidth: 10 } },
                    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } }
                }
            }
        });
    }

    /* ── Per-class table ── */
    function renderTable(modelKey) {
        const model = metricsData.models[modelKey];
        const tbody = document.getElementById('metrics-table-body');
        tbody.innerHTML = '';

        EMOTION_ORDER.forEach(emo => {
            const d = model.per_class[emo];
            const col = emotionColors[emo] || '#fff';
            const barW = Math.round(d.f1 * 80);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <span style="display:inline-flex;align-items:center;gap:0.45rem;">
                        <span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0;"></span>
                        ${emo}
                    </span>
                </td>
                <td>${(d.precision * 100).toFixed(1)}%</td>
                <td>${(d.recall * 100).toFixed(1)}%</td>
                <td class="f1-cell">
                    <div class="f1-bar-bg">
                        <span>${(d.f1 * 100).toFixed(1)}%</span>
                        <div class="f1-bar-inline" style="width:${barW}px;background:${col};"></div>
                    </div>
                </td>
                <td>${d.support.toLocaleString()}</td>
                <td>${(d.auc * 100).toFixed(2)}%</td>
            `;
            tbody.appendChild(tr);
        });

        /* Macro-average footer row */
        const o = model.overall;
        const foot = document.createElement('tr');
        foot.style.borderTop = '2px solid rgba(255,255,255,0.12)';
        foot.innerHTML = `
            <td style="font-weight:600;color:rgba(255,255,255,0.5)">Macro avg</td>
            <td style="font-weight:600">${(o.macro_precision * 100).toFixed(1)}%</td>
            <td style="font-weight:600">${(o.macro_recall * 100).toFixed(1)}%</td>
            <td style="font-weight:600">${(o.macro_f1 * 100).toFixed(1)}%</td>
            <td style="color:rgba(255,255,255,0.4)">—</td>
            <td style="font-weight:600">${(o.auc_macro * 100).toFixed(2)}%</td>
        `;
        tbody.appendChild(foot);
    }

    /* ── Callouts ── */
    function renderCallouts() {
        const imp = metricsData.improvements;
        const ds = metricsData.dataset;
        const ens = metricsData.models.ensemble_cnn_catboost;

        const confused = ens.confusion_most_confused_pair;
        document.getElementById('callout-confused-text').textContent =
            `The model most frequently confuses ${confused[0]} and ${confused[1]}. ` +
            `These share overlapping facial muscle movements in the upper face.`;

        const ecePct = Math.abs(imp.ece_delta / metricsData.models.cnn_resnet50.overall.ece * 100).toFixed(0);
        document.getElementById('callout-ece-text').textContent =
            `Ensemble reduces calibration error (ECE) by ~${ecePct}% relative to the CNN baseline, ` +
            `meaning confidence scores are more reliable.`;

        document.getElementById('callout-dataset-text').textContent =
            `${ds.name} — ${ds.total_samples.toLocaleString()} samples, `;
    }

    /* ── Tab switching ── */
    document.querySelectorAll('.mi-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mi-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeModel = btn.dataset.model;
            if (metricsData) renderTable(activeModel);
        });
    });

    /* ── Auto-load when page becomes visible ── */
    /* Hook into your switchPage() — call loadMetrics() once on first visit */
    window._loadModelInfoMetrics = function () {
        if (!metricsData) loadMetrics();
    };

    /* Also load on DOMContentLoaded if already on this page */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('model-info-page')?.classList.contains('active')) {
                loadMetrics();
            }
        });
    }
})();