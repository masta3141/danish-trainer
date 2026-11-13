// Stats tab: motivation line, key figures, learning calendar with detail
// charts (bars per day/month/year, progress curve), progress distribution,
// progress per level, text coverage and stories.
// Ported from the HSK Trainer (../chinese-trainer/js/stats.js); the HSK
// levels became A1–C1 and the SUBTLEX coverage became DSL corpus coverage
// (word field q = share of all running words, per million).
"use strict";

function pickMotivationMessage(streak, pct, learned){
  if (learned === 0) return t('motivationNone');
  if (streak >= 7) return tf('motivationStreak7', streak);
  if (streak >= 2) return tf('motivationStreak2', streak);
  if (pct >= 75) return tf('motivationPct75', pct);
  if (pct >= 25) return tf('motivationPct25', pct);
  return t('motivationDefault');
}

// Session-only view state: shown month (0 = current, -1 = previous, …) and
// the expanded detail panel below the calendar with the bar granularity.
var calendarState = { monthOffset: 0 };
var statsDetailState = { open: null, barGranularity: 'day' }; // open: null | 'bars' | 'curve'
var CAL_LOCALE = 'de-DE';

// Mastery bands, shared by the distribution bar, the level rows and the curve.
function masteryBands(){
  return [
    { label: t('bandNotStarted'), min: 0, max: 0, color: 'var(--hairline)' },
    { label: t('bandStarted'), min: 1, max: 24, color: levelToColor(12) },
    { label: t('bandOngoing'), min: 25, max: 49, color: levelToColor(37) },
    { label: t('bandAdvanced'), min: 50, max: 74, color: levelToColor(62) },
    { label: t('bandMastered'), min: 75, max: 100, color: levelToColor(90) }
  ];
}
function bandCounts(bands, words){
  var counts = bands.map(function(){ return 0; });
  words.forEach(function(w){
    var lvl = wordLvl(w.id);
    for (var i = 0; i < bands.length; i++) {
      if (lvl >= bands[i].min && lvl <= bands[i].max) { counts[i]++; break; }
    }
  });
  return counts;
}

// ---------- calendar ----------
// Heat bucket for a day's count: 0 = no activity, 1-4 = light..heavy.
function calHeatBucket(count){
  if (!count || count <= 0) return 0;
  if (count < 5) return 1;
  if (count < 10) return 2;
  if (count < 20) return 3;
  return 4;
}
function buildCalendarHtml(){
  var counts = loadDailyCounts();
  var activeDays = {};
  loadActivityDays().forEach(function(d){ activeDays[d] = true; });
  var now = new Date();
  var base = new Date(now.getFullYear(), now.getMonth() + calendarState.monthOffset, 1);
  var year = base.getFullYear();
  var month = base.getMonth();
  var monthTitle = base.toLocaleDateString(CAL_LOCALE, { month: 'long', year: 'numeric' });
  var todayKey = dateKeyForYMD(now.getFullYear(), now.getMonth(), now.getDate());

  // Monday-first weekday header; 2024-01-01 was a Monday.
  var weekdayFmt = new Intl.DateTimeFormat(CAL_LOCALE, { weekday: 'short' });
  var weekdaysHtml = [1, 2, 3, 4, 5, 6, 7].map(function(d){
    return '<div class="cal-weekday">' + esc(weekdayFmt.format(new Date(2024, 0, d))) + '</div>';
  }).join('');

  var startWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = Monday
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var cellsHtml = '';
  for (var i = 0; i < startWeekday; i++) cellsHtml += '<div class="cal-day cal-day-empty"></div>';
  for (var day = 1; day <= daysInMonth; day++) {
    var key = dateKeyForYMD(year, month, day);
    var count = counts[key] || 0;
    var bucket = calHeatBucket(count);
    if (bucket === 0 && activeDays[key]) bucket = 1;
    var cls = 'cal-day cal-heat-' + bucket + (key === todayKey ? ' cal-today' : '');
    var titleAttr = count > 0 ? tf('calCardsTooltip', count) : t('calNoActivityTooltip');
    cellsHtml +=
      '<div class="' + cls + '" title="' + esc(titleAttr) + '">' +
        '<span class="cal-day-num">' + day + '</span>' +
        (count > 0 ? '<span class="cal-day-count">' + count + '</span>' : '') +
      '</div>';
  }

  return (
    '<div class="stats-section-title">' + esc(t('calSectionTitle')) + '</div>' +
    '<div class="cal-widget" data-cal-widget>' +
      '<div class="cal-header">' +
        '<button class="cal-nav-btn" data-cal-prev aria-label="' + esc(t('calPrevMonth')) + '">‹</button>' +
        '<div class="cal-title">' + esc(monthTitle) + '</div>' +
        '<button class="cal-nav-btn" data-cal-next aria-label="' + esc(t('calNextMonth')) + '">›</button>' +
        '<div class="cal-detail-icons">' +
          '<button class="cal-icon-btn' + (statsDetailState.open === 'bars' ? ' active' : '') + '" data-cal-icon="bars" title="' + esc(t('calDetailListTitle')) + '">📊</button>' +
          '<button class="cal-icon-btn' + (statsDetailState.open === 'curve' ? ' active' : '') + '" data-cal-icon="curve" title="' + esc(t('calDetailChartTitle')) + '">📈</button>' +
        '</div>' +
      '</div>' +
      '<div class="cal-weekdays">' + weekdaysHtml + '</div>' +
      '<div class="cal-grid" data-cal-grid>' + cellsHtml + '</div>' +
      buildStatsDetailHtml() +
    '</div>'
  );
}

// ---------- detail panels (📊 bars, 📈 curve) ----------
function aggregateDailyCounts(granularity){
  var counts = loadDailyCounts();
  var now = new Date();
  var buckets = [];
  if (granularity === 'month') {
    var monthFmt = new Intl.DateTimeFormat(CAL_LOCALE, { month: 'short' });
    for (var m = 11; m >= 0; m--) {
      var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      var prefix = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      var sum = 0;
      Object.keys(counts).forEach(function(k){ if (k.indexOf(prefix) === 0) sum += counts[k]; });
      buckets.push({ label: monthFmt.format(d), value: sum });
    }
  } else if (granularity === 'year') {
    var years = {};
    Object.keys(counts).forEach(function(k){ years[k.slice(0, 4)] = true; });
    years[String(now.getFullYear())] = true;
    Object.keys(years).sort().forEach(function(y){
      var sum = 0;
      Object.keys(counts).forEach(function(k){ if (k.indexOf(y) === 0) sum += counts[k]; });
      buckets.push({ label: y, value: sum });
    });
  } else { // 'day': the last 14 days including today
    var dayFmt = new Intl.DateTimeFormat(CAL_LOCALE, { day: 'numeric', month: 'numeric' });
    for (var i = 13; i >= 0; i--) {
      var dd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push({ label: dayFmt.format(dd), value: counts[dateKeyForYMD(dd.getFullYear(), dd.getMonth(), dd.getDate())] || 0 });
    }
  }
  return buckets;
}
function buildBarsDetailHtml(){
  var buckets = aggregateDailyCounts(statsDetailState.barGranularity);
  var max = Math.max.apply(null, buckets.map(function(b){ return b.value; }).concat([1]));
  var hasAny = buckets.some(function(b){ return b.value > 0; });
  var barsHtml = buckets.map(function(b){
    var pct = Math.max(2, Math.round(b.value / max * 100));
    return '<div class="cal-bar-col">' +
        '<div class="cal-bar-value">' + (b.value > 0 ? b.value : '') + '</div>' +
        '<div class="cal-bar-track"><div class="cal-bar-fill" style="height:' + pct + '%;"></div></div>' +
        '<div class="cal-bar-label">' + esc(b.label) + '</div>' +
      '</div>';
  }).join('');
  var granOpts = ['day', 'month', 'year'].map(function(g){
    var lbl = g === 'day' ? t('calGranDay') : (g === 'month' ? t('calGranMonth') : t('calGranYear'));
    return '<button class="cal-gran-btn' + (statsDetailState.barGranularity === g ? ' selected' : '') + '" data-cal-gran="' + g + '">' + esc(lbl) + '</button>';
  }).join('');
  return '<div class="cal-detail-panel">' +
      '<div class="cal-detail-head">' +
        '<span class="cal-detail-title">' + esc(t('calBarsTitle')) + '</span>' +
        '<button class="cal-detail-close" data-cal-close aria-label="' + esc(t('calCloseDetail')) + '">✕</button>' +
      '</div>' +
      '<div class="cal-gran-row">' + granOpts + '</div>' +
      (hasAny
        ? '<div class="cal-bars-row">' + barsHtml + '</div>'
        : '<div class="empty-note" style="padding:10px 0;">' + esc(t('calBarsNoData')) + '</div>') +
    '</div>';
}
// When exactly a word was first learned is not recorded, so the curve spreads
// today's number of learned words over the practice days, weighted by how
// many cards were rated that day.
function buildEstimatedProgressSeries(){
  var counts = loadDailyCounts();
  var allKeys = {};
  loadActivityDays().forEach(function(d){ allKeys[d] = true; });
  Object.keys(counts).forEach(function(d){ allKeys[d] = true; });
  allKeys[todayStr()] = true;
  var days = Object.keys(allKeys).sort();
  var weights = days.map(function(d){ return counts[d] || 1; });
  var totalWeight = weights.reduce(function(a, b){ return a + b; }, 0) || 1;
  var bands = masteryBands();
  var bc = bandCounts(bands, WORDS);
  var learnedTotal = WORDS.length - bc[0];
  var cum = 0;
  var series = days.map(function(d, i){
    cum += weights[i];
    return { date: d, value: Math.round(learnedTotal * cum / totalWeight) };
  });
  if (series.length) series[series.length - 1].value = learnedTotal;
  return { series: series, ceiling: WORDS.length, bands: bands, counts: bc, learnedTotal: learnedTotal };
}
// Cumulative word count at the end of each level: [{level: 'A1', upTo: 500}, …]
function levelThresholds(){
  var cum = 0;
  return LEVELS.map(function(l){ cum += LEVEL_COUNTS[l]; return { level: l, upTo: cum }; });
}
function buildCurveDetailHtml(){
  var data = buildEstimatedProgressSeries();
  var W = 300, H = 130, PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 6;
  var innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  var ceiling = data.ceiling || 1;
  // Today's value sits at 75% height, so early progress is visible; level
  // lines above the visible range are left out.
  var visualMax = Math.min(ceiling, Math.max(data.learnedTotal / 0.75, 1));
  function yFor(v){ return PAD_T + innerH - (Math.max(0, Math.min(v, visualMax)) / visualMax) * innerH; }
  var n = data.series.length;
  function xFor(i){ return n <= 1 ? PAD_L : PAD_L + (i / (n - 1)) * innerW; }
  var linePts = data.series.map(function(p, i){ return xFor(i) + ',' + yFor(p.value); }).join(' ');
  var areaPts = linePts + ' ' + xFor(n - 1) + ',' + (PAD_T + innerH) + ' ' + xFor(0) + ',' + (PAD_T + innerH);

  // Colour bands under the curve: today's split into started/ongoing/advanced/mastered.
  var c = data.counts, from = 0;
  var bandRectsHtml = [1, 2, 3, 4].map(function(i){
    var to = from + c[i];
    var html = '';
    if (to > from) {
      var yTop = yFor(to), yBot = yFor(from);
      html = '<rect x="' + PAD_L + '" y="' + yTop + '" width="' + innerW + '" height="' + Math.max(0, yBot - yTop) + '" fill="' + data.bands[i].color + '" clip-path="url(#calCurveClip)"></rect>';
    }
    from = to;
    return html;
  }).join('');
  var levelLinesHtml = levelThresholds().map(function(lv){
    if (lv.upTo > visualMax) return '';
    var y = yFor(lv.upTo);
    if (y < PAD_T + 1) return '';
    return '<line x1="' + PAD_L + '" y1="' + y + '" x2="' + (PAD_L + innerW) + '" y2="' + y + '" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="2,3" opacity="0.9"></line>' +
      '<text x="' + (PAD_L + innerW - 2) + '" y="' + (y - 2) + '" text-anchor="end" font-size="7" fill="var(--ink-faint)">' + esc(lv.level) + '</text>';
  }).join('');
  var fmtDate = function(d){ return new Date(d).toLocaleDateString(CAL_LOCALE, { day: 'numeric', month: 'short' }); };
  var startLabel = n ? fmtDate(data.series[0].date) : '';
  var todayLabel = n ? fmtDate(data.series[n - 1].date) : '';

  var svg =
    '<svg class="cal-curve-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<defs><clipPath id="calCurveClip"><polygon points="' + areaPts + '"></polygon></clipPath></defs>' +
      '<rect x="' + PAD_L + '" y="' + PAD_T + '" width="' + innerW + '" height="' + innerH + '" fill="var(--hairline)" opacity="0.35"></rect>' +
      bandRectsHtml + levelLinesHtml +
      '<polyline points="' + linePts + '" fill="none" stroke="var(--ink)" stroke-width="2"></polyline>' +
    '</svg>';
  return '<div class="cal-detail-panel">' +
      '<div class="cal-detail-head">' +
        '<span class="cal-detail-title">' + esc(t('calCurveTitle')) + '</span>' +
        '<button class="cal-detail-close" data-cal-close aria-label="' + esc(t('calCloseDetail')) + '">✕</button>' +
      '</div>' +
      '<div class="cal-curve-ceiling">' + esc(tf('calCurveCeilingLabel', ceiling)) + '</div>' +
      svg +
      '<div class="cal-curve-axis"><span>' + esc(startLabel) + '</span><span>' + esc(todayLabel) + '</span></div>' +
      '<p class="drawer-note" style="margin-top:6px;">' + esc(t('calCurveEstimateNote')) + '</p>' +
    '</div>';
}
function buildStatsDetailHtml(){
  if (statsDetailState.open === 'bars') return buildBarsDetailHtml();
  if (statsDetailState.open === 'curve') return buildCurveDetailHtml();
  return '';
}

function wireStatsHandlers(root){
  var widget = root.querySelector('[data-cal-widget]');
  if (!widget) return;
  widget.querySelector('[data-cal-prev]').onclick = function(){ calendarState.monthOffset -= 1; renderStatsTab(); };
  widget.querySelector('[data-cal-next]').onclick = function(){ calendarState.monthOffset += 1; renderStatsTab(); };
  Array.prototype.forEach.call(widget.querySelectorAll('[data-cal-icon]'), function(btn){
    btn.onclick = function(){
      var which = btn.getAttribute('data-cal-icon');
      statsDetailState.open = statsDetailState.open === which ? null : which;
      renderStatsTab();
    };
  });
  var closeBtn = widget.querySelector('[data-cal-close]');
  if (closeBtn) closeBtn.onclick = function(){ statsDetailState.open = null; renderStatsTab(); };
  Array.prototype.forEach.call(widget.querySelectorAll('[data-cal-gran]'), function(btn){
    btn.onclick = function(){ statsDetailState.barGranularity = btn.getAttribute('data-cal-gran'); renderStatsTab(); };
  });
  // Horizontal swipe on the day grid: left = next month, right = previous.
  var grid = widget.querySelector('[data-cal-grid]');
  var sx = null, sy = null;
  grid.addEventListener('touchstart', function(e){
    if (!e.touches || !e.touches.length) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  grid.addEventListener('touchend', function(e){
    if (sx === null) return;
    var p = e.changedTouches && e.changedTouches[0];
    var dx = (p ? p.clientX : sx) - sx, dy = (p ? p.clientY : sy) - sy;
    sx = sy = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      calendarState.monthOffset += dx < 0 ? 1 : -1;
      renderStatsTab();
    }
  }, { passive: true });
}

// ---------- the tab ----------
function renderStatsTab(){
  var root = document.getElementById('statsView');
  if (!root) return;
  var total = WORDS.length;
  var learnedWords = WORDS.filter(function(w){ return wordLvl(w.id) > 0; });
  var learned = learnedWords.length;
  var mastered = WORDS.filter(function(w){ return wordLvl(w.id) >= 40; }).length;
  var streak = computeStreak();
  var learnedPct = total ? Math.round(learned / total * 100) : 0;

  var bands = masteryBands();
  var counts = bandCounts(bands, WORDS);
  var barHtml = bands.map(function(b, i){
    return '<div class="seg" style="width:' + (total ? counts[i] / total * 100 : 0) + '%;background:' + b.color + ';"></div>';
  }).join('');
  var legendHtml = bands.map(function(b, i){
    return '<span><span class="lg-dot" style="background:' + b.color + '"></span>' + esc(b.label) + ' (' + counts[i] + ')</span>';
  }).join('');

  // One row per level: a segmented bar with the share of each mastery band.
  var levelRowsHtml = LEVELS.map(function(l){
    var inLevel = WORDS.filter(function(w){ return w.l === l; });
    var lc = bandCounts(bands, inLevel);
    var segHtml = bands.map(function(b, i){
      if (i === 0 || !inLevel.length || !lc[i]) return '';
      return '<span class="lvlp-bar-seg" style="width:' + (lc[i] / inLevel.length * 100) + '%;background:' + b.color + ';" title="' + esc(b.label + ': ' + lc[i]) + '"></span>';
    }).join('');
    return '<div class="lvlp-row">' +
      '<span class="lvlp-name"><span class="lvl lvl-' + l + '">' + l + '</span></span>' +
      '<span class="lvlp-bar-track">' + segHtml + '</span>' +
      '<span class="lvlp-count">' + (inLevel.length - lc[0]) + ' / ' + inLevel.length + '</span>' +
    '</div>';
  }).join('');

  // Text coverage: share of all running words in the DSL corpus (q = per
  // million) that the learned words make up — names and numbers included in
  // the corpus, so even all 5000 words stay below 100%.
  var sumQ = function(list){ return list.reduce(function(a, w){ return a + (w.q || 0); }, 0) / 1e4; };
  var coveragePct = sumQ(learnedWords);
  var coverageMax = sumQ(WORDS);
  var nextWords = WORDS.filter(function(w){ return wordLvl(w.id) === 0; }).slice(0, 8); // ids follow frequency
  var nextWordsHtml = nextWords.length
    ? nextWords.map(function(w){
        return '<div class="freq-word-row" data-wid="' + w.id + '">' +
          '<span class="freq-word-h">' + esc(wordWithArticle(w)) + '</span>' +
          '<span class="freq-word-p">' + esc(w.l) + '</span>' +
          '<span class="freq-word-e">' + esc(w.e) + '</span>' +
        '</div>';
      }).join('')
    : '<div class="empty-note" style="padding:12px 0;">' + esc(t('nextWordsEmpty')) + '</div>';

  root.innerHTML =
    '<div class="stats-wrap">' +
      '<h2 style="margin:0 0 14px;font-size:16px;">' + esc(t('statsTitle')) + '</h2>' +
      '<div class="stats-motivation">' + esc(pickMotivationMessage(streak, learnedPct, learned)) + '</div>' +
      '<div class="stat-cards">' +
        '<div class="stat-card streak"><div class="stat-value">' + streak + '<span class="unit">' + esc(t('streakDaysLabel')) + '</span></div><div class="stat-label">' + esc(t('streakSub')) + '</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + learnedPct + '<span class="unit">%</span></div><div class="stat-label">' + esc(tf('learnedOf', learned, total)) + '</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + mastered + '</div><div class="stat-label">' + esc(t('masteredLabel')) + '</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + loadTotalRatings() + '</div><div class="stat-label">' + esc(t('totalRatingsLabel')) + '</div></div>' +
      '</div>' +
      buildCalendarHtml() +
      '<div class="stats-section-title">' + esc(t('distributionTitle')) + '</div>' +
      '<div class="level-dist-bar">' + barHtml + '</div>' +
      '<div class="level-dist-legend">' + legendHtml + '</div>' +
      '<div class="stats-section-title">' + esc(t('levelProgressTitle')) + '</div>' +
      levelRowsHtml +
      '<div class="stats-section-title">' + esc(t('freqSectionTitle')) + '</div>' +
      '<div class="stat-cards">' +
        '<div class="stat-card" id="statCoverage"><div class="stat-value">' + coveragePct.toFixed(1) + '<span class="unit">%</span></div><div class="stat-label">' + esc(t('freqCoverageWords')) + '</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + coverageMax.toFixed(0) + '<span class="unit">%</span></div><div class="stat-label">' + esc(t('freqCoverageMax')) + '</div></div>' +
      '</div>' +
      '<p class="drawer-note" style="margin:-10px 0 16px;">' + esc(t('freqNote')) + '</p>' +
      '<div class="stats-section-title">' + esc(t('nextWordsTitle')) + '</div>' +
      '<p style="font-size:12px;color:var(--ink-faint);margin:0 0 10px;">' + esc(t('nextWordsDesc')) + '</p>' +
      nextWordsHtml +
      '<div class="stats-section-title">' + esc(t('storiesStatsTitle')) + '</div>' +
      '<div class="stat-cards">' +
        '<div class="stat-card"><div class="stat-value">' + sentencesRead + '</div><div class="stat-label">' + esc(t('storiesSentencesReadLabel')) + '</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + stories.length + '</div><div class="stat-label">' + esc(t('storiesSavedLabel')) + '</div></div>' +
      '</div>' +
    '</div>';
  wireStatsHandlers(root);
  // Tap a suggested word: its info + pronunciation (as in the vocabulary grid).
  Array.prototype.forEach.call(root.querySelectorAll('.freq-word-row[data-wid]'), function(row){
    row.onclick = function(){
      var w = WORD_BY_ID[row.getAttribute('data-wid')];
      showWordToast(w); speak(w.w);
    };
  });
}
