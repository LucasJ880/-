/*!
 * 青砚嵌入询盘表单 (Qingyan embeddable inquiry form) v1
 *
 *   <script src="https://<qingyan-host>/embed/inquiry.js"
 *           data-key="qyk_..." data-lang="en" data-product="Waffle bathrobe" async></script>
 *
 * - data-key      website 通道的公开 key（必填；在青砚「外贸 → 消息通道」复制）
 * - data-lang     en | zh（默认 en）
 * - data-product  预填「感兴趣的产品」（可选）
 * - data-target   CSS 选择器：渲染到该元素里（可选；默认渲染在本 script 标签之后）
 * - data-api      青砚接口来源（可选；脚本放在 CDN 上时填青砚域名，默认取本 script 的 src 来源）
 *
 * 隐私：不设 cookie、不写 localStorage、不生成持久访客 id；首访归因（UTM / referrer / 落地页）
 * 只存在本标签页的 sessionStorage 里，关掉标签页即清除。
 * 提交成功后在表单宿主元素上派发 `qingyan:inquiry-submitted`（detail: { receiptId }），站点可接自己的统计。
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) {
    var candidates = document.querySelectorAll('script[src*="/embed/inquiry.js"]');
    for (var i = candidates.length - 1; i >= 0; i--) {
      if (!candidates[i].getAttribute("data-qy-mounted")) {
        script = candidates[i];
        break;
      }
    }
  }
  if (!script || script.getAttribute("data-qy-mounted")) return;
  script.setAttribute("data-qy-mounted", "1");

  var KEY = script.getAttribute("data-key") || script.getAttribute("data-org-key") || "";
  var LANG = (script.getAttribute("data-lang") || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  var PRODUCT = script.getAttribute("data-product") || "";
  var TARGET = script.getAttribute("data-target") || "";
  var API_BASE;
  try {
    API_BASE = new URL(script.getAttribute("data-api") || script.src, window.location.href).origin;
  } catch {
    return;
  }
  var ENDPOINT = API_BASE + "/api/trade/webhook/website/embed";
  var FIRST_TOUCH_KEY = "qy_embed_first_touch_v1";
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  if (!KEY) {
    if (window.console) console.warn("[qingyan-embed] missing data-key; form not rendered");
    return;
  }

  var I18N = {
    en: {
      name: "Your name",
      email: "Email",
      phone: "Phone / WhatsApp",
      company: "Company",
      country: "Country / Region",
      product: "Product of interest",
      quantity: "Quantity",
      message: "Message",
      messageHint: "Specifications, packaging, target market, timeline…",
      optional: "optional",
      required: "required",
      submit: "Send inquiry",
      sending: "Sending…",
      successTitle: "Thank you!",
      successBody: "Your inquiry has been received. We will reply to you by email.",
      errRequired: "Please fill in this field.",
      errEmail: "Please enter a valid email address.",
      errRate: "Too many submissions from this network. Please try again later.",
      errGeneric: "Sorry, your inquiry could not be sent. Please try again, or contact us by email.",
      errFix: "Please check the highlighted fields.",
      honeypot: "Leave this field empty",
    },
    zh: {
      name: "姓名",
      email: "邮箱",
      phone: "电话 / WhatsApp",
      company: "公司",
      country: "国家 / 地区",
      product: "感兴趣的产品",
      quantity: "数量",
      message: "留言",
      messageHint: "规格、包装、目标市场、时间要求等",
      optional: "选填",
      required: "必填",
      submit: "提交询盘",
      sending: "提交中…",
      successTitle: "感谢您的询盘",
      successBody: "我们已收到您的询盘，将通过邮件回复您。",
      errRequired: "请填写此项。",
      errEmail: "请输入有效的邮箱地址。",
      errRate: "提交过于频繁，请稍后再试。",
      errGeneric: "抱歉，询盘未能提交。请重试，或直接发邮件联系我们。",
      errFix: "请检查标红的字段。",
      honeypot: "此项请留空",
    },
  };
  var T = I18N[LANG];

  var FIELDS = [
    { name: "name", type: "text", required: true, autocomplete: "name", max: 120 },
    { name: "email", type: "email", required: true, autocomplete: "email", max: 200, inputmode: "email" },
    { name: "phone", type: "tel", autocomplete: "tel", max: 60, inputmode: "tel" },
    { name: "company", type: "text", autocomplete: "organization", max: 200 },
    { name: "country", type: "text", autocomplete: "country-name", max: 80 },
    { name: "product", type: "text", max: 200, value: PRODUCT },
    { name: "quantity", type: "text", max: 120 },
    { name: "message", type: "textarea", max: 4000, full: true, hint: true },
  ];

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function clip(v, max) {
    return String(v == null ? "" : v).slice(0, max);
  }

  function pageUrl() {
    return clip(String(window.location.href).split("#")[0], 500);
  }

  function session() {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  /** 首访归因：本标签页会话里第一次加载本脚本时的 UTM / referrer / 落地页（只存 sessionStorage） */
  function firstTouch() {
    var store = session();
    if (store) {
      try {
        var saved = JSON.parse(store.getItem(FIRST_TOUCH_KEY) || "null");
        if (saved && typeof saved === "object") return saved;
      } catch {
        /* ignore */
      }
    }
    var touch = { landing: pageUrl(), referrer: clip(document.referrer || "", 500) };
    try {
      var q = new URLSearchParams(window.location.search);
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var v = q.get(UTM_KEYS[i]);
        if (v) touch[UTM_KEYS[i]] = clip(v, 120);
      }
    } catch {
      /* ignore */
    }
    if (store) {
      try {
        store.setItem(FIRST_TOUCH_KEY, JSON.stringify(touch));
      } catch {
        /* ignore */
      }
    }
    return touch;
  }

  function uuid() {
    var c = window.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var j = 0; j < 16; j++) h.push((b[j] + 0x100).toString(16).slice(1));
    return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" + h.slice(6, 8).join("") + "-" + h.slice(8, 10).join("") + "-" + h.slice(10).join("");
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
        if (k === "text") node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k] === true ? "" : String(attrs[k]));
      }
    }
    if (children) for (var i = 0; i < children.length; i++) if (children[i]) node.appendChild(children[i]);
    return node;
  }

  var CSS =
    ":host{all:initial;display:block}" +
    ".qy{font-family:var(--qy-font,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif);font-size:15px;line-height:1.5;color:var(--qy-text,#1f2933);max-width:var(--qy-max-width,680px)}" +
    ".qy *,.qy *::before,.qy *::after{box-sizing:border-box}" +
    ".qy-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}" +
    ".qy-full{grid-column:1/-1}" +
    ".qy-field{display:flex;flex-direction:column;gap:4px;min-width:0}" +
    ".qy-label{font-weight:600;font-size:14px}" +
    ".qy-tag{font-weight:400;color:var(--qy-muted,#5f6b76);font-size:13px;margin-left:4px}" +
    ".qy-hint{color:var(--qy-muted,#5f6b76);font-size:13px}" +
    ".qy-input{width:100%;font:inherit;font-size:16px;color:inherit;background:var(--qy-input-bg,#fff);border:1px solid var(--qy-border,#c5ccd3);border-radius:var(--qy-radius,6px);padding:10px 12px;min-height:44px}" +
    "textarea.qy-input{min-height:120px;resize:vertical}" +
    ".qy-input:focus{outline:2px solid var(--qy-accent,#1f4e79);outline-offset:1px;border-color:var(--qy-accent,#1f4e79)}" +
    ".qy-input[aria-invalid=true]{border-color:#b42318}" +
    ".qy-err{color:#b42318;font-size:13px;min-height:0}" +
    ".qy-err:empty{display:none}" +
    ".qy-hp{position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;overflow:hidden!important}" +
    ".qy-actions{margin-top:16px;display:flex;flex-direction:column;gap:10px}" +
    ".qy-btn{appearance:none;font:inherit;font-size:16px;font-weight:600;color:var(--qy-accent-text,#fff);background:var(--qy-accent,#1f4e79);border:0;border-radius:var(--qy-radius,6px);padding:12px 20px;min-height:48px;cursor:pointer;width:100%}" +
    "@media (min-width:560px){.qy-btn{width:auto;align-self:flex-start}}" +
    ".qy-btn:focus-visible{outline:2px solid var(--qy-accent,#1f4e79);outline-offset:2px}" +
    ".qy-btn[disabled]{opacity:.65;cursor:progress}" +
    ".qy-status{font-size:14px}" +
    ".qy-status.qy-bad{color:#b42318}" +
    ".qy-done{padding:20px;border:1px solid var(--qy-border,#c5ccd3);border-radius:var(--qy-radius,6px);background:var(--qy-done-bg,#f4f8f5)}" +
    ".qy-done h3{margin:0 0 6px;font-size:18px}" +
    ".qy-done p{margin:0}" +
    ".qy-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}";

  var uid = "qy" + Math.random().toString(36).slice(2, 8);
  var host = el("div", { "data-qingyan-inquiry": "1" });
  var root = host;
  if (host.attachShadow) {
    root = host.attachShadow({ mode: "open" });
    var sheetApplied = false;
    try {
      if ("adoptedStyleSheets" in root && typeof CSSStyleSheet === "function") {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [sheet];
        sheetApplied = true;
      }
    } catch {
      sheetApplied = false;
    }
    if (!sheetApplied) root.appendChild(el("style", { text: CSS }));
  } else {
    root.appendChild(el("style", { text: CSS.replace(":host{all:initial;display:block}", "") }));
  }

  var wrap = el("div", { class: "qy", lang: LANG === "zh" ? "zh-CN" : "en" });
  var form = el("form", { class: "qy-form", novalidate: true, "aria-label": T.submit });
  var grid = el("div", { class: "qy-grid" });
  var inputs = {};
  var errors = {};

  for (var f = 0; f < FIELDS.length; f++) {
    var def = FIELDS[f];
    var id = uid + "-" + def.name;
    var labelChildren = [document.createTextNode(T[def.name])];
    labelChildren.push(el("span", { class: "qy-tag", text: def.required ? "*" : "(" + T.optional + ")", "aria-hidden": "true" }));
    if (def.required) labelChildren.push(el("span", { class: "qy-sr", text: " (" + T.required + ")" }));
    var label = el("label", { class: "qy-label", for: id }, labelChildren);
    var describedBy = [id + "-err"];
    var hintNode = null;
    if (def.hint) {
      hintNode = el("span", { class: "qy-hint", id: id + "-hint", text: T.messageHint });
      describedBy.unshift(id + "-hint");
    }
    var input =
      def.type === "textarea"
        ? el("textarea", { class: "qy-input", id: id, name: def.name, rows: 5, maxlength: def.max, "aria-describedby": describedBy.join(" ") })
        : el("input", {
            class: "qy-input",
            id: id,
            name: def.name,
            type: def.type,
            maxlength: def.max,
            autocomplete: def.autocomplete || "off",
            inputmode: def.inputmode || null,
            required: def.required || null,
            "aria-required": def.required ? "true" : null,
            "aria-describedby": describedBy.join(" "),
          });
    if (def.value) input.value = clip(def.value, def.max);
    var err = el("span", { class: "qy-err", id: id + "-err" });
    inputs[def.name] = input;
    errors[def.name] = err;
    grid.appendChild(el("div", { class: "qy-field" + (def.full ? " qy-full" : "") }, [label, hintNode, input, err]));
  }

  // 蜜罐：人看不见、读屏跳过、不在 Tab 顺序里；机器人填了就假装成功
  var hpId = uid + "-hp";
  var hp = el("input", { type: "text", id: hpId, name: "_hp", tabindex: "-1", autocomplete: "off" });
  var hpWrap = el("div", { class: "qy-hp", "aria-hidden": "true" }, [el("label", { for: hpId, text: T.honeypot }), hp]);

  var button = el("button", { class: "qy-btn", type: "submit", text: T.submit });
  var status = el("div", { class: "qy-status", role: "status", "aria-live": "polite" });
  form.appendChild(grid);
  form.appendChild(hpWrap);
  form.appendChild(el("div", { class: "qy-actions" }, [button, status]));
  wrap.appendChild(form);
  root.appendChild(wrap);

  function mount() {
    var container = TARGET ? document.querySelector(TARGET) : null;
    if (container) container.appendChild(host);
    else if (script.parentNode && script.parentNode !== document.head && document.body && document.body.contains(script)) {
      script.parentNode.insertBefore(host, script.nextSibling);
    } else if (document.body) document.body.appendChild(host);
  }
  if (TARGET && document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else if (!document.body) document.addEventListener("DOMContentLoaded", mount);
  else mount();

  // 记录首访归因（脚本加载即记，不等提交）
  firstTouch();

  function setError(name, msg) {
    errors[name].textContent = msg || "";
    if (msg) inputs[name].setAttribute("aria-invalid", "true");
    else inputs[name].removeAttribute("aria-invalid");
  }

  function validate() {
    var firstBad = null;
    for (var i = 0; i < FIELDS.length; i++) {
      var name = FIELDS[i].name;
      var v = inputs[name].value.trim();
      var msg = "";
      if (FIELDS[i].required && !v) msg = T.errRequired;
      else if (name === "email" && v && !EMAIL_RE.test(v)) msg = T.errEmail;
      setError(name, msg);
      if (msg && !firstBad) firstBad = inputs[name];
    }
    if (firstBad) {
      setStatus(T.errFix, true);
      firstBad.focus();
      return false;
    }
    return true;
  }

  function setStatus(msg, bad) {
    status.textContent = msg || "";
    status.className = "qy-status" + (bad ? " qy-bad" : "");
  }

  var sending = false;
  var eventId = null;
  var lastBody = null;

  function setSending(on) {
    sending = on;
    button.disabled = on;
    button.textContent = on ? T.sending : T.submit;
    if (on) form.setAttribute("aria-busy", "true");
    else form.removeAttribute("aria-busy");
  }

  function collect() {
    var data = {};
    for (var i = 0; i < FIELDS.length; i++) data[FIELDS[i].name] = clip(inputs[FIELDS[i].name].value.trim(), FIELDS[i].max);
    return data;
  }

  function showSuccess(receiptId) {
    var title = el("h3", { tabindex: "-1", text: T.successTitle });
    var done = el("div", { class: "qy-done", role: "status" }, [title, el("p", { text: T.successBody })]);
    wrap.replaceChild(done, form);
    try {
      title.focus();
    } catch {
      /* ignore */
    }
    try {
      host.dispatchEvent(new CustomEvent("qingyan:inquiry-submitted", { bubbles: true, composed: true, detail: { receiptId: receiptId || null } }));
    } catch {
      /* ignore */
    }
  }

  function fail(msg, blocked) {
    setSending(false);
    setStatus(msg, true);
    if (blocked && window.console) {
      console.warn("[qingyan-embed] request was blocked or failed; check data-key and that this site's origin is in the allowed origins list");
    }
  }

  function send(payload, attempt) {
    setSending(true);
    var retry = function () {
      if (attempt >= 2) return false;
      setTimeout(function () {
        send(payload, attempt + 1);
      }, attempt === 0 ? 1500 : 4000);
      return true;
    };
    fetch(ENDPOINT, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json", "x-qingyan-form-key": KEY },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { status: res.status, body: body || {} };
          });
      })
      .then(function (r) {
        if (r.status === 200 && r.body.ok) {
          eventId = null;
          lastBody = null;
          setSending(false);
          showSuccess(r.body.receiptId);
          return;
        }
        // 服务端暂时失败：同一事件 id 重试（服务端按事件幂等，不会重复建询盘）
        if (r.status >= 500 && retry()) return;
        if (r.status === 429) return fail(T.errRate);
        if (r.status === 400 && (r.body.error === "invalid_email" || r.body.error === "email_required")) {
          setError("email", r.body.error === "invalid_email" ? T.errEmail : T.errRequired);
          inputs.email.focus();
          return fail(T.errFix);
        }
        fail(T.errGeneric, r.status === 401 || r.status === 403);
      })
      .catch(function () {
        // 网络错误，或 key / 来源不对导致浏览器拦下响应（不带 CORS 头）
        if (retry()) return;
        fail(T.errGeneric, true);
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;
    setStatus("", false);
    if (!validate()) return;
    var data = collect();
    var bodyKey = JSON.stringify(data);
    // 同一份内容重提交沿用同一事件 id（幂等）；内容改了就是新事件
    if (!eventId || bodyKey !== lastBody) {
      eventId = uuid();
      lastBody = bodyKey;
    }
    var touch = firstTouch();
    var payload = {
      eventId: eventId,
      page: pageUrl(),
      landing: clip(touch.landing || "", 500),
      referrer: clip(touch.referrer || "", 500),
      _hp: hp.value,
    };
    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
    for (var i = 0; i < UTM_KEYS.length; i++) if (touch[UTM_KEYS[i]]) payload[UTM_KEYS[i]] = clip(touch[UTM_KEYS[i]], 120);
    send(payload, 0);
  });
})();
