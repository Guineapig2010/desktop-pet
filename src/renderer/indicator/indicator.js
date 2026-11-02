const api = window.buddy;
const $ = (id) => document.getElementById(id);
function render(s) {
  $('title').textContent = s.sharing ? `General Fok can see: ${s.sourceName}` : 'Not sharing';
  $('activity').textContent = s.busy ? s.activity || 'Working… (Esc to stop)' : s.live ? 'Live assistance: every chat message includes a screenshot' : 'Only sent when you ask · Esc stops him';
  $('live').classList.toggle('on', !!s.live);
  $('cancel').style.display = s.busy ? 'inline-block' : 'none';
}
$('stop').addEventListener('click', () => api.helperStop());
$('cancel').addEventListener('click', () => api.helperCancel());
api.onHelperStatus(render);
api.helperState().then(render);
  
