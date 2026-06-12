// ─── EXPORT ───────────────────────────────────────────────
function exportData(type) {
    if (sessionLog.size === 0) {
        alert('No data collected yet! Go to Dashboard and start logging.');
        return;
    }
    if (type === 'csv')   exportCSV();
    if (type === 'psych') exportObservationLog();
    if (type === 'pdf')   exportPDF();
}

function downloadFile(content, filename) {
    const blob = new Blob(['\ufeff' + content], { type: 'text/plain;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    alert(`Exported successfully as ${filename}!`);
}

function exportCSV() {
    let content = 'Timestamp,Emotion,Confidence\n';
    let node    = sessionLog.head;
    while (node) {
        content += `${node.data.timestamp},${node.data.label},${(node.data.confidence*100).toFixed(2)}%\n`;
        node = node.next;
    }
    downloadFile(content, 'emotion_log.csv');
}

// ─── Helper: snapshot a <canvas> element with a white background ───────────
function snapshotCanvas(canvasEl, maxW, maxH) {
    const chart = Object.values(Chart.instances).find(c => c.canvas === canvasEl);

    // Override colors for export
    if (chart) {
        chart.options.plugins.legend.labels.color = '#1e1e1e';
        if (chart.options.plugins.datalabels) {
            chart.options.plugins.datalabels.color = '#1e1e1e';
        }
        chart.options.scales && Object.values(chart.options.scales).forEach(scale => {
            if (scale.ticks) scale.ticks.color = '#1e1e1e';
            if (scale.title) scale.title.color = '#1e1e1e';
        });
        chart.update('none'); // re-render without animation
    }

    const offscreen = document.createElement('canvas');
    offscreen.width  = canvasEl.width;
    offscreen.height = canvasEl.height;
    const ctx = offscreen.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(canvasEl, 0, 0);
    const img = offscreen.toDataURL('image/png', 1.0);

    // Restore original colors
    if (chart) {
        chart.options.plugins.legend.labels.color = '#ffffff';
        if (chart.options.plugins.datalabels) {
            chart.options.plugins.datalabels.color = '#ffffff';
        }
        chart.options.scales && Object.values(chart.options.scales).forEach(scale => {
            if (scale.ticks) scale.ticks.color = '#ffffff';
            if (scale.title) scale.title.color = '#ffffff';
        });
        chart.update('none');
    }

    const ratio = offscreen.width / offscreen.height;
    let w = maxW, h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    return { img, w, h };
}

// ─── Shared PDF helpers factory ────────────────────────────
function buildPDFBase() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W   = doc.internal.pageSize.getWidth();
    const H   = doc.internal.pageSize.getHeight();
    const M   = 14;
    const CW  = W - M * 2;

    const MAROON  = [128, 0, 0];
    const GOLD    = [200, 160, 0];
    const WHITE   = [255, 255, 255];
    const DARK    = [30, 30, 30];
    const MID     = [90, 90, 90];
    const LIGHT   = [150, 150, 150];
    const PANEL   = [248, 245, 245];
    const DIVIDER = [220, 210, 210];

    const emotionPalette = {
        Happy:   [57,  255, 180],
        Sad:     [255, 85,  170],
        Fear:    [170, 85,  255],
        Angry:   [255, 85,  85],
        Disgust: [141, 182, 0],
        Surprise:[255, 107, 0],
        Neutral: [85,  170, 255],
    };

    const now     = new Date();
    const dateStr = now.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let y = 0;

    const setColor = (r, g, b) => doc.setTextColor(r, g, b);
    const setFill  = (r, g, b) => doc.setFillColor(r, g, b);
    const setDraw  = (r, g, b) => doc.setDrawColor(r, g, b);

    const checkPage = (needed = 20) => { if (y + needed > H - 18) newPage(); };

    function drawPageFooter() {
        const pg = doc.internal.getCurrentPageInfo().pageNumber;
        setFill(...MAROON);
        doc.rect(0, H - 10, W, 10, 'F');
        setColor(...WHITE);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.text('Ensemble CNN–CatBoost Facial Expression Recognition System  |  For professional use only', M, H - 3.5);
        doc.text(`Page ${pg}`, W - M, H - 3.5, { align: 'right' });
    }

    function drawPageHeader() {
        setFill(...MAROON);
        doc.rect(0, 0, W, 12, 'F');
        setColor(...WHITE);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.text('FACIAL EXPRESSION ANALYSIS REPORT', M, 7.5);
        doc.setFont('helvetica', 'normal');
        doc.text(`${dateStr}  |  ${timeStr}`, W - M, 7.5, { align: 'right' });
        y = 17;
    }

    function newPage() {
        doc.addPage();
        y = 0;
        drawPageFooter();
        drawPageHeader();
    }

    function sectionTitle(label) {
        checkPage(14);
        y += 3;
        setFill(...MAROON);
        doc.rect(M, y, 3, 6, 'F');
        setColor(...MAROON);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(label.toUpperCase(), M + 5, y + 4.5);
        setDraw(...DIVIDER);
        doc.setLineWidth(0.3);
        doc.line(M + 5, y + 7, W - M, y + 7);
        y += 11;
    }

    return {
        doc, W, H, M, CW, now, dateStr, timeStr, y,
        MAROON, GOLD, WHITE, DARK, MID, LIGHT, PANEL, DIVIDER,
        emotionPalette,
        setColor, setFill, setDraw,
        checkPage, drawPageFooter, drawPageHeader, newPage, sectionTitle,
        getY: () => y,
        setY: (val) => { y = val; },
        addY: (val) => { y += val; },
    };
}

// ─── OBSERVATION LOG PDF (Page 3 content only) ────────────
async function exportObservationLog() {
    try {
        const { jsPDF } = window.jspdf;
        if (sessionLog.size === 0) {
            alert('No session data to export.');
            return;
        }

        const b = buildPDFBase();
        const { doc, W, H, M, CW, now, dateStr, timeStr, emotionPalette } = b;
        const { MAROON, GOLD, WHITE, DARK, MID, LIGHT, PANEL, DIVIDER } = b;
        const { setColor, setFill, setDraw, sectionTitle, drawPageFooter } = b;

        // ── Compute stats ──
        const counts    = {};
        const confByEmo = {};
        let current     = sessionLog.head;
        let totalConf   = 0;
        while (current) {
            const { label, confidence } = current.data;
            counts[label]    = (counts[label] || 0) + 1;
            confByEmo[label] = confByEmo[label] || [];
            confByEmo[label].push(confidence);
            totalConf += confidence;
            current = current.next;
        }
        const total       = sessionLog.size;
        const avgConf     = (totalConf / total * 100).toFixed(1);
        const dominant    = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const dominantPct = (dominant[1] / total * 100).toFixed(1);
        const lowConfCount = (() => {
            let n = sessionLog.head, cnt = 0;
            while (n) { if (n.data.confidence < 0.5) cnt++; n = n.next; }
            return cnt;
        })();
        const duration = (total * 0.25).toFixed(0);

        let y = 0;
        const checkPage = (needed = 20) => {
            if (y + needed > H - 18) {
                doc.addPage();
                y = 0;
                drawPageFooter();
                drawHeader();
            }
        };

        // Cover header bar
        function drawHeader() {
            setFill(...MAROON);
            doc.rect(0, 0, W, 12, 'F');
            setColor(...WHITE);
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'bold');
            doc.text('OBSERVATION LOG  |  FACIAL EXPRESSION ANALYSIS', M, 7.5);
            doc.setFont('helvetica', 'normal');
            doc.text(`${dateStr}  |  ${timeStr}`, W - M, 7.5, { align: 'right' });
            y = 17;
        }

        // ── Page 1 cover strip ──
        setFill(...MAROON);
        doc.rect(0, 0, W, 42, 'F');
        setFill(...GOLD);
        doc.rect(0, 42, W, 1.5, 'F');

        setColor(...WHITE);
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Observation Log', M, 16);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Session Transcript  |  CNN–CatBoost Ensemble FER System', M, 26);
        doc.setFontSize(8);
        doc.text(dateStr, W - M, 18, { align: 'right' });
        doc.text(timeStr, W - M, 25, { align: 'right' });

        y = 54;

        // ── Summary metric boxes ──
        const metricBoxes = [
            { label: 'Total Frames',     value: total },
            { label: 'Duration',         value: `${duration}s` },
            { label: 'Avg Confidence',   value: `${avgConf}%` },
            { label: 'Dominant Emotion', value: dominant[0] },
            { label: 'Low Conf. Frames', value: lowConfCount },
        ];
        const bw = CW / metricBoxes.length;
        metricBoxes.forEach((m, i) => {
            const bx = M + i * bw;
            setFill(...PANEL);
            setDraw(...DIVIDER);
            doc.setLineWidth(0.3);
            doc.roundedRect(bx, y, bw - 2, 18, 1.5, 1.5, 'FD');
            setColor(...MAROON);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.text(m.label.toUpperCase(), bx + (bw - 2) / 2, y + 5.5, { align: 'center' });
            setColor(...DARK);
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text(String(m.value), bx + (bw - 2) / 2, y + 13, { align: 'center' });
        });
        y += 24;

        // ── Emotion breakdown table ──
        const addSectionTitle = (label) => {
            checkPage(14);
            y += 3;
            setFill(...MAROON);
            doc.rect(M, y, 3, 6, 'F');
            setColor(...MAROON);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(label.toUpperCase(), M + 5, y + 4.5);
            setDraw(...DIVIDER);
            doc.setLineWidth(0.3);
            doc.line(M + 5, y + 7, W - M, y + 7);
            y += 11;
        };

        addSectionTitle('Emotion Breakdown');
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

        setFill(...MAROON);
        doc.rect(M, y, CW, 7, 'F');
        setColor(...WHITE);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        const cols = [M + 2, M + 30, M + 55, M + 85, M + 118];
        ['Emotion', 'Count', 'Frequency', 'Avg Confidence', 'Bar'].forEach((h, i) => {
            doc.text(h, cols[i], y + 4.8);
        });
        y += 7;

        sorted.forEach(([emotion, count], idx) => {
            checkPage(8);
            const pct   = (count / total * 100).toFixed(1);
            const avgC  = (confByEmo[emotion].reduce((a, b) => a + b, 0) / confByEmo[emotion].length * 100).toFixed(1);
            const color = emotionPalette[emotion] || [120, 120, 120];
            const barMax = CW - (cols[4] - M) - 4;
            const barW   = (parseFloat(pct) / 100) * barMax;

            if (idx % 2 === 0) { setFill(245, 240, 240); doc.rect(M, y, CW, 7, 'F'); }

            setFill(...color); doc.circle(cols[0] + 1.5, y + 3.5, 1.5, 'F');
            setColor(...DARK); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
            doc.text(emotion, cols[0] + 5, y + 4.8);
            doc.setFont('helvetica', 'normal'); setColor(...MID);
            doc.text(String(count), cols[1], y + 4.8);
            doc.text(`${pct}%`, cols[2], y + 4.8);
            doc.text(`${avgC}%`, cols[3], y + 4.8);
            setFill(220, 210, 210); doc.rect(cols[4], y + 1.5, barMax, 4, 'F');
            setFill(...color); doc.rect(cols[4], y + 1.5, barW, 4, 'F');
            setDraw(...DIVIDER); doc.setLineWidth(0.2); doc.line(M, y + 7, W - M, y + 7);
            y += 7;
        });
        y += 5;

        // ── Detailed log table ──
        addSectionTitle('Session Observation Log');

        setFill(...MAROON);
        doc.rect(M, y, CW, 7, 'F');
        setColor(...WHITE);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        const logCols = [M + 2, M + 28, M + 60, M + 90];
        ['Timestamp', 'Emotion', 'Confidence', 'Notes'].forEach((h, i) => {
            doc.text(h, logCols[i], y + 4.8);
        });
        y += 7;

        let logCurrent = sessionLog.head;
        let rowIdx = 0;
        while (logCurrent) {
            checkPage(7);
            const { timestamp, label, confidence } = logCurrent.data;
            const conf  = (confidence * 100).toFixed(1);
            const color = emotionPalette[label] || [120, 120, 120];
            const note  = confidence < 0.5 ? 'Low confidence' : '';

            if (rowIdx % 2 === 0) { setFill(245, 240, 240); doc.rect(M, y, CW, 6, 'F'); }
            setFill(...color); doc.rect(M, y, 1.5, 6, 'F');
            setColor(...MID); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
            doc.text(timestamp, logCols[0] + 2, y + 4);
            setColor(...DARK); doc.setFont('helvetica', 'bold');
            doc.text(label, logCols[1], y + 4);
            doc.setFont('helvetica', 'normal');
            setColor(confidence < 0.5 ? 180 : 60, confidence < 0.5 ? 60 : 130, 60);
            doc.text(`${conf}%`, logCols[2], y + 4);
            setColor(...LIGHT); doc.setFontSize(7);
            doc.text(note, logCols[3], y + 4);
            setDraw(...DIVIDER); doc.setLineWidth(0.15); doc.line(M, y + 6, W - M, y + 6);
            y += 6;
            rowIdx++;
            logCurrent = logCurrent.next;
        }

        y += 6;
        checkPage(20);
        addSectionTitle('Clinical Summary');

        const summaryLines = [
            `This report was generated on ${dateStr} at ${timeStr} from a live facial expression recognition session.`,
            `A total of ${total} frames were analysed over approximately ${duration} seconds using the Ensemble CNN–CatBoost model.`,
            `The predominant emotion observed was ${dominant[0]}, accounting for ${dominantPct}% of all frames.`,
            `Average model confidence across the session was ${avgConf}%. ${lowConfCount} frame(s) fell below the 50% confidence threshold.`,
            ``,
            `Note: All predictions are model inferences on live video frames. This report does not constitute a clinical diagnosis.`,
            `Results should be interpreted alongside clinical observation and professional judgement.`,
        ];

        setColor(...DARK);
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        summaryLines.forEach(line => {
            checkPage(7);
            if (line === '') { y += 3; return; }
            const split = doc.splitTextToSize(line, CW);
            split.forEach(l => { doc.text(l, M, y); y += 5; });
        });

        // Signature block
        y += 10;
        checkPage(28);
        setDraw(...DIVIDER);
        doc.setLineWidth(0.3);
        [M, M + CW / 2 + 5].forEach(sx => {
            doc.line(sx, y + 14, sx + CW / 2 - 10, y + 14);
        });
        setColor(...LIGHT);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.text('Evaluator Signature / Name', M, y + 18);
        doc.text('Date', M + CW / 2 + 5, y + 18);

        drawPageFooter();
        doc.save(`FER_ObservationLog_${now.toISOString().slice(0, 10)}.pdf`);

    } catch (error) {
        console.error('Observation Log PDF Error:', error);
        alert('Failed to export Observation Log. Check the console for details.');
    }
}

// ─── PDF REPORT (Pages 1 + 2: Cover + Charts only) ────────
async function exportPDF() {
    try {
        const { jsPDF } = window.jspdf;
        if (sessionLog.size === 0) {
            alert('No session data to export. Start a logging session first.');
            return;
        }

        // ── Compute stats ──
        const counts    = {};
        const confByEmo = {};
        let current     = sessionLog.head;
        let totalConf   = 0;
        while (current) {
            const { label, confidence } = current.data;
            counts[label]    = (counts[label] || 0) + 1;
            confByEmo[label] = confByEmo[label] || [];
            confByEmo[label].push(confidence);
            totalConf += confidence;
            current = current.next;
        }
        const total       = sessionLog.size;
        const avgConf     = (totalConf / total * 100).toFixed(1);
        const dominant    = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const dominantPct = (dominant[1] / total * 100).toFixed(1);
        const lowConfCount = (() => {
            let n = sessionLog.head, cnt = 0;
            while (n) { if (n.data.confidence < 0.5) cnt++; n = n.next; }
            return cnt;
        })();
        const duration = (total * 0.25).toFixed(0);

        const now     = new Date();
        const dateStr = now.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const W   = doc.internal.pageSize.getWidth();
        const H   = doc.internal.pageSize.getHeight();
        const M   = 14;
        const CW  = W - M * 2;

        const MAROON  = [128, 0, 0];
        const GOLD    = [200, 160, 0];
        const WHITE   = [255, 255, 255];
        const DARK    = [30, 30, 30];
        const MID     = [90, 90, 90];
        const LIGHT   = [150, 150, 150];
        const PANEL   = [248, 245, 245];
        const DIVIDER = [220, 210, 210];

        const emotionPalette = {
            Happy:   [57,  255, 180],
            Sad:     [255, 85,  170],
            Fear:    [170, 85,  255],
            Angry:   [255, 85,  85],
            Disgust: [141, 182, 0],
            Surprise:[255, 107, 0],
            Neutral: [85,  170, 255],
        };

        let y = 0;

        const setColor = (r, g, b) => doc.setTextColor(r, g, b);
        const setFill  = (r, g, b) => doc.setFillColor(r, g, b);
        const setDraw  = (r, g, b) => doc.setDrawColor(r, g, b);
        const checkPage = (needed = 20) => { if (y + needed > H - 18) newPage(); };

        function drawPageFooter() {
            const pg = doc.internal.getCurrentPageInfo().pageNumber;
            setFill(...MAROON);
            doc.rect(0, H - 10, W, 10, 'F');
            setColor(...WHITE);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'italic');
            doc.text('Ensemble CNN–CatBoost Facial Expression Recognition System  |  For professional use only', M, H - 3.5);
            doc.text(`Page ${pg}`, W - M, H - 3.5, { align: 'right' });
        }

        function drawPageHeader() {
            setFill(...MAROON);
            doc.rect(0, 0, W, 12, 'F');
            setColor(...WHITE);
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'bold');
            doc.text('FACIAL EXPRESSION ANALYSIS REPORT', M, 7.5);
            doc.setFont('helvetica', 'normal');
            doc.text(`${dateStr}  |  ${timeStr}`, W - M, 7.5, { align: 'right' });
            y = 17;
        }

        function newPage() {
            doc.addPage();
            y = 0;
            drawPageFooter();
            drawPageHeader();
        }

        function sectionTitle(label) {
            checkPage(14);
            y += 3;
            setFill(...MAROON);
            doc.rect(M, y, 3, 6, 'F');
            setColor(...MAROON);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(label.toUpperCase(), M + 5, y + 4.5);
            setDraw(...DIVIDER);
            doc.setLineWidth(0.3);
            doc.line(M + 5, y + 7, W - M, y + 7);
            y += 11;
        }

        // ════════════════════════════════════════════
        // PAGE 1 — COVER
        // ════════════════════════════════════════════
        setFill(...MAROON);
        doc.rect(0, 0, W, 42, 'F');
        setFill(...GOLD);
        doc.rect(0, 42, W, 1.5, 'F');

        setColor(...WHITE);
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Facial Expression', M, 16);
        doc.text('Analysis Report', M, 26);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('CNN–CatBoost Ensemble Model  |  Real-Time Inference', M, 34);
        doc.setFontSize(8);
        doc.text(dateStr, W - M, 18, { align: 'right' });
        doc.text(timeStr, W - M, 25, { align: 'right' });

        y = 54;

        // ── Summary metrics row ──
        const metricBoxes = [
            { label: 'Total Frames',     value: total },
            { label: 'Duration',         value: `${duration}s` },
            { label: 'Avg Confidence',   value: `${avgConf}%` },
            { label: 'Dominant Emotion', value: dominant[0] },
            { label: 'Low Conf. Frames', value: lowConfCount },
        ];
        const bw = CW / metricBoxes.length;
        metricBoxes.forEach((m, i) => {
            const bx = M + i * bw;
            setFill(...PANEL); setDraw(...DIVIDER);
            doc.setLineWidth(0.3);
            doc.roundedRect(bx, y, bw - 2, 18, 1.5, 1.5, 'FD');
            setColor(...MAROON);
            doc.setFontSize(7); doc.setFont('helvetica', 'normal');
            doc.text(m.label.toUpperCase(), bx + (bw - 2) / 2, y + 5.5, { align: 'center' });
            setColor(...DARK);
            doc.setFontSize(11); doc.setFont('helvetica', 'bold');
            doc.text(String(m.value), bx + (bw - 2) / 2, y + 13, { align: 'center' });
        });
        y += 24;

        // ── Emotion breakdown table ──
        sectionTitle('Emotion Breakdown');
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

        setFill(...MAROON);
        doc.rect(M, y, CW, 7, 'F');
        setColor(...WHITE);
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
        const cols = [M + 2, M + 30, M + 55, M + 85, M + 118];
        ['Emotion', 'Count', 'Frequency', 'Avg Confidence', 'Bar'].forEach((h, i) => {
            doc.text(h, cols[i], y + 4.8);
        });
        y += 7;

        sorted.forEach(([emotion, count], idx) => {
            checkPage(8);
            const pct   = (count / total * 100).toFixed(1);
            const avgC  = (confByEmo[emotion].reduce((a, b) => a + b, 0) / confByEmo[emotion].length * 100).toFixed(1);
            const color = emotionPalette[emotion] || [120, 120, 120];
            const barMax = CW - (cols[4] - M) - 4;
            const barW   = (parseFloat(pct) / 100) * barMax;

            if (idx % 2 === 0) { setFill(245, 240, 240); doc.rect(M, y, CW, 7, 'F'); }
            setFill(...color); doc.circle(cols[0] + 1.5, y + 3.5, 1.5, 'F');
            setColor(...DARK); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
            doc.text(emotion, cols[0] + 5, y + 4.8);
            doc.setFont('helvetica', 'normal'); setColor(...MID);
            doc.text(String(count), cols[1], y + 4.8);
            doc.text(`${pct}%`, cols[2], y + 4.8);
            doc.text(`${avgC}%`, cols[3], y + 4.8);
            setFill(220, 210, 210); doc.rect(cols[4], y + 1.5, barMax, 4, 'F');
            setFill(...color); doc.rect(cols[4], y + 1.5, barW, 4, 'F');
            setDraw(...DIVIDER); doc.setLineWidth(0.2); doc.line(M, y + 7, W - M, y + 7);
            y += 7;
        });
        y += 5;

        // ── Inference note ──
        checkPage(18);
        setFill(255, 251, 235); setDraw(200, 160, 0);
        doc.setLineWidth(0.4);
        doc.roundedRect(M, y, CW, 14, 1.5, 1.5, 'FD');
        setFill(...GOLD); doc.rect(M, y, 2.5, 14, 'F');
        setColor(120, 80, 0);
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
        doc.text('Important Note on Metrics', M + 5, y + 5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.text('Confidence values reflect model softmax output (self-reported certainty), not verified accuracy. Metrics requiring ground-truth labels', M + 5, y + 9);
        doc.text('(Accuracy, Precision, Recall, F1, ECE, Confusion Matrix) are not computable from live inference and are not shown in this report.', M + 5, y + 13);
        y += 19;

        drawPageFooter();

        // ════════════════════════════════════════════
        // PAGE 2 — CHARTS ONLY
        // ════════════════════════════════════════════
        newPage();
        sectionTitle('Visualisations');

        const chartDefs = [
            { id: 'emotionChart',   label: 'Emotion Distribution',       maxW: CW * 0.6, maxH: 80 },
            { id: 'arousalChart',   label: 'Arousal Level',               maxW: CW,       maxH: 65 },
            { id: 'negAffectChart', label: 'Negative Affect Load',        maxW: CW,       maxH: 65 },
            { id: 'earChart',       label: 'Eye Openness + Blinks (EAR)', maxW: CW,       maxH: 65 },
            { id: 'auChart',        label: 'Facial Action Units (AU)',     maxW: CW * 0.6, maxH: 80 },
            { id: 'stabilityChart', label: 'Emotional Stability',         maxW: CW,       maxH: 65 },
            { id: 'distanceChart',  label: 'Face Distance Over Time',     maxW: CW,       maxH: 65 },
        ];

        for (const def of chartDefs) {
            const canvasEl = document.getElementById(def.id);
            if (!canvasEl || canvasEl.width === 0 || canvasEl.height === 0) continue;

            const { img, w, h } = snapshotCanvas(canvasEl, def.maxW, def.maxH);
            checkPage(h + 18);

            setColor(...MID); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
            doc.text(def.label.toUpperCase(), M, y + 4);
            setDraw(...DIVIDER); doc.setLineWidth(0.2);
            doc.line(M, y + 5.5, W - M, y + 5.5);
            y += 9;

            setFill(...PANEL); setDraw(...DIVIDER);
            doc.setLineWidth(0.3);
            doc.roundedRect(M, y, CW, h + 6, 2, 2, 'FD');
            doc.addImage(img, 'PNG', M + (CW - w) / 2, y + 3, w, h);
            y += h + 12;
        }

        const ganttEl = document.getElementById('ganttChart');
        if (ganttEl && ganttEl.innerHTML.trim() !== '') {

            // ── Force PDF-safe colors before capture ──
            const blocks = ganttEl.querySelectorAll('[class*="gantt"], div[style]');
            const originalStyles = [];
            ganttEl.querySelectorAll('*').forEach(el => {
                const computed = window.getComputedStyle(el);
                originalStyles.push({ el, color: el.style.color });
                // If text color is white or near-white, override to dark
                const c = computed.color; // e.g. "rgb(255,255,255)"
                if (c) {
                    const match = c.match(/\d+/g);
                    if (match) {
                        const [r, g, b] = match.map(Number);
                        if (r > 200 && g > 200 && b > 200) {
                            el.style.color = '#1e1e1e';
                        }
                    }
                }
            });

            const ganttCanvas = await html2canvas(ganttEl, {
                backgroundColor: '#fff0f0',
                scale: 2,
                useCORS: true,
                logging: false,
                windowWidth: ganttEl.scrollWidth,
                windowHeight: ganttEl.scrollHeight,
            });

            // ── Restore original colors ──
            originalStyles.forEach(({ el, color }) => { el.style.color = color; });

            const img   = ganttCanvas.toDataURL('image/png', 1.0);
            const ratio = ganttCanvas.width / ganttCanvas.height;
            let w = CW, h = w / ratio;
            if (h > 90) { h = 90; w = h * ratio; }  // slightly taller than before

            checkPage(h + 18);
            setColor(...MID); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
            doc.text('EMOTION TIMELINE', M, y + 4);
            setDraw(...DIVIDER); doc.setLineWidth(0.2);
            doc.line(M, y + 5.5, W - M, y + 5.5);
            y += 9;

            setFill(...PANEL); setDraw(...DIVIDER);
            doc.setLineWidth(0.3);
            doc.roundedRect(M, y, CW, h + 6, 2, 2, 'FD');
            doc.addImage(img, 'PNG', M + (CW - w) / 2, y + 3, w, h);
            y += h + 12;
        }
        drawPageFooter();
        doc.save(`FER_Report_${now.toISOString().slice(0, 10)}.pdf`);

    } catch (error) {
        console.error('PDF Export Error:', error);
        alert('Failed to export PDF. Check the console for details.');
    }
}