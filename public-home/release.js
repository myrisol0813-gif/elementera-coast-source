'use strict';
// Keep a verified stable fallback in the HTML. Never substitute a draft,
// disposable QA APK, arbitrary URL, or another repository's release.
(async () => {
  const repo = 'myrisol0813-gif/elementera-coast-source';
  const prefix = 'https://github.com/' + repo + '/releases/';
  try {
    const response = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', {credentials:'omit',cache:'no-cache'});
    if (!response.ok) return;
    const data = await response.json();
    const match = /^source-native-v(\d+\.\d+\.\d+)-[a-f0-9]{40}$/.exec(data.tag_name || '');
    if (!match || data.draft || data.prerelease || !Array.isArray(data.assets)) return;
    const version = match[1];
    const downloadRoot = prefix+'download/'+data.tag_name+'/';
    const filename = 'elementera-coast-source-v'+version+'-release.apk';
    const apk = data.assets.find(a => a.name===filename && a.browser_download_url===downloadRoot+filename && Number.isFinite(a.size) && a.size>0);
    const digest = data.assets.find(a => a.name==='SHA256SUMS.txt' && a.browser_download_url===downloadRoot+'SHA256SUMS.txt');
    if (!apk || !digest) return;
    document.getElementById('apk').href = apk.browser_download_url;
    document.getElementById('release').href = prefix+'tag/'+data.tag_name;
    document.getElementById('sha').href = digest.browser_download_url;
    document.getElementById('version').textContent = 'v'+version+' · '+(apk.size/1000000).toFixed(1)+' MB · 正式签名';
  } catch { /* stable HTML fallback remains usable */ }
})();
