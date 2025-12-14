// ================ 常量定义 ================
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36',
  'Accept-Language': 'en',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache'
};
const UA = REQUEST_HEADERS['User-Agent'];

const STATUS_COMING = 2;
const STATUS_AVAILABLE = 1;
const STATUS_NOT_AVAILABLE = 0;
const STATUS_TIMEOUT = -1;
const STATUS_ERROR = -2;

// ================ 辅助：获取时间 ================
function getFormattedTime() {
  const now = new Date();
  return now.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// ================ 主体入口 (已修改以支持单项检测) ================
;(async () => {
  // 获取 Stash 传入的参数，默认为 Netflix
  const target = typeof $argument !== 'undefined' ? $argument : 'Netflix';
  
  // 定义每个服务的配置：检测函数、图标、图标颜色、显示标题
  const services = {
    'Netflix': { 
      fn: check_netflix, 
      icon: 'play.tv.fill', 
      color: '#E50914',
      title: 'Netflix 检测'
    },
    'Disney': { 
      fn: check_disneyplus, 
      icon: 'play.circle.fill', 
      color: '#113CCF',
      title: 'Disney+ 检测'
    },
    'YouTube': { 
      fn: check_youtube_premium, 
      icon: 'play.rectangle.fill', 
      color: '#FF0000',
      title: 'YouTube Premium'
    },
    'ChatGPT': { 
      fn: check_chatgpt, 
      icon: 'message.fill', 
      color: '#10A37F',
      title: 'ChatGPT 检测'
    },
    'TikTok': { 
      fn: check_tiktok, 
      icon: 'music.note', 
      color: '#000000',
      title: 'TikTok 检测'
    }
  };

  const currentService = services[target];

  // 如果没有匹配到参数，或者参数错误，显示错误信息
  if (!currentService) {
    $done({
      title: '配置错误',
      content: `未知的检测参数: ${target}`,
      icon: 'exclamationmark.triangle'
    });
    return;
  }

  try {
    // 执行对应的检测函数
    // 注意：这里不需要 check_network_status，因为如果网络不通，具体的检测函数会报错或超时，效果一样且速度更快
    let resultText = await currentService.fn();
    
    // 为了美观，去掉原本函数返回字符串中的前缀（例如 "Netflix: "），只保留结果
    // 你的原函数返回格式是 "Title: Result"，我们这里做一个简单的切割优化显示
    let content = resultText;
    if (resultText.includes(': ')) {
       content = resultText.split(': ')[1];
    }

    $done({
      title: currentService.title,
      content: content + `  [${getFormattedTime()}]`, // 在结果后加上时间
      icon: currentService.icon,
      'icon-color': currentService.color
    });

  } catch (e) {
    console.log(`[${target}] 检测异常:`, e);
    $done({
      title: currentService.title,
      content: '检测失败，请检查网络或刷新',
      icon: currentService.icon,
      'icon-color': '#999999'
    });
  }
})();

// ================ 以下为原版检测逻辑 (未修改检测方式) ================

// ================ Netflix ================
async function check_netflix() {
  function inner_check(filmId) {
    return new Promise((resolve, reject) => {
      $httpClient.get({
        url: 'https://www.netflix.com/title/' + filmId,
        headers: REQUEST_HEADERS
      }, (error, response) => {
        if (error) return reject('Error');
        if (response.status === 403) return reject('Not Available');
        if (response.status === 404) return resolve('Not Found');
        if (response.status === 200) {
          let url = response.headers['x-originating-url'];
          let region = url.split('/')[3].split('-')[0];
          if (region === 'title') region = 'us';
          return resolve(region);
        }
        reject('Error');
      });
    });
  }

  let res = 'Netflix: ';
  await inner_check(81280792)
    .then((code) => {
      if (code === 'Not Found') return inner_check(80018499);
      res += '已解锁，区域: ' + code.toUpperCase();
      return Promise.reject('BreakSignal');
    })
    .then((code) => {
      if (code === 'Not Found') return Promise.reject('Not Available');
      res += '仅自制剧，区域: ' + code.toUpperCase();
      return Promise.reject('BreakSignal');
    })
    .catch((error) => {
      if (error !== 'BreakSignal') {
        res += '检测失败';
      }
    });
  return res;
}

// ================ Disney+ ================
async function check_disneyplus() {
  let res = 'Disney+: ';
  try {
    const { region, status } = await testDisneyPlus();
    if (status === STATUS_AVAILABLE) {
      res += '已解锁，区域: ' + region.toUpperCase();
    } else if (status === STATUS_COMING) {
      res += '即将上线，区域: ' + region.toUpperCase();
    } else {
      res += '未解锁';
    }
  } catch (e) {
    res += '检测失败';
  }
  return res;
}

async function testDisneyPlus() {
  try {
    let { region } = await Promise.race([testHomePage(), timeout(7000)]);
    let info = await Promise.race([getLocationInfo(), timeout(7000)]);
    let countryCode = info.countryCode ?? region;
    let inSupportedLocation = info.inSupportedLocation;
    if (inSupportedLocation === false || inSupportedLocation === 'false') {
      return { region: countryCode, status: STATUS_COMING };
    } else {
      return { region: countryCode, status: STATUS_AVAILABLE };
    }
  } catch {
    return { status: STATUS_ERROR };
  }
}

function testHomePage() {
  return new Promise((resolve, reject) => {
    $httpClient.get(
      {
        url: 'https://www.disneyplus.com/',
        headers: REQUEST_HEADERS
      },
      (error, response, data) => {
        if (
          error ||
          response.status !== 200 ||
          data.includes('Sorry, Disney+ is not available in your region.')
        ) {
          return reject('Not Available');
        }
        let m = data.match(/Region: ([A-Za-z]{2})[\s\S]*?CNBL: ([12])/);
        if (!m) return resolve({ region: '', cnbl: '' });
        resolve({ region: m[1], cnbl: m[2] });
      }
    );
  });
}

function getLocationInfo() {
  return new Promise((resolve, reject) => {
    $httpClient.post(
      {
        url: 'https://disney.api.edge.bamgrid.com/graph/v1/device/graphql',
        headers: {
          'Accept-Language': 'en',
          Authorization:
            'ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84',
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify({
          query:
            'mutation registerDevice($input: RegisterDeviceInput!) { registerDevice(registerDevice: $input) { grant { grantType assertion } } }',
          variables: {
            input: {
              applicationRuntime: 'chrome',
              attributes: {
                browserName: 'chrome',
                browserVersion: '94.0.4606',
                manufacturer: 'apple',
                model: null,
                operatingSystem: 'macintosh',
                operatingSystemVersion: '10.15.7',
                osDeviceIds: []
              },
              deviceFamily: 'browser',
              deviceLanguage: 'en',
              deviceProfile: 'macosx'
            }
          }
        })
      },
      (error, response, data) => {
        if (error || response.status !== 200) return reject('Not Available');
        data = JSON.parse(data);
        if (data.errors) return reject('Not Available');
        let {
          session: {
            inSupportedLocation,
            location: { countryCode }
          }
        } = data.extensions.sdk;
        resolve({ inSupportedLocation, countryCode });
      }
    );
  });
}

// ================ ChatGPT ================
async function check_chatgpt() {
  let result = 'ChatGPT: ';
  try {
    let { status, country } = await Promise.race([
      timeout(10000),
      new Promise((resolve) => {
        $httpClient.get(
          {
            url: 'https://chat.openai.com/cdn-cgi/trace',
            headers: REQUEST_HEADERS
          },
          (error, response, data) => {
            if (error) return resolve({ status: STATUS_ERROR });
            if (response.status !== 200)
              return resolve({ status: STATUS_NOT_AVAILABLE });
            let m = data.match(/loc=([A-Z]{2})/);
            if (m)
              resolve({ status: STATUS_AVAILABLE, country: m[1] });
            else resolve({ status: STATUS_NOT_AVAILABLE });
          }
        );
      })
    ]);
    if (status === STATUS_AVAILABLE) {
      result += `已解锁，区域: ${country.toUpperCase()}`;
    } else {
      result += '未解锁';
    }
  } catch {
    result += '检测失败';
  }
  return result;
}

// ================ YouTube Premium ================
async function check_youtube_premium() {
  function inner_check() {
    return new Promise((resolve, reject) => {
      $httpClient.get(
        {
          url: 'https://www.youtube.com/premium',
          headers: REQUEST_HEADERS
        },
        (error, response, data) => {
          if (error || response.status !== 200) return reject('Error');
          if (data.includes('Premium is not available in your country')) {
            return resolve('Not Available');
          }
          let re = /"countryCode":"(.*?)"/gm;
          let m = re.exec(data);
          let region = m ? m[1] : data.includes('www.google.cn') ? 'CN' : 'US';
          resolve(region);
        }
      );
    });
  }

  let res = 'YouTube: ';
  await inner_check()
    .then((code) => {
      if (code === 'Not Available') res += '未解锁';
      else res += '已解锁，区域: ' + code.toUpperCase();
    })
    .catch(() => {
      res += '检测失败';
    });
  return res;
}

// ================ TikTok ================
async function check_tiktok() {
  let res = 'TikTok: ';
  try {
    let response = await Promise.race([
      timeout(5000),
      new Promise((resolve) => {
        $httpClient.get(
          {
            url: 'https://www.tiktok.com/',
            headers: REQUEST_HEADERS
          },
          (error, response, data) => {
            if (error || response.status !== 200)
              return resolve({ error: true });
            let m = data.match(/region.*?:.*?"([A-Z]{2})"/);
            resolve({ error: false, region: m ? m[1] : 'US' });
          }
        );
      })
    ]);
    if (response.error) throw new Error();
    res += response.region === 'CN'
      ? '受限区域 🚫'
      : `已解锁，区域: ${response.region}`;
  } catch {
    res = 'TikTok: 检测失败';
  }
  return res;
}

// ================ 通用函数 ================
function timeout(delay = 5000) {
  return new Promise((_, reject) =>
    setTimeout(() => reject('Timeout'), delay)
  );
}
