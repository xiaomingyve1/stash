// —— 常量与工具函数 ——
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36',
  'Accept-Language': 'en',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache'
};
const TIMEOUTS = {
  network: 5000,
  netflix: 5000,
  disney: 7000,
  chatgpt: 10000,
  youtube: 5000,
  tiktok: 5000
};

const STATUS = {
  COMING: 2,
  AVAILABLE: 1,
  NOT_AVAILABLE: 0,
  TIMEOUT: -1,
  ERROR: -2
};

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
}

async function checkNetwork() {
  try {
    await Promise.race([
      new Promise((res, rej) => {
        $httpClient.get({ url: 'https://www.google.com/generate_204', timeout: TIMEOUTS.network }, (e, r) => {
          if (e || r.status !== 204) return rej(e || new Error('NoNetwork'));
          res();
        });
      }),
      timeout(TIMEOUTS.network)
    ]);
    return true;
  } catch {
    return false;
  }
}

function getTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function withDisconnect(fn) {
  return async function(...args) {
    // 切换前打断
    $surge && $surge.emit && $surge.emit('disconnect');
    const result = await fn(...args);
    // 切换后打断
    $surge && $surge.emit && $surge.emit('disconnect');
    return result;
  };
}

// —— 主流程 ——
;(async () => {
  const panel = { title: '多平台流媒体解锁检测', content: '', icon: 'play.tv.fill', 'icon-color': '#FF2D55' };

  if (!await checkNetwork()) {
    panel.content = `最后刷新时间: ${getTime()}\n────────────────\n网络不可用，请检查连接`;
    return $done(panel);
  }

  // 并行检测
  const tasks = [
    withDisconnect(checkNetflix)(),
    withDisconnect(checkDisneyPlus)(),
    withDisconnect(checkChatGPT)(),
    withDisconnect(checkYouTube)(),
    withDisconnect(checkTikTok)()
  ];

  try {
    const results = await Promise.all(tasks);
    panel.content = [`最后刷新时间: ${getTime()}`, '────────────────', ...results].join('\n');
  } catch (e) {
    console.error('检测异常:', e);
    panel.content = `最后刷新时间: ${getTime()}\n────────────────\n检测失败，请刷新面板`;
  } finally {
    $done(panel);
  }
})();

// —— Netflix 检测 ——
async function checkNetflix() {
  const titleIds = [81280792, 80018499];
  for (let id of titleIds) {
    try {
      const code = await Promise.race([
        new Promise((res, rej) => {
          $httpClient.get({ url: `https://www.netflix.com/title/${id}`, headers: REQUEST_HEADERS, timeout: TIMEOUTS.netflix }, (e, r) => {
            if (e) return rej(e);
            if (r.status === 403) return rej(new Error('NotAvailable'));
            if (r.status === 404) return res('NotFound');
            if (r.status === 200) {
              const url = r.headers['x-originating-url'];
              let region = url.split('/')[3].split('-')[0] || 'us';
              if (region === 'title') region = 'us';
              return res(region.toUpperCase());
            }
            rej(new Error('Error'));
          });
        }),
        timeout(TIMEOUTS.netflix)
      ]);
      if (code === 'NotFound') continue;
      return `Netflix: 已解锁，区域: ${code}`;
    } catch (e) {
      if (e.message === 'NotAvailable') break;
      continue;
    }
  }
  return 'Netflix: 检测失败，请刷新面板';
}

// —— Disney+ 检测 ——
async function testDisney() {
  const home = new Promise((res, rej) => {
    $httpClient.get({ url: 'https://www.disneyplus.com/', headers: REQUEST_HEADERS, timeout: TIMEOUTS.disney }, (e, r, d) => {
      if (e || r.status !== 200 || d.includes('Sorry, Disney+ is not available')) return rej(e || new Error());
      const m = d.match(/Region: ([A-Za-z]{2})[\s\S]*?CNBL: ([12])/);
      res({ region: m ? m[1] : '', cnbl: m ? m[2] : '' });
    });
  });
  const info = new Promise((res, rej) => {
    $httpClient.post({ url: 'https://disney.api.edge.bamgrid.com/graph/v1/device/graphql', headers: { ...REQUEST_HEADERS, 'Content-Type': 'application/json', Authorization: 'ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84' }, body: JSON.stringify({ query: 'mutation...', variables: { input: { applicationRuntime: 'chrome', attributes: {/*...*/}, deviceFamily:'browser', deviceLanguage:'en', deviceProfile:'macosx' } } }) }, (e, r, d) => {
      if (e || r.status !== 200) return rej(e || new Error());
      try { const json = JSON.parse(d); const ext = json.extensions.sdk.session; res({ inSupportedLocation: ext.inSupportedLocation, countryCode: ext.location.countryCode }); }
      catch { rej(new Error()); }
    });
  });

  try {
    const { region } = await Promise.race([home, timeout(TIMEOUTS.disney)]);
    const loc = await Promise.race([info, timeout(TIMEOUTS.disney)]);
    return { region: (loc.countryCode || region).toUpperCase(), status: loc.inSupportedLocation ? STATUS.AVAILABLE : STATUS.COMING };
  } catch {
    return { status: STATUS.ERROR };
  }
}

async function checkDisneyPlus() {
  try {
    const { region, status } = await testDisney();
    if (status === STATUS.AVAILABLE) return `Disney+: 已解锁，区域: ${region}`;
    if (status === STATUS.COMING) return `Disney+: 即将上线，区域: ${region}`;
  } catch {}
  return 'Disney+: 检测失败，请刷新面板';
}

// —— ChatGPT 检测 ——
async function checkChatGPT() {
  try {
    const { status, country } = await Promise.race([
      timeout(TIMEOUTS.chatgpt).then(() => ({ status: STATUS.TIMEOUT })),
      new Promise(res => {
        $httpClient.get({ url: 'https://chat.openai.com/cdn-cgi/trace', headers: REQUEST_HEADERS, timeout: TIMEOUTS.chatgpt }, (e, r, d) => {
          if (e || r.status !== 200) return res({ status: STATUS.NOT_AVAILABLE });
          const m = d.match(/loc=([A-Z]{2})/);
          res({ status: m ? STATUS.AVAILABLE : STATUS.NOT_AVAILABLE, country: m ? m[1] : '' });
        });
      })
    ]);
    if (status === STATUS.AVAILABLE) return `ChatGPT: 已解锁，区域: ${country}`;
  } catch {}
  return 'ChatGPT: 检测失败，请刷新面板';
}

// —— YouTube Premium 检测 ——
async function checkYouTube() {
  try {
    const region = await Promise.race([
      timeout(TIMEOUTS.youtube).then(() => { throw new Error(); }),
      new Promise((res, rej) => {
        $httpClient.get({ url: 'https://www.youtube.com/premium', headers: REQUEST_HEADERS, timeout: TIMEOUTS.youtube }, (e, r, d) => {
          if (e || r.status !== 200) return rej(e);
          if (d.includes('Premium is not available in your country')) return res(null);
          const m = /"countryCode":"(.*?)"/.exec(d);
          res(m ? m[1] : (d.includes('www.google.cn') ? 'CN' : 'US'));
        });
      })
    ]);
    if (region) return `YouTube: 已解锁，区域: ${region.toUpperCase()}`;
  } catch {}
  return 'YouTube: 检测失败，请刷新面板';
}

// —— TikTok 检测 ——
async function checkTikTok() {
  try {
    const { error, region } = await Promise.race([
      timeout(TIMEOUTS.tiktok).then(() => ({ error: true })),
      new Promise(res => {
        $httpClient.get({ url: 'https://www.tiktok.com/', headers: REQUEST_HEADERS, timeout: TIMEOUTS.tiktok }, (e, r, d) => {
          if (e || r.status !== 200) return res({ error: true });
          const m = d.match(/region.*?:.*?"([A-Z]{2})"/);
          res({ error: false, region: m ? m[1] : 'US' });
        });
      })
    ]);
    if (!error) return `TikTok: ${region==='CN'? '受限区域 🚫' : '已解锁，区域: ' + region}`;
  } catch {}
  return 'TikTok: 检测失败，请刷新面板';
}
