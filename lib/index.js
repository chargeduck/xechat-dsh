// src/index.ts
/**
* Node 侧（host half）插件体。
*
* xechat-dsh 是纯客户端插件：所有能力都在浏览器里跑（WebSocket 直连 XEChat 服务端），
* 宿主侧不需要注册任何服务、路由或工具，因此这里保持空实现。
* 保留 name/apply 导出是为了满足 DSH 加载器的模块契约。
*/
const name = "xechat-dsh";
function apply() {}
export { apply, name };
