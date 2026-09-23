/**
 * 注册离线外壳的 service worker（`public/sw.js`）。
 *
 * 它只做断网兜底，不做加速：所有请求都是网络优先，缓存只在 `fetch()` 失败时被读到
 * （理由写在 `public/sw.js` 顶部）。所以注册它**不会**让「我现在看到的是不是最新版」
 * 变得没法回答 —— 在线时拿到的永远是线上那一份，刷新一次就能确定版本。
 *
 * 三条边界：
 *
 * - **只在生产构建里注册。** `npm run dev` 下注册会把 dev server 的请求也拦下来，
 *   改代码看不到效果。本地要看离线行为，用 `npm run build` + `scripts/serve-static.js`
 *   服务 `out/`（那也是产物本身的形态）。
 * - 需要安全上下文（https 或 localhost），和注册本身的要求一致。
 * - **失败一律静默。** 没有 worker 时站点照常工作，只是断网打不开 ——
 *   不能让一个可选能力把页面拖下水。
 */

import { site } from 'config';

const isSupported = function () {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!window.isSecureContext) return false;
    return 'serviceWorker' in navigator;
};

const registerServiceWorker = function () {
    if (process.env.NODE_ENV !== 'production') return;
    if (!isSupported()) return;

    const register = function () {
        const prefix = site.pathPrefix || '';
        // scope 的默认值就是 `sw.js` 所在的目录，显式写出来是为了让「这个 worker 管哪些
        // 路径」在代码里看得见 —— 它只该管 `/music/` 底下的东西。
        navigator.serviceWorker.register(`${prefix}/sw.js`, { scope: `${prefix}/` }).catch(() => {});
    };

    // 和别的一次性副作用一样，放在关键路径之外。
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
};

export default registerServiceWorker;
export { registerServiceWorker };
