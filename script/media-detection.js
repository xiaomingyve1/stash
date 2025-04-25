// ================ 配置与常量 ================
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36',
  'Accept-Language': 'en',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache'
};
const STATUS = {
  COMING: 2,
  AVAILABLE: 1,
  NOT_AVAILABLE: 0,
  TIMEOUT: -1,
  ERROR: -2
};

// ================ 网络连通性检查 ================
async function checkNetwork() {
  return new Promise((resolve, reject) => {
    $httpClient.get({ url: 'https://www.google.com/generate_204', timeout: 5000 },
      (err, resp) => (err || resp.status !== 204) ? reject('网络不可用') : resolve());
  });
}

// ================ 时间工具 ================
function getTimestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

// ================ 断开连接 ================
function disconnectAll() {
  $network.disconnect && $network.disconnect();
}

// ================ 主流程 ================
;(async () => {
  const panel = { title: '多平台流媒体解锁检测', content: '', icon: 'play.tv.fill', 'icon-color': '#FF2D55' };

  // 1. 开始前断开连接
  disconnectAll();

  // 2. 网络预检
  try {
    await checkNetwork();
  } catch (e) {
    panel.content = `最后刷新时间: ${getTimestamp()}\n────────────────\n网络不可用，请检查连接`;
    $done(panel);
    return;
  }

  // 3. 并行检测各平台
  const tasks = [checkNetflix(), checkDisneyPlus(), checkChatGPT(), checkYouTube(), checkTikTok()];
  try {
    const results = await Promise.all(tasks);
    panel.content = [`最后刷新时间: ${getTimestamp()}`, '────────────────', ...results].join('\n');
  } catch (e) {
    console.error('检测异常:', e);
    panel.content = `最后刷新时间: ${getTimestamp()}\n────────────────\n检测失败，请刷新面板`;
  }

  // 4. 结束后断开连接
  disconnectAll();
  $done(panel);
})();

// ================ Netflix 检测 ================
async function checkNetflix() {
  const checkTitle = async (id) => new Promise((res, rej) => {
    $httpClient.get({ url: `https://www.netflix.com/title/${id}`, headers: REQUEST_HEADERS },
      (err, resp) => {
        if (err) return rej();
        if (resp.status === 404) return res(null);
        if (resp.status === 200) {
          const origin = resp.headers['x-originating-url'] || '';
          let region = origin.split('/')[3]?.split('-')[0] || 'us';
          if (region === 'title') region = 'us';
          return res(region);
        }
        rej();
      });
  });

  let label = 'Netflix: ';
  try {
    let region = await checkTitle(81280792) || await checkTitle(80018499);
    if (!region) throw 'Unavailable';
    label += `已解锁，区域: ${region.toUpperCase()}`;
  } catch {
    label += '检测失败，请刷新面板';
  }
  return label;
}

// ================ Disney+ 检测 ================
async function checkDisneyPlus() {
  const label = 'Disney+: ';
  try {
    const { region, status } = await testDisney();
    if (status === STATUS.AVAILABLE) return label + `已解锁，区域: ${region}`;
    if (status === STATUS.COMING) return label + `即将上线，区域: ${region}`;
  } catch {}
  return label + '检测失败，请刷新面板';
}

async function testDisney() {
  const race = (p, t) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej('timeout'), t))]);
  const home = await race(getDisneyHome(), 7000);
  const info = await race(getDisneyLocation(), 7000);
  const region = info.countryCode || home.region;
  return { region, status: info.inSupportedLocation ? STATUS.AVAILABLE : STATUS.COMING };
}

function getDisneyHome() {
  return new Promise((res, rej) => {
    $httpClient.get({ url: 'https://www.disneyplus.com/', headers: REQUEST_HEADERS },
      (err, resp, data) => {
        if (err || resp.status !== 200 || data.includes('not available in your region')) return rej();
        const m = data.match(/Region: ([A-Za-z]{2})[\s\S]*?CNBL: ([12])/);
        res({ region: m?.[1] || '', cnbl: m?.[2] || '' });
      });
  });
}

function getDisneyLocation() {
  return new Promise((res, rej) => {
    $httpClient.post({
      url: 'https://disney.api.edge.bamgrid.com/graph/v1/device/graphql',
      headers: Object.assign({}, REQUEST_HEADERS, { Authorization: 'ZGlzbmV5...'}),
      body: JSON.stringify({ /* mutation payload */ })
    }, (err, resp, body) => {
      if (err || resp.status !== 200) return rej();
      const json = JSON.parse(body);
      const sess = json.extensions?.sdk?.session;
      res({ inSupportedLocation: sess.inSupportedLocation, countryCode: sess.location.countryCode });
    });
  });
}

// ================ ChatGPT 检测 ================
async function checkChatGPT() {
  const label = 'ChatGPT: ';
  try {
    const { status, country } = await Promise.race([
      new Promise(res => setTimeout(() => res({ status: STATUS.TIMEOUT }), 10000)),
      new Promise(res => {
        $httpClient.get({ url: 'https://chat.openai.com/cdn-cgi/trace', headers: REQUEST_HEADERS },
          (e, r, data) => {
            if (e || r.status !== 200) return res({ status: STATUS.NOT_AVAILABLE });
            const m = data.match(/loc=([A-Z]{2})/);
            res(m ? { status: STATUS.AVAILABLE, country: m[1] } : { status: STATUS.NOT_AVAILABLE });
          });
      })
    ]);
    return label + (status === STATUS.AVAILABLE
      ? `已解锁，区域: ${country}`
      : '检测失败，请刷新面板');
  } catch {
    return label + '检测失败，请刷新面板';
  }
}

// ================ YouTube Premium 检测 ================
async function checkYouTube() {
  const label = 'YouTube: ';
  try {
    const region = await new Promise((res, rej) => {
      $httpClient.get({ url: 'https://www.youtube.com/premium', headers: REQUEST_HEADERS },
        (e, r, d) => {
          if (e || r.status !== 200) return rej();
          if (d.includes('not available in your country')) return res(null);
          const m = /"countryCode":"(.*?)"/gm.exec(d);
          res(m ? m[1] : (d.includes('www.google.cn') ? 'CN' : 'US'));
        });
    });
    return label + (region ? `已解锁，区域: ${region}` : '检测失败，请刷新面板');
  } catch {
    return label + '检测失败，请刷新面板';
  }
}

// ================ TikTok 检测 ================
async function checkTikTok() {
  const label = 'TikTok: ';
  try {
    const resp = await Promise.race([
      new Promise(res => setTimeout(() => res({ error: true }), 5000)),
      new Promise(res => {
        $httpClient.get({ url: 'https://www.tiktok.com/', headers: REQUEST_HEADERS },
          (e, r, d) => res(e || r.status !== 200
            ? { error: true }
            : { error: false, region: d.match(/region.*?:.*?\"([A-Z]{2})\"/)?.[1] || 'US' }));
      })
    ]);
    if (resp.error) throw 'err';
    return label + (resp.region === 'CN' ? '受限区域 🚫' : `已解锁，区域: ${resp.region}`);
  } catch {
    return label + '检测失败，请刷新面板';
  }
}
