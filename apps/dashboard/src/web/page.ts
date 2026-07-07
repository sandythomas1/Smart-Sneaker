/**
 * The dashboard's single-page shell: a deliberately small, dependency-free
 * HTML+JS view over the authenticated JSON API (Req. 19-20). It holds no data
 * of its own — every number it shows came through the server-side access
 * checks, and the browser only renders via textContent (no HTML built from
 * data, so API values can never execute as markup).
 *
 * PoC surface: a Firebase-ID-token paste box stands in for a sign-in flow.
 * Revisit (real Firebase Auth login, framework, charts) when the dashboard
 * grows beyond the single-builder cohort.
 */
export const DASHBOARD_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Sneaker — Dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #ddd; font-size: .9rem; }
  .muted { color: #777; } .flag { color: #b00; font-weight: 600; }
  .unreliable { color: #999; font-style: italic; }
  #token { width: 26rem; max-width: 100%; }
  button { margin-left: .5rem; }
  li { cursor: pointer; text-decoration: underline; margin: .2rem 0; }
  #error { color: #b00; margin-top: 1rem; }
</style>
</head>
<body>
<h1>Smart Sneaker — Dashboard</h1>
<p class="muted">Paste your ID token to load your data. Athletes see their own sessions and trends; coaches see athletes who have shared with them.</p>
<div>
  <input id="token" type="password" placeholder="Firebase ID token" autocomplete="off">
  <button id="load">Load</button>
</div>
<div id="error"></div>
<div id="content"></div>
<script>
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let token = '';

  async function api(path) {
    const response = await fetch(path, { headers: { authorization: 'Bearer ' + token } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || ('request failed (' + response.status + ')'));
    return body;
  }

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const fmtTime = (ms) => ms === undefined ? '—' : new Date(ms).toLocaleString();

  function renderInsights(parent, result) {
    if (result.status !== 'processed' || !result.insights) {
      parent.appendChild(el('p', 'This session could not be processed: ' + (result.failureReason || 'unknown reason'), 'flag'));
      return;
    }
    const table = el('table');
    const head = el('tr');
    for (const h of ['Insight', 'Foot', 'Value', 'Confidence', 'Note']) head.appendChild(el('th', h));
    table.appendChild(head);
    for (const insight of result.insights.insights) {
      const row = el('tr', undefined, insight.reliable ? '' : 'unreliable');
      row.appendChild(el('td', insight.kind));
      row.appendChild(el('td', insight.foot || '—'));
      row.appendChild(el('td', String(insight.value) + (insight.unit ? ' ' + insight.unit : '')));
      row.appendChild(el('td', Math.round(insight.confidence * 100) + '%' + (insight.reliable ? '' : ' (unreliable)')));
      row.appendChild(el('td', insight.note || ''));
      table.appendChild(row);
    }
    parent.appendChild(table);
    if (result.flaggedForReview) parent.appendChild(el('p', 'Flagged for review: on-phone and cloud results disagree beyond tolerance.', 'flag'));
  }

  function renderTrends(parent, trends) {
    parent.appendChild(el('h2', 'Trends across sessions'));
    if (trends.length === 0) { parent.appendChild(el('p', 'No processed sessions yet.', 'muted')); return; }
    for (const series of trends) {
      parent.appendChild(el('h2', series.kind + (series.foot ? ' (' + series.foot + ')' : '') + (series.unit ? ', ' + series.unit : '')));
      const table = el('table');
      const head = el('tr');
      for (const h of ['When', 'Value', 'Confidence']) head.appendChild(el('th', h));
      table.appendChild(head);
      for (const point of series.points) {
        const row = el('tr', undefined, point.reliable ? '' : 'unreliable');
        row.appendChild(el('td', fmtTime(point.atMs)));
        row.appendChild(el('td', String(point.value)));
        row.appendChild(el('td', Math.round(point.confidence * 100) + '%' + (point.reliable ? '' : ' (unreliable)')));
        table.appendChild(row);
      }
      parent.appendChild(table);
    }
  }

  async function showAthlete(container, athleteId) {
    const [sessionsBody, trendsBody] = await Promise.all([
      api('/v1/athletes/' + encodeURIComponent(athleteId) + '/sessions'),
      api('/v1/athletes/' + encodeURIComponent(athleteId) + '/trends'),
    ]);
    container.appendChild(el('h2', 'Sessions'));
    if (sessionsBody.sessions.length === 0) container.appendChild(el('p', 'No sessions yet.', 'muted'));
    const list = el('ul');
    for (const session of sessionsBody.sessions) {
      const item = el('li', fmtTime(session.sessionStartedAtMs ?? session.processedAtMs) + ' — ' + session.status + (session.flaggedForReview ? ' (flagged)' : ''));
      const detail = el('div');
      item.addEventListener('click', async () => {
        detail.textContent = 'Loading…';
        try {
          const body = await api('/v1/athletes/' + encodeURIComponent(athleteId) + '/sessions/' + encodeURIComponent(session.sessionId));
          detail.textContent = '';
          renderInsights(detail, body.result);
        } catch (error) { detail.textContent = error.message; }
      });
      list.appendChild(item);
      list.appendChild(detail);
    }
    container.appendChild(list);
    renderTrends(container, trendsBody.trends);
  }

  async function load() {
    $('error').textContent = '';
    const content = $('content');
    content.textContent = '';
    token = $('token').value.trim();
    try {
      const me = await api('/v1/me');
      content.appendChild(el('p', 'Signed in as ' + me.userId + ' (' + me.role + ')', 'muted'));
      if (me.role === 'coach') {
        const roster = await api('/v1/coach/athletes');
        content.appendChild(el('h2', 'Athletes who shared with you'));
        if (roster.athletes.length === 0) content.appendChild(el('p', 'No athletes have shared with you yet.', 'muted'));
        const list = el('ul');
        for (const entry of roster.athletes) {
          const item = el('li', entry.athleteId);
          const detail = el('div');
          item.addEventListener('click', async () => {
            detail.textContent = '';
            try { await showAthlete(detail, entry.athleteId); }
            catch (error) { detail.textContent = error.message; }
          });
          list.appendChild(item);
          list.appendChild(detail);
        }
        content.appendChild(list);
      } else {
        await showAthlete(content, me.userId);
      }
    } catch (error) {
      $('error').textContent = error.message;
    }
  }

  $('load').addEventListener('click', load);
})();
</script>
</body>
</html>
`;
