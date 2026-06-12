// ─── CHART INSTANCES ──────────────────────────────────────
let emotionChartInstance   = null;
let arousalChartInstance   = null;
let negAffectChartInstance = null;
let earChartInstance       = null;
let auChartInstance        = null;
let stabilityChartInstance = null;

function toggleSkeletonLoaders(show) {
    ['emotion-skeleton','gantt-skeleton','arousal-skeleton',
     'negaffect-skeleton','ear-skeleton','au-skeleton','stability-skeleton']
        .forEach(id => document.getElementById(id)?.classList.toggle('visible', show));
}

function renderChart() {
    if (sessionLog.size === 0) {
        [emotionChartInstance, arousalChartInstance, negAffectChartInstance,
         earChartInstance, auChartInstance, stabilityChartInstance]
            .forEach(c => c?.destroy());
        toggleSkeletonLoaders(true);
        if (activePage === 'analysis' && isRunning)
            setTimeout(() => requestAnimationFrame(renderChart), 500);
        return;
    }

    toggleSkeletonLoaders(false);

    const { counts }  = aggregateSessionStats();
    const entries     = getChronologicalEntries();
    const total       = sessionLog.size;

    // ── 1. Emotion Distribution ──────────────────────────
    const distLabels = Object.keys(counts);
    const distData   = Object.values(counts);
    const distColors = distLabels.map(l => emotionColors[l] || '#ccc');
    const distPcts   = distData.map(v => ((v / total) * 100).toFixed(1));

    emotionChartInstance = updateOrCreate(
        emotionChartInstance,
        () => new Chart(document.getElementById('emotionChart').getContext('2d'), {
            type: 'doughnut',
            data: {
                labels  : distLabels.map(l => l.toUpperCase()),
                datasets: [{ data: distData, backgroundColor: distColors, borderWidth: 0, hoverOffset: 4 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { bottom: 8 } },
                plugins: {
                    legend : { position: 'bottom', labels: { color: 'white', padding: 12, boxWidth: 10, font: { size: 11 } } },
                    tooltip: { callbacks: { label: ctx => `${ctx.label}: ${distPcts[ctx.dataIndex]}% (${ctx.parsed})` } }
                }
            }
        }),
        distLabels.map(l => l.toUpperCase()), distData
    );
    if (emotionChartInstance) emotionChartInstance.data.datasets[0].backgroundColor = distColors;
    setTextContent('session-duration', (total * 0.25).toFixed(0) + 's');

    // ── 2. Emotion Gantt Timeline ────────────────────────
    const ganttEl = document.getElementById('ganttChart');
    if (ganttEl && entries.length > 0) {
        const segments = [];
        entries.forEach((e, i) => {
            if (i === 0 || e.label !== entries[i-1].label)
                segments.push({ label: e.label, start: i, end: i, time: e.timestamp });
            else
                segments[segments.length-1].end = i;
        });
        setTextContent('emotion-shifts', segments.length - 1);
        ganttEl.innerHTML = `
            <div class="gantt-wrapper">
                <div class="gantt-track">
                    ${segments.map(seg => {
                        const w = ((seg.end - seg.start + 1) / total * 100).toFixed(2);
                        const c = emotionColors[seg.label] || '#ccc';
                        return `<div class="gantt-segment" style="width:${w}%;background:${c};"
                            title="${seg.label} — ${seg.time} (${seg.end - seg.start + 1} frames)">
                            ${parseFloat(w) > 8 ? `<span class="gantt-label">${seg.label}</span>` : ''}
                        </div>`;
                    }).join('')}
                </div>
                <div class="gantt-legend">
                    ${segments.slice(-5).reverse().map(seg => `
                        <span class="gantt-legend-item">
                            <span class="gantt-dot" style="background:${emotionColors[seg.label]||'#ccc'}"></span>
                            ${seg.label} <small>${seg.time}</small>
                        </span>`).join('')}
                </div>
            </div>`;
    }

    // ── 3. Arousal Trend ─────────────────────────────────
    const aData   = arousalHistory.length > 0 ? arousalHistory : entries.map(e => AROUSAL_MAP[e.label] ?? 0.5);
    const aLabels = aData.map((_, i) => `#${i+1}`);
    const curA    = aData[aData.length-1] ?? 0;
    setTextContent('arousal-level', `${(curA*100).toFixed(0)}% (${curA>0.75?'High':curA>0.45?'Moderate':'Low'})`);

    arousalChartInstance = updateOrCreate(
        arousalChartInstance,
        () => new Chart(document.getElementById('arousalChart').getContext('2d'), {
            type: 'line',
            data: { labels: aLabels, datasets: [{ label:'Arousal', data: aData,
                borderColor:'#FF6B00', backgroundColor:'rgba(255,107,0,0.15)',
                borderWidth:2, fill:true, tension:0.4, pointRadius:0 }] },
            options: { responsive:true, maintainAspectRatio:false,
                plugins: { legend: { display:false } },
                scales: {
                    y: { beginAtZero:true, max:1, ...AXIS_STYLE,
                         ticks: { ...AXIS_STYLE.ticks, callback: v => v===0?'Low':v===0.5?'Med':v===1?'High':'' } },
                    x: { ...AXIS_STYLE, ticks: { ...AXIS_STYLE.ticks, maxTicksLimit:8 } }
                }
            }
        }),
        aLabels, aData
    );

    // ── 4. Negative Affect Load ──────────────────────────
    const negEmos   = NEGATIVE_EMOTIONS.filter(e => counts[e]);
    const negData   = negEmos.map(e => parseFloat(((counts[e]||0)/total*100).toFixed(1)));
    const negColors = negEmos.map(e => emotionColors[e]);
    setTextContent('neg-affect-pct', `${negData.reduce((a,b)=>a+b,0).toFixed(1)}%`);

    negAffectChartInstance = updateOrCreate(
        negAffectChartInstance,
        () => new Chart(document.getElementById('negAffectChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels  : negEmos.length ? negEmos : ['No negative affect'],
                datasets: [{ label:'% of Session',
                    data           : negEmos.length ? negData : [0],
                    backgroundColor: negEmos.length ? negColors : ['#444'],
                    borderRadius:6, borderSkipped:false }]
            },
            options: { indexAxis:'y', responsive:true, maintainAspectRatio:false,
                plugins: { legend: { display:false } },
                scales: {
                    x: { beginAtZero:true, max:100, ...AXIS_STYLE,
                         ticks: { ...AXIS_STYLE.ticks, callback: v=>`${v}%` } },
                    y: { ...AXIS_STYLE }
                }
            }
        }),
        negEmos.length ? negEmos : ['No negative affect'],
        negEmos.length ? negData : [0]
    );
    if (negAffectChartInstance)
        negAffectChartInstance.data.datasets[0].backgroundColor = negColors.length ? negColors : ['#444'];

    // ── 5. EAR + Blink Events ────────────────────────────
    if (earHistory.length > 0) {
        const earLabels  = earHistory.map((_, i) => `#${i+1}`);
        const earData    = earHistory.map(e => parseFloat((e.ear * 100).toFixed(1)));
        const blinkPts   = earHistory.map((e,i) => e.blink ? {x:i+1, y:earData[i]} : null).filter(Boolean);

        setTextContent('blink-count', earHistory.filter(e=>e.blink).length);
        setTextContent('avg-ear', (earHistory.reduce((s,e)=>s+e.ear,0)/earHistory.length).toFixed(3));

        if (earChartInstance) {
            earChartInstance.data.labels           = earLabels;
            earChartInstance.data.datasets[0].data = earData;
            earChartInstance.data.datasets[1].data = blinkPts;
            earChartInstance.update('none');
        } else {
            earChartInstance = new Chart(document.getElementById('earChart').getContext('2d'), {
                type: 'line',
                data: { labels: earLabels, datasets: [
                    { label:'EAR', data:earData, borderColor:'#39ffb4',
                      backgroundColor:'rgba(57,255,180,0.1)', borderWidth:2, fill:true, tension:0.4, pointRadius:0 },
                    { label:'Blink', data:blinkPts, type:'scatter',
                      backgroundColor:'#ff5555', pointRadius:5, pointStyle:'triangle' }
                ]},
                options: { responsive:true, maintainAspectRatio:false,
                    plugins: { legend: { display:true, position:'top', labels:{ color:'white', font:{size:10} } } },
                    scales: {
                        y: { beginAtZero:true, max:100, ...AXIS_STYLE },
                        x: { ...AXIS_STYLE, ticks: { ...AXIS_STYLE.ticks, maxTicksLimit:8 } }
                    }
                }
            });
        }
    } else {
        setTextContent('blink-count', '0');
        setTextContent('avg-ear', '--');
    }

    // ── 6. Facial Action Units Radar ─────────────────────
    if (auHistory.length > 0) {
        const auKeys   = ['AU1','AU2','AU4','AU6','AU12','AU17','AU25'];
        const auLabels = ['AU1 Inner Brow','AU2 Outer Brow','AU4 Brow Lower',
                          'AU6 Cheek Raise','AU12 Lip Corner','AU17 Chin Raise','AU25 Lips Part'];
        const auData   = auKeys.map(k => parseFloat(
            (auHistory.reduce((s,f) => s+(f[k]||0), 0) / auHistory.length).toFixed(1)
        ));
        const latest = auHistory[auHistory.length-1];
        setTextContent('genuine-smile', (latest.AU6>25 && latest.AU12>35) ? '✓ Duchenne' : '✗ Non-Duchenne');

        auChartInstance = updateOrCreate(
            auChartInstance,
            () => new Chart(document.getElementById('auChart').getContext('2d'), {
                type: 'radar',
                data: { labels: auLabels, datasets: [{
                    label:'AU Score', data:auData, borderColor:'#FFD700',
                    backgroundColor:'rgba(255,215,0,0.15)', borderWidth:2,
                    pointBackgroundColor:'#FFD700', pointBorderColor:'#fff', pointRadius:4
                }]},
                options: { responsive:true, maintainAspectRatio:false,
                    plugins: { legend: { display:false } },
                    scales: { r: {
                        beginAtZero:true, max:100,
                        ticks      : { color:'rgba(255,255,255,0.7)', font:{size:9}, backdropColor:'transparent' },
                        grid       : { color:'rgba(255,255,255,0.1)' },
                        angleLines : { color:'rgba(255,255,255,0.15)' },
                        pointLabels: { color:'rgba(255,255,255,0.9)', font:{size:9,weight:'500',family:'Poppins'},
                                       backdropColor:'rgba(128,0,0,0.75)', backdropPadding:3, padding:6 }
                    }}
                }
            }),
            auLabels, auData
        );
    }

    // ── 7. Emotional Stability Index ─────────────────────
    const WINDOW = 10;
    const stabData = [], stabLabels = [];
    for (let i = WINDOW; i <= entries.length; i += WINDOW) {
        const win = entries.slice(i-WINDOW, i);
        let changes = 0;
        for (let j = 1; j < win.length; j++)
            if (win[j].label !== win[j-1].label) changes++;
        stabData.push(parseFloat(((1 - changes/(WINDOW-1)) * 100).toFixed(1)));
        stabLabels.push(win[win.length-1].timestamp);
    }

    if (stabData.length > 0) {
        const cur = stabData[stabData.length-1];
        setTextContent('stability-index', `${cur}% (${cur>70?'Stable':cur>40?'Moderate':'Labile'})`);

        stabilityChartInstance = updateOrCreate(
            stabilityChartInstance,
            () => new Chart(document.getElementById('stabilityChart').getContext('2d'), {
                type: 'line',
                data: { labels: stabLabels, datasets: [{
                    label:'Stability %', data:stabData, borderColor:'#aa55ff',
                    backgroundColor:'rgba(170,85,255,0.15)', borderWidth:2,
                    fill:true, tension:0.4, pointBackgroundColor:'#aa55ff', pointRadius:4
                }]},
                options: { responsive:true, maintainAspectRatio:false,
                    plugins: { legend: { display:false } },
                    scales: {
                        y: { beginAtZero:true, max:100, ...AXIS_STYLE,
                             ticks: { ...AXIS_STYLE.ticks, callback: v=>`${v}%` } },
                        x: { ...AXIS_STYLE }
                    }
                }
            }),
            stabLabels, stabData
        );
    }

    if (activePage === 'analysis' && isRunning)
        setTimeout(() => requestAnimationFrame(renderChart), 500);
}

// ─── ADD TO chart.js ──────────────────────────────────────
// Add this as a new chart section inside renderChart(),
// after the Emotional Stability block (section 7), before the final setTimeout

    // ── 8. Distance Over Time ─────────────────────────────
    if (distanceHistory.length > 0) {
        const dLabels = distanceHistory.map((_, i) => `#${i + 1}`);
        const dData   = distanceHistory.map(d => d.cm);
        const dColors = distanceHistory.map(d => d.zone?.color || '#ccc');

        const distCanvasEl = document.getElementById('distanceChart');
        if (distCanvasEl) {
            if (window.distanceChartInstance) {
                window.distanceChartInstance.data.labels           = dLabels;
                window.distanceChartInstance.data.datasets[0].data = dData;
                window.distanceChartInstance.data.datasets[0].pointBackgroundColor = dColors;
                window.distanceChartInstance.update('none');
            } else {
                window.distanceChartInstance = new Chart(distCanvasEl.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels  : dLabels,
                        datasets: [{
                            label               : 'Distance (cm)',
                            data                : dData,
                            borderColor         : '#55AAFF',
                            backgroundColor     : 'rgba(85,170,255,0.1)',
                            borderWidth         : 2,
                            fill                : true,
                            tension             : 0.4,
                            pointRadius         : 3,
                            pointBackgroundColor: dColors
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false },
                            annotation: {
                                annotations: {
                                    optimal: {
                                        type      : 'box',
                                        yMin      : 35, yMax: 80,
                                        backgroundColor: 'rgba(57,255,180,0.06)',
                                        borderColor    : 'rgba(57,255,180,0.25)',
                                        borderWidth    : 1,
                                        label: { display: true, content: 'Optimal Zone',
                                                 color: 'rgba(57,255,180,0.6)', font: { size: 9 } }
                                    }
                                }
                            }
                        },
                        scales: {
                            y: { beginAtZero: false, ...AXIS_STYLE,
                                 ticks: { ...AXIS_STYLE.ticks, callback: v => `${v}cm` } },
                            x: { ...AXIS_STYLE, ticks: { ...AXIS_STYLE.ticks, maxTicksLimit: 8 } }
                        }
                    }
                });
            }

            // Update meta below the chart
            const last = distanceHistory[distanceHistory.length - 1];
            const avg  = (distanceHistory.reduce((s, d) => s + d.cm, 0) / distanceHistory.length).toFixed(1);
            setTextContent('distance-current', last ? `${last.cm} cm  (${last.zone?.label})` : '--');
            setTextContent('distance-avg',     `${avg} cm`);
        }

        // toggle skeleton
        document.getElementById('distance-skeleton')?.classList.remove('visible');
    } else {
        document.getElementById('distance-skeleton')?.classList.add('visible');
        setTextContent('distance-current', '--');
        setTextContent('distance-avg',     '--');
    }

// ─── Also add 'distance-skeleton' to toggleSkeletonLoaders() ────────────────
// Find this line in chart.js:
//   ['emotion-skeleton','gantt-skeleton', ... ,'stability-skeleton']
// and add 'distance-skeleton' to the array.