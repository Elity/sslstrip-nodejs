# sslstrip-nodejs

sslstrip by nodejs

代码改造自[node-ssl-strip](https://github.com/o2platform/node-ssl-strip) 与 [sslstrip](https://github.com/zsky/sslstrip)

### 使用

1. 运行脚本

```bash
npm run  start
```

2. 模拟中间人(MITM)

设置浏览器的 http 代理为：`127.0.0.1:8081`

3. 实验

按往常一样不以 https 打头，输入一个会自动 301 重定向到 https 的网站。

开启了 HSTS 的网站，只对首次就被劫持的情况有效，参考[MDN HSTS](https://developer.mozilla.org/zh-CN/docs/Glossary/HSTS)

4. 被劫持的现象

目标网站没有正常跳转到 https，且控制台有被劫持后输出的自定义消息

### PS

该脚本仅处理了通过 http header:Location 重定向的情况，若目标网站 js 代码中检测到了 http，然后跳转到 https 会形成死循环，不停刷新网页。
