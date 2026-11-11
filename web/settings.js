const form = document.querySelector('#settings-form');
const status = document.querySelector('#settings-status');
const currentStatus = document.querySelector('#current-setting-status');
const modes = [...document.querySelectorAll('input[name="api-mode"]')];
const urlInput = document.querySelector('#settings-url');
const modelInput = document.querySelector('#settings-model');
const keyInput = document.querySelector('#settings-key');

function selectedMode() { return modes.find((item) => item.checked).value; }
function render() {
  status.hidden = true;
}
modes.forEach((item) => item.addEventListener('change', render));

const savedMode = sessionStorage.getItem('gogogo-api-mode');
if (savedMode === 'invite') modes.find((item) => item.value === 'invite').checked = true;
urlInput.value = sessionStorage.getItem('gogogo-own-api-url') || urlInput.value;
modelInput.value = sessionStorage.getItem('gogogo-own-model') || '';
if (sessionStorage.getItem('gogogo-own-api-key')) keyInput.placeholder = '已保存 Key；留空表示继续使用';
render();

async function showCurrentStatus() {
  const token = sessionStorage.getItem('gogogo-trial-token');
  if (!token) { currentStatus.textContent = '当前状态：尚未配置'; return; }
  const mode = sessionStorage.getItem('gogogo-api-mode');
  const headers = { Authorization: `Bearer ${token}` };
  if (mode === 'own') {
    const key = sessionStorage.getItem('gogogo-own-api-key');
    const url = sessionStorage.getItem('gogogo-own-api-url');
    const model = sessionStorage.getItem('gogogo-own-model');
    if (!key || !url || !model) { currentStatus.textContent = '当前状态：自带 API 配置不完整'; return; }
    Object.assign(headers, { 'X-Model-Api-Key': key, 'X-Model-Api-Url': url, 'X-Model-Name': model });
  }
  try {
    const response = await fetch('/api/auth/status', { headers });
    const payload = await response.json();
    currentStatus.textContent = response.ok && payload.data?.configured
      ? `当前状态：已配置 · ${mode === 'own' ? `自带 API / ${modelInput.value}` : '邀请码模式'}`
      : '当前状态：需要重新设置';
  } catch { currentStatus.textContent = '当前状态：暂时无法连接服务'; }
}
showCurrentStatus();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const mode = selectedMode();
  const code = document.querySelector('#settings-invite').value.trim();
  const apiUrl = urlInput.value.trim();
  const model = modelInput.value.trim();
  const apiKey = keyInput.value.trim() || sessionStorage.getItem('gogogo-own-api-key');
  if (mode === 'invite' && !code) { status.textContent = '请输入邀请码'; status.hidden = false; return; }
  if (mode === 'own' && (!apiUrl || !model || !apiKey)) {
    status.textContent = '请填写接口 URL、模型 ID 和 API Key'; status.hidden = false; return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch(mode === 'own' ? '/api/auth/own' : '/api/auth/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mode === 'own' ? { apiUrl, model, apiKey } : { code }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error?.message || '设置失败');
    sessionStorage.setItem('gogogo-trial-token', payload.data.token);
    sessionStorage.setItem('gogogo-api-mode', mode);
    if (mode === 'own') {
      sessionStorage.setItem('gogogo-own-api-key', apiKey);
      sessionStorage.setItem('gogogo-own-api-url', apiUrl);
      sessionStorage.setItem('gogogo-own-model', model);
    } else {
      sessionStorage.removeItem('gogogo-own-api-key');
      sessionStorage.removeItem('gogogo-own-api-url');
      sessionStorage.removeItem('gogogo-own-model');
    }
    window.location.assign('./explore.html');
  } catch (error) {
    status.textContent = error.message || '设置失败，请重试';
    status.hidden = false;
    button.disabled = false;
  }
});
