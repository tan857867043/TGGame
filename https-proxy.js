const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 创建自签名证书
const options = {
  key: fs.readFileSync(path.join(__dirname, 'server.key')),
  cert: fs.readFileSync(path.join(__dirname, 'server.cert'))
};

// HTTPS服务器配置
const httpsServer = https.createServer(options, (req, res) => {
  // 解析请求URL
  const url = new URL(req.url, 'http://localhost:3002');
  
  // 转发到本地HTTP服务器
  const proxyReq = http.request({
    hostname: 'localhost',
    port: 3002,
    path: url.pathname + url.search,
    method: req.method,
    headers: req.headers
  }, (proxyRes) => {
    // 转发响应
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  // 处理错误
  proxyReq.on('error', (e) => {
    console.error('代理错误:', e);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('代理服务器错误');
  });
  
  // 转发请求体
  req.pipe(proxyReq);
});

// 启动HTTPS服务器
const PORT = 3443;
httpsServer.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTPS代理服务器运行在 https://localhost:${PORT}`);
  console.log(`局域网访问地址: https://192.168.1.3:${PORT}`);
  console.log('\n注意事项:');
  console.log('1. 浏览器会显示安全警告，这是正常的');
  console.log('2. 点击"继续访问"或类似选项');
  console.log('3. 页面加载后会请求摄像头权限，点击"允许"');
  console.log('4. 现在应该可以正常使用摄像头了');
});