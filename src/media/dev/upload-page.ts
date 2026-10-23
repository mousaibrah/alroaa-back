// Dev-only helper served at GET /upload-test (never in production): a file
// picker that does presign -> PUT straight to storage -> confirm -> poll, so
// uploads can be tried without curl. The bytes still never pass through the API.
export const UPLOAD_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Upload test</title>
<style>
  body{font:15px system-ui;max-width:640px;margin:2rem auto;padding:0 1rem}
  textarea,input[type=text]{width:100%;box-sizing:border-box}
  pre{background:#f4f4f4;padding:.75rem;overflow:auto;white-space:pre-wrap;word-break:break-all}
  img,video{max-width:100%;margin-top:.5rem}
  label{display:block;margin:.6rem 0 .2rem}
</style>
<h2>Upload test (dev only)</h2>
<label>Access token (the same one you pass to Swagger "Authorize")</label>
<textarea id="token" rows="3"></textarea>
<label>File (image or video)</label>
<input type="file" id="file" accept="image/*,video/*">
<label><input type="checkbox" id="priv"> Private (required for videos in non-preview lessons)</label>
<p><button id="go">Upload</button></p>
<pre id="log"></pre>
<div id="preview"></div>
<script>
const $ = (id) => document.getElementById(id);
const log = (m) => ($('log').textContent += m + '\\n');
$('token').value = localStorage.getItem('uploadTestToken') || '';
$('go').onclick = async () => {
  $('log').textContent = ''; $('preview').innerHTML = '';
  const file = $('file').files[0];
  const token = $('token').value.trim().replace(/^Bearer\\s+/i, '');
  if (!file || !token) return log('Pick a file and paste a token.');
  localStorage.setItem('uploadTestToken', token);
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const call = async (path, init) => {
    const r = await fetch(path, { ...init, headers: auth });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(body));
    return body;
  };
  try {
    const p = await call('/media/presign', { method: 'POST', body: JSON.stringify({
      filename: file.name, mimeType: file.type, size: file.size, isPrivate: $('priv').checked }) });
    log('1. presigned, mediaId = ' + p.mediaId);
    const put = await fetch(p.url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!put.ok) throw new Error('PUT to storage failed: ' + put.status);
    log('2. uploaded to storage');
    await call('/media/' + p.mediaId + '/confirm', { method: 'POST' });
    log('3. confirmed, processing...');
    for (let i = 0; i < 120; i++) {
      const m = await call('/media/' + p.mediaId, { method: 'GET' });
      log('   status: ' + m.status);
      if (m.status === 'failed') throw new Error(m.failureReason);
      if (m.status === 'ready') {
        log('4. ready. Use this in PATCH /lessons/{id}:\\n   {"contentMediaId": "' + m.id + '"}');
        const url = m.type === 'video' ? (m.urls.mp4 || m.urls.original) : (m.urls.medium || m.urls.original);
        $('preview').innerHTML = m.type === 'video'
          ? '<video controls src="' + url + '" poster="' + m.thumbnailUrl + '"></video>'
          : '<img src="' + url + '">';
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    log('Still processing; check GET /media/' + p.mediaId);
  } catch (e) { log('ERROR: ' + e.message); }
};
</script>`;
