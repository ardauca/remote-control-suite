// Phase 1 Automated Verification Script
const http = require('http');

async function testHealthEndpoint() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:52520/api/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ statusCode: res.statusCode, body: json });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
  });
}

async function testStaticPwaEndpoint() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:52520/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
  });
}

async function run() {
  console.log('Testing Phase 1 Endpoints...');

  try {
    const health = await testHealthEndpoint();
    console.log('✔ Health endpoint responded:', health.statusCode, health.body);

    const pwa = await testStaticPwaEndpoint();
    const containsHtml = pwa.body.includes('<div id="root">');
    console.log('✔ Static PWA index.html served:', pwa.statusCode, 'Contains #root:', containsHtml);

    if (health.body.status === 'ok' && containsHtml) {
      console.log('==========================================');
      console.log('🎉 ALL PHASE 1 ACCEPTANCE CHECKS PASSED!');
      console.log('==========================================');
      process.exit(0);
    } else {
      console.error('❌ Verification failed: Unexpected response content');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Verification error:', err.message);
    process.exit(1);
  }
}

run();
