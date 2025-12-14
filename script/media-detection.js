name: 流媒体检测(全内置版)
desc: 独立显示 Netflix/Disney+/YouTube/ChatGPT/TikTok 检测结果，代码内置，无需额外文件。
author: xiaomingyve1
enable: true

# ================= 面板入口 =================
panel-items:
  - script: check-netflix
  - script: check-disney
  - script: check-youtube
  - script: check-tiktok
  - script: check-chatgpt

# ================= 脚本逻辑 =================
script-providers:
  # 1. Netflix
  check-netflix:
    argument: "Netflix"
    interval: 300
    schedule: [manual, network-change]
    no-cache: true
    content: &script_code |
      // ================ 核心检测逻辑 ================
      const REQUEST_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36',
        'Accept-Language': 'en'
      };

      // 获取当前时间
      function getFormattedTime() {
        const now = new Date();
        return now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      // 超时控制
      function timeout(delay = 5000) {
        return new Promise((_, reject) => setTimeout(() => reject('Timeout'), delay));
      }

      // 主运行函数
      (async () => {
        const target = typeof $argument !== 'undefined' ? $argument : 'Netflix';
        
        // 配置表
        const services = {
          'Netflix': { fn: check_netflix, icon: 'play.tv.fill', color: '#E50914', title: 'Netflix' },
          'Disney': { fn: check_disneyplus, icon: 'play.circle.fill', color: '#113CCF', title: 'Disney+' },
          'YouTube': { fn: check_youtube_premium, icon: 'play.rectangle.fill', color: '#FF0000', title: 'YouTube' },
          'ChatGPT': { fn: check_chatgpt, icon: 'message.fill', color: '#10A37F', title: 'ChatGPT' },
          'TikTok': { fn: check_tiktok, icon: 'music.note', color: '#000000', title: 'TikTok' }
        };

        const config = services[target];
        if (!config) {
          $done({ title: '配置错误', content: '未知参数', icon: 'xmark.octagon' });
          return;
        }

        try {
          let result = await config.fn();
          // 格式化输出：去除前缀，只留结果
          let content = result.includes(': ') ? result.split(': ')[1] : result;
          
          $done({
            title: config.title,
            content: `${content}  [${getFormattedTime()}]`,
            icon: config.icon,
            'icon-color': config.color
          });
        } catch (e) {
          $done({
            title: config.title,
            content: '检测失败',
            icon: config.icon,
            'icon-color': '#999999'
          });
        }
      })();

      // ================ 各平台检测函数 ================
      
      // Netflix
      async function check_netflix() {
        try {
          let res = await new Promise((resolve, reject) => {
            $httpClient.get({ url: 'https://www.netflix.com/title/81280792', headers: REQUEST_HEADERS }, (error, response) => {
              if (error) return reject('Error');
              if (response.status === 403) return reject('Not Available');
              if (response.status === 404) return resolve('Not Found');
              if (response.status === 200) {
                let url = response.headers['x-originating-url'];
                let region = url ? url.split('/')[3].split('-')[0] : 'US';
                resolve(region.toUpperCase());
              }
              reject('Error');
            });
          });
          if (res === 'Not Found') return 'Netflix: 仅自制剧';
          return `Netflix: 已解锁 (${res})`;
        } catch (e) { return 'Netflix: 未解锁'; }
      }

      // Disney+
      async function check_disneyplus() {
        try {
          let { region, inSupportedLocation } = await new Promise((resolve, reject) => {
            $httpClient.post({
              url: 'https://disney.api.edge.bamgrid.com/graph/v1/device/graphql',
              headers: { 'Content-Type': 'application/json', 'User-Agent': REQUEST_HEADERS['User-Agent'] },
              body: JSON.stringify({
                query: 'mutation registerDevice($input: RegisterDeviceInput!) { registerDevice(registerDevice: $input) { grant { grantType assertion } } }',
                variables: { input: { applicationRuntime: 'chrome', attributes: { browserName: 'chrome', browserVersion: '94.0.4606', operatingSystem: 'macintosh' }, deviceFamily: 'browser', deviceProfile: 'macosx' } }
              })
            }, (error, response, data) => {
              if (error) return reject();
              try {
                let d = JSON.parse(data);
                if(d.errors) return reject();
                let loc = d.extensions.sdk.session.location;
                resolve({ region: loc.countryCode, inSupportedLocation: d.extensions.sdk.session.inSupportedLocation });
              } catch { reject(); }
            });
          });
          
          if (inSupportedLocation === false) return `Disney+: 即将上线 (${region})`;
          return `Disney+: 已解锁 (${region})`;
        } catch { return 'Disney+: 未解锁'; }
      }

      // YouTube
      async function check_youtube_premium() {
        return new Promise((resolve) => {
          $httpClient.get({ url: 'https://www.youtube.com/premium', headers: REQUEST_HEADERS }, (error, response, data) => {
            if (error || response.status !== 200) return resolve('YouTube: 检测失败');
            if (data.indexOf('Premium is not available in your country') !== -1) return resolve('YouTube: 未解锁');
            let region = 'US';
            let m = /"countryCode":"(.*?)"/.exec(data);
            if (m) region = m[1];
            else if (data.indexOf('www.google.cn') !== -1) region = 'CN';
            resolve(`YouTube: Premium (${region})`);
          });
        });
      }

      // ChatGPT
      async function check_chatgpt() {
        try {
          let { country } = await new Promise((resolve, reject) => {
             $httpClient.get({ url: 'https://chat.openai.com/cdn-cgi/trace', headers: REQUEST_HEADERS }, (err, resp, data) => {
               if(err || resp.status !== 200) return reject();
               let m = data.match(/loc=([A-Z]{2})/);
               if(m) resolve({ country: m[1] });
               else reject();
             });
          });
          return `ChatGPT: 已解锁 (${country})`;
        } catch { return 'ChatGPT: 未解锁'; }
      }

      // TikTok
      async function check_tiktok() {
        try {
           let region = await new Promise((resolve, reject) => {
             $httpClient.get({ url: 'https://www.tiktok.com/', headers: REQUEST_HEADERS }, (err, resp, data) => {
               if(err || resp.status !== 200) return reject();
               let m = data.match(/region.*?:.*?"([A-Z]{2})"/);
               if(m) resolve(m[1]);
               else reject();
             });
           });
           if(region === 'CN') return 'TikTok: 受限';
           return `TikTok: 已解锁 (${region})`;
        } catch { return 'TikTok: 检测失败'; }
      }

  # 2. Disney+ (复用代码)
  check-disney:
    argument: "Disney"
    interval: 300
    schedule: [manual, network-change]
    no-cache: true
    content: *script_code

  # 3. YouTube (复用代码)
  check-youtube:
    argument: "YouTube"
    interval: 300
    schedule: [manual, network-change]
    no-cache: true
    content: *script_code

  # 4. TikTok (复用代码)
  check-tiktok:
    argument: "TikTok"
    interval: 300
    schedule: [manual, network-change]
    no-cache: true
    content: *script_code

  # 5. ChatGPT (复用代码)
  check-chatgpt:
    argument: "ChatGPT"
    interval: 300
    schedule: [manual, network-change]
    no-cache: true
    content: *script_code
