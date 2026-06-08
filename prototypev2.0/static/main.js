    let sessionFrames = 0;
    let sessionAgreements = 0;
    let ensLowConf = 0;
    let cnnLowConf = 0;
    let ensEmotionCounts = {};
    let cnnEmotionCounts = {};
    let ensConfSum = 0;
    let cnnConfSum = 0;

const hamburgerBtn = document.getElementById('hamburger-btn');
const mobileNav = document.getElementById('mobile-nav');

const video = document.getElementById('video-feed-dash');
const emotionDisplay    = document.getElementById('emotion-display');
const confidenceDisplay = document.getElementById('confidence-display');
const canvasElements = {
    dashboard   : document.getElementById('video-canvas-dash'),
    comparison  : document.getElementById('video-canvas-comp')
}
let canvas = null;
let ctx = null;

let videoStream = null;

/*========== NAVIGATION ========== */
function switchPage(link) {
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.querySelectorAll('.page-section').forEach(section => section.classList.remove('active'));

    document.getElementById(link).classList.add('active');
    document.getElementById(link + '-page').classList.add('active');

    // Sync mobile nav active state
    document.querySelectorAll('.mobile-nav-list .nav-link').forEach(el => {
        el.classList.toggle('active', el.id === `mob-${link}`)
    });

    sessionFrames = 0;
    ensLowConf = 0;
    cnnLowConf = 0;
    ensEmotionCounts = {};
    cnnEmotionCounts = {};
    ensConfSum = 0;
    cnnConfSum = 0;

    // Stop inference and reset button when switching pages
    stopInference();

    document.querySelectorAll('.start-button').forEach(btn => {
        btn.textContent = link === 'comparison' ? 'Start Comparison' : 'Start Logging'
    })
    if (link === 'analysis') {
        requestAnimationFrame(() => renderChart());
        return
    }

    if (canvasElements[link]) {
        canvas = canvasElements[link];
        initCanvas();
        ctx = canvas.getContext('2d');  
    }
}

/*========== MOBILE NAV ========== */
function closeMobileNav() {
    mobileNav.classList.remove('open');
    hamburgerBtn.classList.remove('open');
    hamburgerBtn.setAttribute('aria-expanded', false);
}

hamburgerBtn.addEventListener('click', ()=> {
    const isOpen = mobileNav.classList.toggle('open');
    hamburgerBtn.classList.toggle('open', isOpen);
    hamburgerBtn.setAttribute('aria-expanded', isOpen);
});

document.addEventListener('click', (e)=> {
    if (!hamburgerBtn.contains(e.target) && !mobileNav.contains(e.target)) {
        closeMobileNav();
    }
})

/*========== CONFIG ========== */
const CONFIG = {
    inferenceInterval   : 250, //  between frames sent to server
    minConfidence       : .50,
    streamWidth         : 640,
    streamHeight        : 480,
    captureWidth        : 320,  //  downscaled before sending
    captureHeight       : 240,
    jpegQuality         : .6
};

/*========== CANVAS / CAMERA ========== */
function initCanvas() {
    if (!videoStream) return;
    // canvas dimensions should match stream dimensions
    canvas.width = videoStream.getVideoTracks()[0].getSettings().width || CONFIG.streamWidth;
    canvas.height = videoStream.getVideoTracks()[0].getSettings().height || CONFIG.streamHeight;
}

function drawLoop() {
    // Draw the raw onto the current active canvas when idle, or let the handler override it
    if (canvas && ctx && video.readyState >= 2) {
        drawFrame(
            video, ctx, canvas,
            lastResult?.bbox || null,
            lastResult ? (emotionColors[lastResult.label] || '#ffffff') : null,
            lastResult?.landmarks || null
        );
    }
    requestAnimationFrame(drawLoop);
}

async function initCamera() {
    try {
        // Requests the stream only once
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width       : { ideal: CONFIG.streamWidth },
                height      : { ideal: CONFIG.streamHeight },
                frameRate   : { ideal: 30, max: 30 }
            }
        });
        
        // Set stream to the video element for frame capture
        videoStream = stream;
        video.srcObject = stream;

        video.onloadedmetadata = () => {
            initCanvas();
            drawLoop();
        }

    } catch (err) {
        alert('Camera error: ' + err.message);
    }
}

/*========== INFERENCE ========== */
let isRunning       = false;
let inferenceTimer  = null;
let lastResult      = null;
let inferenceInFlight = false;  // guard: blocks overlapping requests
let placeholderRemoved = false;

// Tracks which page is active so sendFrame knows what mode to request
// 'dashboard'  = ensemble only     (compare: false)
// 'comparison' = ensemble + cnn    (compare: true)
let activePage = 'dashboard';

//  Off-screen canvas used only for downscaling before capture
const captureCanvas = document.createElement('canvas');
captureCanvas.width = CONFIG.captureWidth;
captureCanvas.height = CONFIG.captureHeight;
const captureCtx = captureCanvas.getContext('2d');

const logList = document.getElementById('log-list');
const dashboardMetrics = { count: 0, sum: 0 };


const emotionColors = {
    Happy       : '#39ffb4', 
    Sad         : '#ff55aa', 
    Fear        : '#aa55ff',
    Angry       : '#ff5555', 
    Disgust     : '#8DB600', 
    Surprise    : '#FF6B00', 
    Neutral     : '#55AAFF'
};

const EMOTION_ORDER = ['Happy', 'Neutral', 'Sad', 'Fear', 'Angry', 'Disgust', 'Surprise']

function renderEmotionBars(containerId, probs) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!probs) {
        // Only show "No data" if skeletons are already gone
        const hasSkeleton = container.querySelector('.comp-skeleton-bars');
        if (!hasSkeleton) {
            container.innerHTML = '<span class="emotion-bars-placeholder">No data</span>';
        }
        return;
    }

    // Clear skeleton bars when real data arrives
    const skel = container.querySelector('.comp-skeleton-bars');
    if (skel) skel.remove();

    // Clear metric skeletons on first real render
    const metricSkels = document.querySelectorAll('.metric-skel');
    metricSkels.forEach(el => el.remove());

    container.innerHTML = EMOTION_ORDER.map(emotion => {
        const val = probs[emotion] ?? 0;
        const pct = (val * 100).toFixed(1);
        const color = emotionColors[emotion] || '#aaa';
        return `
            <div class="emotion-bar-row">
                <span class="emotion-bar-label">${emotion}</span>
                <div class="emotion-bar-track">
                    <div class="emotion-bar-fill" style="width:${pct}%;background:${color}"></div>
                </div>
                <span class="emotion-bar-pct">${pct}%</span>
            </div>`;
    }).join('');
}



async function sendFrame() {
    if (inferenceInFlight) return;
    if (!isRunning || !videoStream || video.readyState < 2) return;

    inferenceInFlight = true;

    // Downscale frame to capture resolution before sending
    captureCtx.drawImage(video, 0, 0, CONFIG.captureWidth, CONFIG.captureHeight);
    const base64Frame = captureCanvas.toDataURL('image/jpeg', CONFIG.jpegQuality);

    const isCompare = activePage === 'comparison';
    const t0 = performance.now();   // Timestamp for measuring round-trip inference time

    try {
        const response = await fetch('/predict', {
            method  : 'POST',
            headers : { 'Content-Type': 'application/json'},
            body    : JSON.stringify({
                frame   : base64Frame,
                compare : isCompare
            }) 
        });

        const inferenceMs = (performance.now() - t0).toFixed(0);
        const result      = await response.json();

        handleResult(result, inferenceMs, isCompare);
    } catch (err) {
        console.error('Inference error:', err);
    } finally {
        inferenceInFlight = false;
    }
}

/*========== RESULT HANDLERS ========== */
function handleResult(result, inferenceMs, isCompare) {
    if (isCompare) {
        handleComparisonResult(result, inferenceMs);
    } else {
        handleDashboardResult(result, inferenceMs);
    }
}

// Dashboard: ensemble prediction only
function handleDashboardResult(result, inferenceMs) {
    if (result.label === 'No Face' || result.label === 'Error') {
        lastResult = null;
        emotionDisplay.textContent      = '--';
        confidenceDisplay.textContent   = 'No face detected';
        return;
    }

    lastResult = result;

    emotionDisplay.textContent = result.label;
    confidenceDisplay.textContent = 
        (result.confidence * 100).toFixed(1) + '%';

    renderEmotionBars('dash-bars-list', result.probs || null);
    
    const metrics = computeFacialMetrics(result.landmarks);
    appendFacialMetrics(metrics);

    // Append to session log every prediction
    appendSessionLog(result.label, result.confidence, inferenceMs);
    collectCandidate();

    if (metrics) {
        document.getElementById('eye-contact-time').textContent = `${Math.round(metrics.eyeContact)}%`;
        document.getElementById('smile-count').textContent = `${Math.round(metrics.smileScore)}`;
        document.getElementById('microexp-count').textContent = metrics.micro.reduce((sum, value) => sum + value, 0).toFixed(0);
    }

    dashboardMetrics.count += 1;
    dashboardMetrics.sum += result.confidence;
    const avgConfidence = (dashboardMetrics.sum / dashboardMetrics.count) * 100;
    const avgConfidenceEl = document.getElementById('dashboard-avg-confidence');
    if (avgConfidenceEl) avgConfidenceEl.textContent = `${avgConfidence.toFixed(1)}%`;
    const latencyEl = document.getElementById('dashboard-latency');
    if (latencyEl) latencyEl.textContent = `${inferenceMs} ms`;
    const countEl = document.getElementById('dashboard-capture-count');
    if (countEl) countEl.textContent = `${dashboardMetrics.count}`;
    const topEmotionEl = document.getElementById('dashboard-top-emotion');
    if (topEmotionEl) topEmotionEl.textContent = result.label;

    if (activePage === 'analysis') {
        requestAnimationFrame(renderChart);
    }
}

// Session log: one row per prediction, newest on top
const MAX_LOG_ENTRIES = 100; // cap so the list never grows unbounded

class Log {
    constructor(data, next = null) {
        this.data = data;
        this.next = next;
    }
}

class SessionLog {
    constructor() {
        this.head = null;
        this.size = 0;
    }

    prepend(data) {
        this.head = new Log(data, this.head);
        this.size++;
    }
}

const sessionLog = new SessionLog();
const facialMetricHistory = [];
const MAX_METRIC_HISTORY = 30;

function appendSessionLog(label, confidence, inferenceMs) {
    if (!logList) return;

    // Remove the static placeholder on the very first real entry
    if (!placeholderRemoved) {
        const placeholder = logList.querySelector('[data-placeholder]');
        if (placeholder) placeholder.remove();
        placeholderRemoved = true;
    }

    // Timestamp e.g. "14:23:07"
    const time = new Date().toLocaleTimeString([], {
        hour    : '2-digit',
        minute  : '2-digit',
        second  : '2-digit'
    });

    const entry = document.createElement('div');
    entry.className = 'session-log-list-item';
    entry.style.borderLeftColor = emotionColors[label];
    entry.style.background = 'rgba(255, 255, 255, 0.03)'
    entry.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-emotion" style="color:${emotionColors[label] || '#ffffff'}">${label}</span>
        <span class="log-confidence">${(confidence * 100).toFixed(1)}%</span>
        <span class="log-inference">${inferenceMs} ms</span>
    `;

    // Newest entry at the top
    logList.insertBefore(entry, logList.firstChild);
    sessionLog.prepend({ timestamp: time, label: label, confidence });

    // Trim oldest entries beyond the cap
    while (logList.children.length > MAX_LOG_ENTRIES) {
        logList.removeChild(logList.lastChild);
    }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getPoint(landmarks, index) {
    if (!landmarks || index < 0 || index >= landmarks.length) return null;
    const point = landmarks[index];
    return Array.isArray(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y };
}

function distance(a, b) {
    if (!a || !b) return 0;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function getSmileCategory(score) {
    if (score < 30) return 'Slight Smile';
    if (score < 55) return 'Open Smile';
    if (score < 80) return 'Intense Smile';
    return 'Grin';
}

function computeFacialMetrics(landmarks) {
    if (!landmarks || landmarks.length < 475) return null;

    const MP_IDX = {
        left_eye_outer: 33,
        left_eye_inner: 133,
        left_eye_top: 159,
        left_eye_bottom: 145,
        right_eye_inner: 362,
        right_eye_outer: 263,
        right_eye_top: 386,
        right_eye_bottom: 374,
        left_brow_peak: 70,
        right_brow_peak: 299,
        mouth_left: 61,
        mouth_right: 291,
        mouth_top: 0,
        mouth_bottom: 17,
        nose_tip: 1,
        chin: 152,
        lower_lip_bottom: 16,
        upper_lip_top: 267,
        jaw_left: 234,
        jaw_right: 454
    };

    const p = key => getPoint(landmarks, MP_IDX[key]);
    const leftEyeW = distance(p('left_eye_outer'), p('left_eye_inner'));
    const rightEyeW = distance(p('right_eye_outer'), p('right_eye_inner'));
    const leftEyeH = distance(p('left_eye_top'), p('left_eye_bottom'));
    const rightEyeH = distance(p('right_eye_top'), p('right_eye_bottom'));
    const mouthW = distance(p('mouth_left'), p('mouth_right'));
    const mouthH = distance(p('mouth_top'), p('mouth_bottom'));
    const faceWidth = distance(p('jaw_left'), p('jaw_right'));
    const faceHeight = distance(p('nose_tip'), p('chin'));

    if (faceWidth <= 0 || faceHeight <= 0) return null;

    const eyeOpenness = ((leftEyeH / Math.max(leftEyeW, 1)) + (rightEyeH / Math.max(rightEyeW, 1))) / 2;
    const noseToLip = distance(p('nose_tip'), p('upper_lip_top'));
    const lipCornerCurve = (((p('mouth_left')?.y ?? 0) + (p('mouth_right')?.y ?? 0)) / 2 - (p('upper_lip_top')?.y ?? 0)) / Math.max(faceHeight, 1);
    const mouthOpen = mouthH / Math.max(faceHeight, 1);
    const smileBase = (mouthW / Math.max(faceWidth, 1)) * 100;
    const smileScore = clamp(smileBase + (lipCornerCurve * 70) + (mouthOpen * 30), 0, 100);
    const browRaise = clamp(((distance(p('left_brow_peak'), p('left_eye_top')) + distance(p('right_brow_peak'), p('right_eye_top'))) / 2) / Math.max(faceHeight, 1) * 200, 0, 100);
    const jawOpenness = clamp(distance(p('chin'), p('lower_lip_bottom')) / Math.max(faceHeight, 1) * 120, 0, 100);
    const lipStretch = clamp((mouthW / Math.max(faceWidth, 1)) * 120, 0, 100);
    const eyeContactPercent = clamp(eyeOpenness * 220, 0, 100);

    return {
        eyeContact: eyeContactPercent,
        smileScore,
        smileCategory: getSmileCategory(smileScore),
        micro: [
            Math.round(browRaise),
            Math.round(clamp(eyeOpenness * 100, 0, 100)),
            Math.round(clamp(mouthOpen * 150, 0, 100)),
            Math.round(lipStretch),
            Math.round(jawOpenness)
        ]
    };
}

function appendFacialMetrics(metrics) {
    if (!metrics) return;
    facialMetricHistory.push(metrics);
    if (facialMetricHistory.length > MAX_METRIC_HISTORY) {
        facialMetricHistory.shift();
    }
}



// Comparison: ensemble vs CNN baseline, with inference time
function handleComparisonResult(result, inferenceMs) {
    const ensemble = result.ensemble;
    const cnn = result.cnn_only;

    lastResult = (ensemble && ensemble.label !== 'No Face' && ensemble.label !== 'Error') ? ensemble : null;

    // Labels and confidence readouts
    const ensLabelEl = document.getElementById('comp-ens-label');
    const ensConfDisplayEl = document.getElementById('comp-ens-confidence');
    const cnnLabelEl = document.getElementById('comp-cnn-label');
    const cnnConfDisplayEl = document.getElementById('comp-cnn-confidence');

    if (ensLabelEl) ensLabelEl.textContent = ensemble?.label ?? '--';
    if (ensConfDisplayEl) ensConfDisplayEl.textContent = ensemble ? `${(ensemble.confidence * 100).toFixed(1)}% | ${inferenceMs} ms` : '0.0% | -- ms';
    if (cnnLabelEl) cnnLabelEl.textContent = cnn?.label ?? '--';
    if (cnnConfDisplayEl) cnnConfDisplayEl.textContent = cnn ? `${(cnn.confidence * 100).toFixed(1)}% | ${inferenceMs} ms` : '0.0% | -- ms';

    renderEmotionBars('ensemble-bars-list', ensemble?.probs || null);
    renderEmotionBars('cnn-bars-list', cnn?.probs || null)

    // Track session metrics
    if (ensemble?.confidence !== undefined && cnn?.confidence !== undefined) {
        sessionFrames++;
        ensConfSum += ensemble.confidence;
        cnnConfSum += cnn.confidence;

        if (ensemble.confidence < 0.5) ensLowConf++;
        if (cnn.confidence < 0.5) cnnLowConf++;

        if (ensemble.label && ensemble.label !== 'No Face' && ensemble.label !== 'Error') {
            ensEmotionCounts[ensemble.label] = (ensEmotionCounts[ensemble.label] || 0) + 1;
        }
        if (cnn.label && cnn.label !== 'No Face' && cnn.label !== 'Error') {
            cnnEmotionCounts[cnn.label] = (cnnEmotionCounts[cnn.label] || 0) + 1;
        }
    }

    const safePct = (val) => val !== undefined ? `${(val * 100).toFixed(1)}%` : '--';
    const getDom = (counts) => {
        if (Object.keys(counts).length === 0) return '--';
        const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return `${dom[0]} (${((dom[1] / sessionFrames) * 100).toFixed(1)}%)`;
    };

    // CNN metric elements
    const cnnConfEl = document.getElementById('comp-cnn-conf');
    const cnnAvgEl  = document.getElementById('comp-cnn-avg-conf');
    const cnnLowEl  = document.getElementById('comp-cnn-low');
    const cnnDomEl  = document.getElementById('comp-cnn-dominant');
    if (cnnConfEl) cnnConfEl.textContent = safePct(cnn?.confidence);
    if (cnnAvgEl && sessionFrames > 0) cnnAvgEl.textContent = safePct(cnnConfSum / sessionFrames);
    if (cnnLowEl) cnnLowEl.textContent = cnnLowConf;
    if (cnnDomEl) cnnDomEl.textContent = getDom(cnnEmotionCounts);

    // Ensemble metric elements
    const ensConfEl = document.getElementById('comp-ensemble-conf');
    const ensAvgEl  = document.getElementById('comp-ens-avg-conf');
    const ensLowEl  = document.getElementById('comp-ens-low');
    const ensDomEl  = document.getElementById('comp-ens-dominant');
    if (ensConfEl) ensConfEl.textContent = safePct(ensemble?.confidence);
    if (ensAvgEl && sessionFrames > 0) ensAvgEl.textContent = safePct(ensConfSum / sessionFrames);
    if (ensLowEl) ensLowEl.textContent = ensLowConf;
    if (ensDomEl) ensDomEl.textContent = getDom(ensEmotionCounts);
}

/*========== DRAW ========== */
function drawFrame(video, context, canvas, bbox = null, colorHex = null, landmarks = null) {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / CONFIG.captureWidth;
    const scaleY = canvas.height / CONFIG.captureHeight;

    if (bbox && bbox.length === 4) {
        const [x, y, w, h] = bbox;
        context.strokeStyle = colorHex;
        context.lineWidth = 4;
        context.strokeRect(x * scaleX, y * scaleY, w * scaleX, h * scaleY);
    }

    context.globalAlpha = 0.6

    if (landmarks && landmarks.length) {
        context.fillStyle = colorHex;
        for (const [x, y] of landmarks) {
            context.beginPath();
            context.arc(x * scaleX, y * scaleY, 1.5, 0, 2 * Math.PI);
            context.fill();
        }
    }

    context.globalAlpha = 1.0
}

/*========== START / STOP ========== */
// Inside your start button click handler

function startInference() {
    if (isRunning) return;
    isRunning = true;

    sessionFrames = 0;       // was: ssessionFrames = 0
    ensLowConf = 0;
    cnnLowConf = 0;
    ensEmotionCounts = {};
    cnnEmotionCounts = {};
    ensConfSum = 0;
    cnnConfSum = 0;

    inferenceTimer = setInterval(sendFrame, CONFIG.inferenceInterval);
    captureTimer   = setInterval(captureFrame, captureIntervalMs);

    setTimeout(() => captureFrame(), 3000);
}

function stopInference() {
    isRunning           = false;
    inferenceInFlight   = false;
    clearInterval(inferenceTimer);
    clearInterval(captureTimer);
    lastResult = null;
}

/*========== CHART ========== */
let emotionChartInstance = null;
let eyeContactChartInstance = null;
let smileChartInstance = null;
let microExpChartInstance = null;
let timelineChartInstance = null;

function toggleSkeletonLoaders(show) {
    const skeletons = [
        'emotion-skeleton',
        'eyecontact-skeleton',
        'smile-skeleton',
        'microexp-skeleton',
        'timeline-skeleton'
    ];
    
    skeletons.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            if (show) {
                element.classList.add('visible');
            } else {
                element.classList.remove('visible');
            }
        }
    });
}

function renderChart() {
    // Show skeletons when no data
    if (sessionLog.size === 0) {
        if (emotionChartInstance) emotionChartInstance.destroy();
        if (eyeContactChartInstance) eyeContactChartInstance.destroy();
        if (smileChartInstance) smileChartInstance.destroy();
        if (microExpChartInstance) microExpChartInstance.destroy();
        if (timelineChartInstance) timelineChartInstance.destroy();
        
        toggleSkeletonLoaders(true);
        return;
    }
    
    toggleSkeletonLoaders(false);

    // 1. Aggregate Emotion Data
    const counts = {};
    let current = sessionLog.head;
    while (current) {
        const emo = current.data['label'];
        counts[emo] = (counts[emo] || 0) + 1;
        current = current.next;
    }

    const totalCount = sessionLog.size;
    const labels = Object.keys(counts);
    const rawData = Object.values(counts);

    // 2. Calculate percentages
    const percentages = rawData.map(count => ((count / totalCount) * 100).toFixed(1));
    const bgColors = labels.map(l => emotionColors[l] || '#cccccc');

    // 3. Destroy old charts if they exist
    if (emotionChartInstance) emotionChartInstance.destroy();
    if (eyeContactChartInstance) eyeContactChartInstance.destroy();
    if (smileChartInstance) smileChartInstance.destroy();
    if (microExpChartInstance) microExpChartInstance.destroy();
    if (timelineChartInstance) timelineChartInstance.destroy();

    // 4. Create Emotion Distribution Chart
    const ctxChart = document.getElementById('emotionChart').getContext('2d');
    emotionChartInstance = new Chart(ctxChart, {
        type: 'doughnut',
        data: {
            labels: labels.map(l => l.toUpperCase()),
            datasets: [{
                data: rawData,
                backgroundColor: bgColors,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    bottom: 8
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { 
                        color: 'white',
                        padding: 12,
                        boxWidth: 10,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            const value = context.parsed;
                            const percentage = percentages[context.dataIndex];
                            return `${label} ${percentage}% (${value} total)`;
                        }
                    }
                }
            }
        }
    });

    // 5. Create Eye Contact Tracking Chart
    const eyeContactData = facialMetricHistory.length
        ? facialMetricHistory.map(metric => metric.eyeContact)
        : generateMockEyeContactData(totalCount);
    const eyeContactLabels = facialMetricHistory.length
        ? facialMetricHistory.map((_, idx) => `#${idx + 1}`)
        : Array.from({ length: 10 }, (_, i) => `${i * 10}%`);
    const ctxEyeContact = document.getElementById('eyeContactChart').getContext('2d');
    eyeContactChartInstance = new Chart(ctxEyeContact, {
        type: 'line',
        data: {
            labels: eyeContactLabels,
            datasets: [{
                label: 'Eye Contact Level',
                data: eyeContactData,
                borderColor: '#39ffb4',
                backgroundColor: 'rgba(57, 255, 180, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: 'rgba(57, 255, 180, 0.8)',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 10 } },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 10 } },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        }
    });
    document.getElementById('eye-contact-time').textContent = `${eyeContactData[eyeContactData.length - 1].toFixed(0)}%`;

    // 6. Create Smile Detection Chart
    const smileLabels = ['Slight Smile', 'Open Smile', 'Intense Smile', 'Grin'];
    const smileData = facialMetricHistory.length
        ? smileLabels.map(label => facialMetricHistory.filter(metric => metric.smileCategory === label).length)
        : generateMockSmileData(totalCount);
    const ctxSmile = document.getElementById('smileChart').getContext('2d');
    smileChartInstance = new Chart(ctxSmile, {
        type: 'bar',
        data: {
            labels: smileLabels,
            datasets: [{
                label: 'Smile Instances',
                data: smileData,
                backgroundColor: ['rgba(255, 183, 77, 0.8)', 'rgba(255, 138, 128, 0.8)', 'rgba(229, 127, 185, 0.8)', 'rgba(179, 157, 219, 0.8)'],
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 10 } },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 10 } },
                    grid: { display: false }
                }
            }
        }
    });
    document.getElementById('smile-count').textContent = smileData.reduce((a, b) => a + b, 0);

    // 7. Create Micro-Expressions Chart
    const microExpData = facialMetricHistory.length
        ? facialMetricHistory[facialMetricHistory.length - 1].micro
        : generateMockMicroExpressions(totalCount);
    const ctxMicroExp = document.getElementById('microExpChart').getContext('2d');
    microExpChartInstance = new Chart(ctxMicroExp, {
        type: 'radar',
        data: {
            labels: ['Brow Raise', 'Eye Openness', 'Mouth Openness', 'Lip Stretch', 'Jaw Openness'],
            datasets: [{
                label: 'Micro-Expression Metrics',
                data: microExpData,
                borderColor: '#FFD700',
                backgroundColor: 'rgba(255, 215, 0, 0.2)',
                borderWidth: 2,
                pointBackgroundColor: '#FFD700',
                pointBorderColor: '#fff',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 9 } },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        }
    });
    document.getElementById('microexp-count').textContent = microExpData.reduce((a, b) => a + b, 0).toFixed(0);

    // 8. Create Expression Timeline Chart (Chronological emotions over session)
    const timelineData = generateTimelineData(totalCount, counts);
    const ctxTimeline = document.getElementById('timelineChart').getContext('2d');
    timelineChartInstance = new Chart(ctxTimeline, {
        type: 'bar',
        data: {
            labels: Object.keys(counts).map(l => l.toUpperCase()),
            datasets: [{
                label: 'Emotion Count',
                data: Object.values(counts),
                backgroundColor: Object.keys(counts).map(l => emotionColors[l] || '#cccccc'),
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top' }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 10 } },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 10 } },
                    grid: { display: false }
                }
            }
        }
    });
    document.getElementById('session-duration').textContent = (totalCount * 0.25).toFixed(0) + 's';
}

// Mock data generators
function generateTimelineData(sessionSize, emotionCounts) {
    // This just validates the emotion counts structure
    return emotionCounts;
}
function generateMockEyeContactData(sessionSize) {
    const baseValue = 65 + (sessionSize % 25);
    return Array.from({length: 10}, (_, i) => {
        const variance = (Math.sin(i * 0.5) * 15) + (Math.random() * 10 - 5);
        return Math.max(20, Math.min(100, baseValue + variance));
    });
}

function generateMockSmileData(sessionSize) {
    const factor = Math.min(1, sessionSize / 100);
    return [
        Math.floor(10 + (sessionSize * factor * 0.3)),
        Math.floor(5 + (sessionSize * factor * 0.2)),
        Math.floor(2 + (sessionSize * factor * 0.1)),
        Math.floor(1 + (sessionSize * factor * 0.05))
    ];
}

function generateMockMicroExpressions(sessionSize) {
    const factor = Math.min(1, sessionSize / 150);
    return [
        Math.floor(20 + (Math.random() * 30) * factor),
        Math.floor(15 + (Math.random() * 25) * factor),
        Math.floor(10 + (Math.random() * 20) * factor),
        Math.floor(8 + (Math.random() * 15) * factor),
        Math.floor(12 + (Math.random() * 22) * factor)
    ];
}

/*========== FRAME CAPTURES ========== */
let captureIntervalMs   = 5 * 60 * 1000;
let captureTimer        = null;
let captureBuffer       = [];           // rolling buffer of recent captures
let candidateBuffer     = [];           // rolling candidates collected during interval
const MAX_CAPTURES      = 7;
const MIN_CONFIDENCE    = 0.55;         // only candidates above this threshold

function updateCaptureInterval(minutes) {
    captureIntervalMs = parseInt(minutes) * 60 * 1000;
    if (isRunning) {
        clearInterval(captureTimer);
        captureTimer = setInterval(captureFrame, captureIntervalMs);
    }
}

// Called every inference frame — collects candidates silently
function collectCandidate() {
    if (!isRunning || !lastResult || !videoStream) return;
    if (video.readyState < 2) return;
    if (lastResult.label === 'No Face' || lastResult.label === 'Error') return;
    if (lastResult.confidence < MIN_CONFIDENCE) return;

    // Draw current frame
    const snap    = document.createElement('canvas');
    snap.width    = CONFIG.captureWidth;
    snap.height   = CONFIG.captureHeight;
    const snapCtx = snap.getContext('2d');
    snapCtx.drawImage(video, 0, 0, snap.width, snap.height);

    // Crop face bbox with padding
    let dataUrl;
    if (lastResult.bbox && lastResult.bbox.length === 4) {
        const [bx, by, bw, bh] = lastResult.bbox;

        const padX = Math.round(0.5 * bw);  // horizontal padding
        const padY = Math.round(0.6 * bh); // vertical padding

        const cx  = Math.max(0, bx - padX);
        const cy  = Math.max(0, by - padY);
        const cw  = Math.min(bw + 2 * padX, snap.width  - cx);
        const ch  = Math.min(bh + 2 * padY, snap.height - cy);

        const crop    = document.createElement('canvas');
        crop.width    = cw;
        crop.height   = ch;
        crop.getContext('2d').drawImage(snap, cx, cy, cw, ch, 0, 0, cw, ch);
        dataUrl = crop.toDataURL('image/jpeg', 0.8);
    } else {
        dataUrl = snap.toDataURL('image/jpeg', 0.8);
    }

    candidateBuffer.push({
        dataUrl,
        label      : lastResult.label,
        confidence : lastResult.confidence,
        time       : new Date().toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }),
        color: emotionColors[lastResult.label] || '#ffffff'
    });
}

// Called every interval — picks top 5 unique from candidates
function captureFrame() {
    if (candidateBuffer.length === 0) return;

    // Pick best (highest confidence) per unique emotion label
    const bestPerEmotion = {};
    candidateBuffer.forEach(entry => {
        if (!bestPerEmotion[entry.label] ||
            entry.confidence > bestPerEmotion[entry.label].confidence) {
            bestPerEmotion[entry.label] = entry;
        }
    });

    // Sort by confidence descending, take top MAX_CAPTURES
    const top5 = Object.values(bestPerEmotion)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_CAPTURES);

    captureBuffer = top5;
    candidateBuffer = [];   // reset for next interval
    renderCaptures();
}

function renderCaptures() {
    const grid  = document.getElementById('captures-grid');
    const empty = document.getElementById('captures-empty');
    const skeletons = document.getElementById('capture-placeholders');
    if (!grid) return;

    // Remove existing capture cards and placeholders
    grid.querySelectorAll('.capture-card, .capture-skeleton').forEach(el => el.remove());

    if (captureBuffer.length === 0) {
        if (empty) empty.style.display = 'flex';
        if (skeletons) {
            skeletons.style.display = 'contents';
            grid.appendChild(skeletons);
        }
        return;
    }

    if (empty) empty.style.display = 'none';
    if (skeletons) skeletons.style.display = 'none';

    captureBuffer.forEach(entry => {
        const card = document.createElement('div');
        card.className = 'capture-card';
        card.style.borderColor = entry.color + '55'; // subtle tint

        card.innerHTML = `
            <img src="${entry.dataUrl}" alt="${entry.label}" />
            <span class="capture-card__label" style="color:${entry.color}">
                ${entry.label}
            </span>
            <span class="capture-card__confidence">
                ${(entry.confidence * 100).toFixed(1)}%
            </span>
            <span class="capture-card__time">${entry.time}</span>
        `;
        grid.appendChild(card);
    });

    const placeholderCount = Math.max(0, MAX_CAPTURES - captureBuffer.length);
    for (let i = 0; i < placeholderCount; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'capture-skeleton';
        grid.appendChild(placeholder);
    }
}

/*========== EXPORT ========== */
function exportData(type) {
    if (sessionLog.size === 0) {
        alert("No data collected yet! Go to Dashboard and start logging.");
        return;
    }

    if (type === 'csv') {
        // Raw CSV
        let content = "Timestamp,Emotion,Confidence\n";
        let current = sessionLog.head;
        while (current) {
            content += `${current.data.timestamp},${current.data.label},${(current.data.confidence * 100).toFixed(2)}%\n`;
            current = current.next;
        }
        downloadFile(content, 'emotion_log.csv');

    } else if (type === 'psych') {
        // Clinical log — structured, meaningful
        const now       = new Date();
        const dateStr   = now.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr   = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Aggregate stats
        const counts    = {};
        const confByEmo = {};
        let current     = sessionLog.head;
        let totalConf   = 0;

        while (current) {
            const { label, confidence } = current.data;
            counts[label]    = (counts[label] || 0) + 1;
            confByEmo[label] = (confByEmo[label] || []);
            confByEmo[label].push(confidence);
            totalConf += confidence;
            current = current.next;
        }

        const total       = sessionLog.size;
        const avgConf     = (totalConf / total * 100).toFixed(1);
        const dominant    = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const dominantPct = (dominant[1] / total * 100).toFixed(1);

        // Build report
        let content = '';
        content += `CLINICAL FACIAL EXPRESSION ANALYSIS REPORT\n`;
        content += `${'='.repeat(50)}\n\n`;
        content += `Date:              ${dateStr}\n`;
        content += `Time:              ${timeStr}\n`;
        content += `Total Observations: ${total}\n`;
        content += `Avg Confidence:    ${avgConf}%\n\n`;

        content += `SESSION SUMMARY\n`;
        content += `${'-'.repeat(50)}\n`;
        content += `Dominant Emotion:  ${dominant[0]} (${dominantPct}% of session)\n\n`;

        content += `EMOTION BREAKDOWN\n`;
        content += `${'-'.repeat(50)}\n`;
        content += `Emotion,Count,Percentage,Avg Confidence\n`;

        Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([emotion, count]) => {
                const pct     = (count / total * 100).toFixed(1);
                const avgC    = (confByEmo[emotion].reduce((a, b) => a + b, 0) / confByEmo[emotion].length * 100).toFixed(1);
                content += `${emotion},${count},${pct}%,${avgC}%\n`;
            });

        content += `\nDETAILED OBSERVATION LOG\n`;
        content += `${'-'.repeat(50)}\n`;
        content += `Timestamp,Emotion,Confidence\n`;

        current = sessionLog.head;
        while (current) {
            content += `${current.data.timestamp},${current.data.label},${(current.data.confidence * 100).toFixed(2)}%\n`;
            current = current.next;
        }

        content += `\n${'='.repeat(50)}\n`;
        content += `Generated by Ensemble CNN-CatBoost FER System\n`;
        content += `For professional use only\n`;

        downloadFile(content, 'clinical_data_log.txt');

    } else if (type === 'pdf') {
        // PDF Report with graphs
        exportPDF();
    }
}

// Helper to avoid repeating blob/download logic
function downloadFile(content, filename) {
    const blob = new Blob(["\ufeff" + content], { type: 'text/plain;charset=utf-8;' });
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    alert(`Exported successfully as ${filename}!`);
}

// Helper function to capture a chart image for PDF export without mutating the live chart
function getChartImageForPDF(chartInstance) {
    if (!chartInstance) return null;

    // Create a hidden temporary canvas for export rendering
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = chartInstance.canvas.width;
    tempCanvas.height = chartInstance.canvas.height;
    tempCanvas.style.position = 'absolute';
    tempCanvas.style.left = '-9999px';
    tempCanvas.style.top = '-9999px';
    document.body.appendChild(tempCanvas);

    const tempCtx = tempCanvas.getContext('2d');

    // Clone chart data and options for export
    const exportData = JSON.parse(JSON.stringify(chartInstance.data));
    const exportOptions = JSON.parse(JSON.stringify(chartInstance.options));

    // Ensure white background and black text for readability
    exportOptions.backgroundColor = '#ffffff';
    exportOptions.plugins = exportOptions.plugins || {};
    exportOptions.plugins.legend = exportOptions.plugins.legend || {};
    exportOptions.plugins.legend.labels = exportOptions.plugins.legend.labels || {};
    exportOptions.plugins.legend.labels.color = '#000000';
    exportOptions.plugins.legend.labels.font = exportOptions.plugins.legend.labels.font || {};
    exportOptions.plugins.legend.labels.font.size = 12;

    if (exportOptions.scales) {
        if (exportOptions.scales.y) {
            exportOptions.scales.y.ticks = exportOptions.scales.y.ticks || {};
            exportOptions.scales.y.ticks.color = '#000000';
            exportOptions.scales.y.ticks.font = exportOptions.scales.y.ticks.font || {};
            exportOptions.scales.y.ticks.font.size = 11;
        }
        if (exportOptions.scales.x) {
            exportOptions.scales.x.ticks = exportOptions.scales.x.ticks || {};
            exportOptions.scales.x.ticks.color = '#000000';
            exportOptions.scales.x.ticks.font = exportOptions.scales.x.ticks.font || {};
            exportOptions.scales.x.ticks.font.size = 11;
        }
        if (exportOptions.scales.r) {
            exportOptions.scales.r.ticks = exportOptions.scales.r.ticks || {};
            exportOptions.scales.r.ticks.color = '#000000';
            exportOptions.scales.r.ticks.font = exportOptions.scales.r.ticks.font || {};
            exportOptions.scales.r.ticks.font.size = 11;
        }
    }

    exportOptions.animation = false;
    exportOptions.responsive = false;
    exportOptions.maintainAspectRatio = false;

    const tempChart = new Chart(tempCtx, {
        type: chartInstance.config.type,
        data: exportData,
        options: exportOptions
    });

    tempChart.update();
    const imageData = tempCanvas.toDataURL('image/png');
    tempChart.destroy();
    document.body.removeChild(tempCanvas);

    return imageData;
}

// PDF Export with Charts and Data
async function exportPDF() {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const now = new Date();
        const dateStr = now.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Page dimensions
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        const contentWidth = pageWidth - (2 * margin);

        // Title
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text('Facial Expression Analysis Report', margin, 15);

        // Metadata
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(`Date: ${dateStr}`, margin, 23);
        doc.text(`Time: ${timeStr}`, margin, 28);
        doc.text(`Total Observations: ${sessionLog.size}`, margin, 33);
        doc.text(`Average Session Duration: ${(sessionLog.size * 0.25).toFixed(1)} seconds`, margin, 38);

        // Add separator line
        doc.setDrawColor(255, 215, 0);
        doc.setLineWidth(0.5);
        doc.line(margin, 41, pageWidth - margin, 41);

        let yPos = 48;

        // 1. Emotion Distribution Chart (Doughnut - best aspect ratio)
        if (emotionChartInstance) {
            const chartImage = getChartImageForPDF(emotionChartInstance);
            const chartWidth = 90;
            const chartHeight = 90;
            const xPos = margin + (contentWidth - chartWidth) / 2;
            doc.addImage(chartImage, 'PNG', xPos, yPos, chartWidth, chartHeight);
            
            doc.setFontSize(13);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text('Emotion Distribution', margin, yPos - 2);
            
            yPos += 100;
        }

        // Check if we need a new page
        if (yPos > 200) {
            doc.addPage();
            yPos = 15;
        }

        // 2. Eye Contact Tracking Chart (Line - wider aspect)
        if (eyeContactChartInstance) {
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text('Eye Contact Tracking', margin, yPos);
            yPos += 6;
            
            const chartImage = getChartImageForPDF(eyeContactChartInstance);
            const chartWidth = contentWidth;
            const chartHeight = 100;
            doc.addImage(chartImage, 'PNG', margin, yPos, chartWidth, chartHeight);
            yPos += chartHeight + 8;
        }

        // 3. Smile Detection Chart (Bar - wider aspect)
        if (yPos > 210) {
            doc.addPage();
            yPos = 15;
        }

        if (smileChartInstance) {
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text('Smile Detection', margin, yPos);
            yPos += 6;
            
            const chartImage = getChartImageForPDF(smileChartInstance);
            const chartWidth = contentWidth;
            const chartHeight = 100;
            doc.addImage(chartImage, 'PNG', margin, yPos, chartWidth, chartHeight);
            yPos += chartHeight + 8;
        }

        // 4. Micro-Expressions Chart (Radar - square aspect)
        if (yPos > 210) {
            doc.addPage();
            yPos = 15;
        }

        if (microExpChartInstance) {
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text('Micro-Expressions Analysis', margin, yPos);
            yPos += 6;
            
            const chartImage = getChartImageForPDF(microExpChartInstance);
            const chartWidth = 90;
            const chartHeight = 90;
            const xPos = margin + (contentWidth - chartWidth) / 2;
            doc.addImage(chartImage, 'PNG', xPos, yPos, chartWidth, chartHeight);
            yPos += chartHeight + 10;
        }

        // 5. Expression Timeline Chart (Bar chart showing emotion frequency - compact size)
        if (yPos > 210) {
            doc.addPage();
            yPos = 15;
        }

        if (timelineChartInstance) {
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text('Expression Timeline', margin, yPos);
            yPos += 6;
            
            const chartImage = getChartImageForPDF(timelineChartInstance);
            const chartWidth = contentWidth;
            const chartHeight = 100;
            doc.addImage(chartImage, 'PNG', margin, yPos, chartWidth, chartHeight);
            yPos += chartHeight + 8;
        }

        // Add Statistics Summary on new page
        doc.addPage();
        yPos = 15;

        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('Statistics Summary', margin, yPos);
        yPos += 10;

        // Compute statistics
        const counts = {};
        const confByEmo = {};
        let current = sessionLog.head;
        let totalConf = 0;

        while (current) {
            const { label, confidence } = current.data;
            counts[label] = (counts[label] || 0) + 1;
            confByEmo[label] = (confByEmo[label] || []);
            confByEmo[label].push(confidence);
            totalConf += confidence;
            current = current.next;
        }

        const total = sessionLog.size;
        const avgConf = (totalConf / total * 100).toFixed(1);
        const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const dominantPct = (dominant[1] / total * 100).toFixed(1);

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`Average Confidence: ${avgConf}%`, margin, yPos);
        yPos += 6;
        doc.text(`Dominant Emotion: ${dominant[0]} (${dominantPct}%)`, margin, yPos);
        yPos += 10;

        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text('Emotion Breakdown:', margin, yPos);
        yPos += 8;

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([emotion, count]) => {
                const pct = (count / total * 100).toFixed(1);
                const avgC = (confByEmo[emotion].reduce((a, b) => a + b, 0) / confByEmo[emotion].length * 100).toFixed(1);
                doc.text(`• ${emotion}: ${count} (${pct}%) | Avg Confidence: ${avgC}%`, margin + 5, yPos);
                yPos += 6;
                
                if (yPos > 270) {
                    doc.addPage();
                    yPos = 15;
                }
            });

        // Footer on last page
        doc.setFontSize(8);
        doc.setFont(undefined, 'italic');
        doc.setTextColor(150);
        doc.text('Ensemble CNN-CatBoost Facial Expression Recognition System', 105, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
        doc.setTextColor(0);

        // Download
        doc.save('emotion_analysis_report.pdf');
        alert('PDF exported successfully!');

    } catch (error) {
        console.error('PDF Export Error:', error);
        alert('❌ Failed to export PDF. Please check the console.');
    }
}

/*========== INIT ========== */
window.addEventListener('load', () => {
    activePage = 'dashboard';
    canvas     = canvasElements['dashboard'];
    ctx        = canvas.getContext('2d');
    initCamera();

    document.querySelectorAll('.start-button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!isRunning) {
                // Detect which page this button lives on
                activePage = btn.closest('#comparison-page') ? 'comparison' : 'dashboard';

                // Sync canvas context to the active page
                canvas = canvasElements[activePage] || canvasElements['dashboard'];
                ctx = canvas.getContext('2d');
                initCanvas();

                startInference();
                btn.textContent = activePage === 'comparison' ? 'Stop Comparison' : 'Stop';
            } else {
                stopInference();
                btn.textContent = activePage === 'comparison' ? 'Start Comparison' : 'Start Logging';
            }
        })
    });
});