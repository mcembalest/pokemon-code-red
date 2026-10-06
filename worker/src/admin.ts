// Private admin page. Static HTML; all data comes from /admin/api/* with the admin token.
export const adminPage = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Code Red Admin</title>
<style>
:root{--bg:#f6f4ef;--fg:#1d1b18;--mut:#6b665d;--line:#d9d4c8;--acc:#c0392b;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece8df;--mut:#9a948a;--line:#34312c;--acc:#e0604f;--card:#1f1d1a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:18px;margin:0 0 12px}h1 b{color:var(--acc)}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:24px 0 8px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-weight:600;color:var(--mut);font-size:12px}tr.sel{background:color-mix(in srgb,var(--acc) 10%,transparent)}tbody tr{cursor:pointer}
input,button{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button{background:var(--acc);color:#fff;border-color:var(--acc);cursor:pointer}form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
code{font:12px ui-monospace,monospace}.mut{color:var(--mut)}#err{color:var(--acc)}td.data{white-space:normal;max-width:480px;word-break:break-word}
</style></head><body><main>
<h1>Pokémon <b>Code Red</b> · admin</h1>
<form id="login"><input id="tok" type="password" placeholder="ADMIN_TOKEN" autocomplete="off" size="30"><button>Unlock</button><span id="err"></span></form>
<div id="app" hidden>
<h2>Players</h2><section><table id="players"></table></section>
<h2 id="evh">Recent events</h2><section><table id="events"></table></section>
<h2>Invites</h2><section>
<form id="mk"><input id="n" type="number" min="1" max="50" value="1" style="width:5em"> codes ×
<input id="uses" type="number" min="1" value="1" style="width:5em"> uses, note <input id="note" placeholder="who for"><button>Create</button></form>
<p id="new" class="mut"></p><table id="invites"></table></section>
</div></main>
<script>
let token = ''; try { token = sessionStorage.getItem('cr-admin') || ''; } catch {}
let player = null;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hms = (s) => s == null ? '' : Math.floor(s / 3600) + 'h ' + String(Math.floor(s / 60) % 60).padStart(2, '0') + 'm';
const party = (p) => { try { const a = typeof p === 'string' ? JSON.parse(p) : p; return Array.isArray(a) && a.length ? 'Lv ' + a.join(', ') : '' } catch { return '' } };
const SITE = 'https://maxcembalest.com/pokemon-code-red?invite=';
const when = (t) => t ? new Date(t).toLocaleString() : '';
async function api(path, opts = {}) {
  const r = await fetch('/admin/api/' + path, { ...opts, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
function table(el, cols, rows, onclick) {
  el.innerHTML = '<thead><tr>' + cols.map((c) => '<th>' + esc(c[0]) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r, i) => '<tr data-i="' + i + '"' + (onclick && r.id === player ? ' class="sel"' : '') + '>' +
      cols.map((c) => '<td' + (c[2] ? ' class="' + c[2] + '"' : '') + '>' + esc(c[1](r)) + '</td>').join('') + '</tr>').join('') + '</tbody>';
  if (onclick) el.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => onclick(rows[+tr.dataset.i]));
}
async function load() {
  const [{ players }, { events }, { invites }] = await Promise.all([api('players'), api('events?limit=200' + (player ? '&player=' + player : '')), api('invites')]);
  table($('#players'), [['Name', (r) => r.name], ['Joined', (r) => when(r.created_at)], ['Last seen', (r) => when(r.last_seen)],
    ['Badges', (r) => r.badges ?? ''], ['Play time', (r) => hms(r.play_s)], ['Where', (r) => r.place ?? ''], ['Party', (r) => party(r.party)], ['Events', (r) => r.events], ['Last event', (r) => r.last_event], ['Agent calls', (r) => r.llm_calls], ['Tokens', (r) => r.llm_tokens], ['Invite', (r) => r.invite]],
    players, (r) => { player = player === r.id ? null : r.id; $('#evh').textContent = player ? 'Events · ' + r.name : 'Recent events'; load(); });
  table($('#events'), [['When', (r) => when(r.at)], ['Player', (r) => r.name], ['Kind', (r) => r.kind], ['Where', (r) => r.place ?? ''], ['Data', (r) => r.data, 'data']], events);
  table($('#invites'), [['Code', (r) => r.code], ['Link', (r) => r.revoked || r.uses >= r.max_uses ? '' : SITE + r.code], ['Uses', (r) => r.uses + '/' + r.max_uses], ['Note', (r) => r.note], ['Created', (r) => when(r.created_at)], ['Revoked', (r) => r.revoked ? 'yes' : '']], invites);
}
async function unlock() {
  try { await load(); $('#app').hidden = false; $('#login').hidden = true; try { sessionStorage.setItem('cr-admin', token); } catch {} }
  catch (e) { $('#err').textContent = e.message; }
}
$('#login').onsubmit = (e) => { e.preventDefault(); token = $('#tok').value.trim(); unlock(); };
$('#mk').onsubmit = async (e) => {
  e.preventDefault();
  const { codes } = await api('invites', { method: 'POST', body: JSON.stringify({ count: +$('#n').value, max_uses: +$('#uses').value, note: $('#note').value || null }) });
  $('#new').innerHTML = 'New (send the link): ' + codes.map((c) => '<br><code>' + esc(SITE + c) + '</code>').join('');
  load();
};
if (token) unlock();
</script></body></html>`;
