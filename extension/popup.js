const toggle = document.getElementById('enabled');
const status = document.getElementById('status');
function describe() { status.textContent = toggle.checked ? '已开启 · Keep 页面自动生效' : '已关闭 · 显示原始文字'; }
chrome.storage.local.get({ enabled: true }).then(settings => {
  toggle.checked = settings.enabled !== false;
  toggle.disabled = false;
  describe();
}).catch(() => { status.textContent = '无法读取设置，请重新加载扩展。'; });
toggle.addEventListener('change', async () => {
  toggle.disabled = true;
  try { await chrome.storage.local.set({ enabled: toggle.checked }); describe(); }
  catch { toggle.checked = !toggle.checked; status.textContent = '设置未保存，请重试。'; }
  finally { toggle.disabled = false; }
});
