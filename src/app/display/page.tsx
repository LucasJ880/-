"use client";

/**
 * 门口大屏展示页 — /display
 *
 * 全屏 kiosk 页面（独立于主应用布局，无侧边栏/登录态），品牌叙事为主：
 *   板块 1  品牌主视觉：Sunny logo + 智能遮阳与建筑节能定位 + 实时时钟
 *   板块 2  全国服务网络：30,000+ 家庭 + 五大城市标志性工程
 *   板块 3  交钥匙工程流程：测量 → 图纸 → 制造 → 电动化 → 安装 → 售后
 *   板块 4  智能化与 AI：产品体系 + 青砚 AI 项目管理（效果图轮播可选）
 *
 * 色彩系统：爱马仕橙 #F0651E 主色（家的温暖）+ 生态绿 #4ADE80 点缀（绿色能源），
 * 底色为暖棕橙渐变 + 大面积橙色光晕（明亮抢眼，非深黑底）。
 * 动效：漂移光晕、板块内容渐入、标题流光、大数字呼吸光、底部跑马灯。
 * 内容全静态无外部依赖，断网也正常显示。电视端浏览器全屏（kiosk 模式）即可。
 */

import { useEffect, useRef, useState } from "react";

const PANEL_COUNT = 6;
const PANEL_INTERVAL_MS = 18_000;
const SHOWCASE_CANDIDATES = [1, 2, 3, 4, 5, 6].map(
  (i) => `/display/showcase-${i}.jpg`,
);

/** 品牌色 */
const ORANGE = "#F0651E"; // 爱马仕橙
const GREEN = "#4ADE80"; // 生态绿

/** 标志性工程城市（东西横贯，体现全国服务能力） */
const CITIES = [
  { en: "VANCOUVER", zh: "温哥华" },
  { en: "CALGARY", zh: "卡尔加里" },
  { en: "WINNIPEG", zh: "温尼伯" },
  { en: "TORONTO", zh: "多伦多" },
  { en: "OTTAWA", zh: "渥太华" },
];

/** 交钥匙工程流程（与 turnkey solutions 定位对齐） */
const TURNKEY_STEPS = [
  { en: "Site Measurement", zh: "现场测量" },
  { en: "Shop Drawings", zh: "深化图纸" },
  { en: "Local Manufacturing", zh: "本地制造" },
  { en: "Motorization", zh: "电动智能化" },
  { en: "Installation", zh: "专业安装" },
  { en: "After-Sales Service", zh: "售后服务" },
];

/** 产品与能力体系 */
const CAPABILITIES = [
  { en: "Custom Shading Systems", zh: "定制遮阳系统" },
  { en: "Motorized Blinds", zh: "电动窗帘" },
  { en: "Solar-Control Coverings", zh: "阳光控制产品" },
  { en: "Smart Control Integration", zh: "智能控制集成" },
];

/** 电机技术合作伙伴（logo 置于浅色卡片，避免深底吃色） */
const PARTNERS = [
  { src: "/display/partners/lutron.jpg", en: "Lutron", zh: "路创 · 美国" },
  { src: "/display/partners/somfy.svg", en: "Somfy", zh: "尚飞 · 法国" },
  { src: "/display/partners/dooya.png", en: "Dooya", zh: "杜亚" },
  { src: "/display/partners/jiecang.png", en: "Jiecang", zh: "捷昌驱动" },
];

/** 客户墙 */
const CLIENTS = [
  { src: "/display/clients/bmo.svg", name: "BMO" },
  { src: "/display/clients/td.png", name: "TD Bank" },
  { src: "/display/clients/pcl.svg", name: "PCL Construction" },
  { src: "/display/clients/canada.svg", name: "Government of Canada" },
  { src: "/display/clients/mott32.jpg", name: "Mott 32" },
  { src: "/display/clients/bo.svg", name: "Bang & Olufsen" },
  { src: "/display/clients/rru.png", name: "Royal Roads University" },
  { src: "/display/clients/pdgh.png", name: "Portage District General Hospital" },
];

/** 底部跑马灯内容 */
const TICKER_ITEMS = [
  "SERVING ALL OF CANADA · 服务全加拿大",
  "30,000+ FAMILIES SERVED · 服务超三万家庭",
  "商业建筑 COMMERCIAL",
  "政府项目 INSTITUTIONAL",
  "学校 SCHOOLS",
  "酒店 HOTELS",
  "办公楼 OFFICES",
  "住宅项目 RESIDENTIAL",
  "REDUCE HEAT GAIN · 降低太阳热增益",
  "ENERGY EFFICIENCY · 建筑节能",
  "MADE IN CANADA · 加拿大本地制造",
];

// ── 数字滚动动画 ─────────────────────────────────────────────

function useCountUp(target: number, active: boolean, durationMs = 2200): number {
  const [value, setValue] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!active) {
      doneRef.current = false;
      setValue(0);
      return;
    }
    if (doneRef.current) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else doneRef.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, durationMs]);

  return value;
}

/** 板块激活时给子元素加渐入动画（带层级延迟） */
function riseIn(active: boolean, delayMs = 0): React.CSSProperties {
  if (!active) return { opacity: 0 };
  return {
    animation: `riseIn 0.9s ease ${delayMs}ms both`,
  };
}

// ── 时钟 ─────────────────────────────────────────────────────

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <div className="text-center">
      <div className="font-mono text-[4.5vw] font-light leading-none text-white/90">
        {now.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false })}
      </div>
      <div className="mt-2 text-[1vw] tracking-[0.4em] text-white/40">
        {now.toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

// ── 效果图轮播（public/display/showcase-*.jpg，存在才显示）──

function Showcase() {
  const [available, setAvailable] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      SHOWCASE_CANDIDATES.map(
        (src) =>
          new Promise<string | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(src);
            img.onerror = () => resolve(null);
            img.src = src;
          }),
      ),
    ).then((results) => {
      if (!cancelled) setAvailable(results.filter((s): s is string => Boolean(s)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (available.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % available.length), 6000);
    return () => clearInterval(t);
  }, [available.length]);

  if (available.length === 0) return null;
  return (
    <div className="relative h-[46vh] w-[38vw] overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
      {available.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          className={
            "absolute inset-0 h-full w-full object-cover transition-all duration-1000 " +
            (i === index ? "scale-100 opacity-100" : "scale-105 opacity-0")
          }
        />
      ))}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-6 py-4 text-[0.95vw] tracking-widest text-white/80">
        PROJECT GALLERY · 项目实景
      </div>
    </div>
  );
}

// ── 主页面 ───────────────────────────────────────────────────

export default function DisplayPage() {
  const [panel, setPanel] = useState(0);
  const families = useCountUp(30000, panel === 1);

  useEffect(() => {
    const t = setInterval(() => setPanel((p) => (p + 1) % PANEL_COUNT), PANEL_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="fixed inset-0 overflow-hidden text-white"
      style={{
        background: [
          // 左上/右下两团大面积暖橙光，让屏幕整体"发亮"
          "radial-gradient(120vh at 12% -5%, rgba(240,101,30,0.50), transparent 62%)",
          "radial-gradient(110vh at 90% 105%, rgba(240,101,30,0.40), transparent 62%)",
          // 中部一抹生态绿呼应能源主题
          "radial-gradient(90vh at 58% 42%, rgba(74,222,128,0.10), transparent 60%)",
          // 底层暖棕渐变（替代原先近黑底）
          "linear-gradient(155deg, #47200b 0%, #331508 45%, #24100a 100%)",
        ].join(", "),
      }}
    >
      {/* 全局动效 keyframes */}
      <style>{`
        @keyframes riseIn {
          from { opacity: 0; transform: translateY(28px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes drift1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(8vw, 6vh) scale(1.15); }
        }
        @keyframes drift2 {
          0%, 100% { transform: translate(0, 0) scale(1.1); }
          50% { transform: translate(-7vw, -5vh) scale(0.95); }
        }
        @keyframes drift3 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
          50% { transform: translate(4vw, -8vh) scale(1.2); opacity: 0.9; }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes breathe {
          0%, 100% { text-shadow: 0 0 40px rgba(240, 101, 30, 0.35); }
          50% { text-shadow: 0 0 90px rgba(240, 101, 30, 0.75); }
        }
        @keyframes ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes dotPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5); }
          50% { box-shadow: 0 0 0 6px rgba(74, 222, 128, 0); }
        }
      `}</style>

      {/* 背景漂移光晕：爱马仕橙（温暖）×2 + 生态绿（能源）×1 */}
      <div
        className="pointer-events-none absolute -left-[15%] -top-[20%] h-[80vh] w-[80vh] rounded-full blur-[130px]"
        style={{ background: "rgba(255,140,60,0.30)", animation: "drift1 16s ease-in-out infinite" }}
      />
      <div
        className="pointer-events-none absolute -bottom-[20%] -right-[10%] h-[75vh] w-[75vh] rounded-full blur-[130px]"
        style={{ background: "rgba(255,140,60,0.22)", animation: "drift2 20s ease-in-out infinite" }}
      />
      <div
        className="pointer-events-none absolute left-[40%] top-[30%] h-[50vh] w-[50vh] rounded-full blur-[140px]"
        style={{ background: "rgba(74,222,128,0.14)", animation: "drift3 18s ease-in-out infinite" }}
      />

      {/* 顶栏：logo + 定位 */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-[3.5vw] py-[2.5vh]">
        <div className="flex items-center gap-[1vw]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Sunny" className="h-[8.5vh] w-auto" />
          <div className="hidden border-l border-white/15 pl-[1vw] text-[0.85vw] leading-snug tracking-[0.2em] text-white/60 md:block">
            SMART SHADING &<br />
            <span style={{ color: GREEN }}>ENERGY EFFICIENCY</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[0.9vw] tracking-[0.3em]" style={{ color: "rgba(240,101,30,0.85)" }}>
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: GREEN, animation: "dotPulse 2.5s ease-in-out infinite" }}
          />
          SERVING ALL OF CANADA · 服务全加拿大
        </div>
      </div>

      {/* 板块 1：品牌主视觉 */}
      <section
        className={
          "absolute inset-0 flex flex-col items-center justify-center gap-[5vh] transition-opacity duration-1000 " +
          (panel === 0 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div className="text-center">
          <div style={{ ...riseIn(panel === 0, 0), color: ORANGE, letterSpacing: "0.6em" }} className="text-[1.1vw]">
            SUNNY SHUTTER INC.
          </div>
          <div style={riseIn(panel === 0, 150)} className="mt-[3vh] text-[3.4vw] font-bold leading-tight">
            <span
              style={{
                backgroundImage: `linear-gradient(110deg, #fff 30%, ${ORANGE} 45%, #fff 60%)`,
                backgroundSize: "200% auto",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                animation: "shimmer 6s linear infinite",
              }}
            >
              Smart Shading
            </span>
            <span className="text-white/90"> & </span>
            <span style={{ color: GREEN }}>Building Energy Efficiency</span>
          </div>
          <div style={riseIn(panel === 0, 300)} className="mt-4 text-[1.6vw] font-light text-white/85">
            智能遮阳 · 建筑节能解决方案
          </div>
          <div
            style={riseIn(panel === 0, 450)}
            className="mx-auto mt-[3vh] max-w-[62vw] text-[1.05vw] font-light leading-relaxed text-white/70"
          >
            A Canadian smart shading and building energy-efficiency solutions company —
            custom-manufactured shading systems, motorized blinds, solar-control coverings
            and integrated smart control for commercial, institutional and residential buildings.
          </div>
        </div>
        <div style={riseIn(panel === 0, 600)}>
          <Clock />
        </div>
      </section>

      {/* 板块 2：全国服务网络 */}
      <section
        className={
          "absolute inset-0 flex flex-col items-center justify-center gap-[6vh] transition-opacity duration-1000 " +
          (panel === 1 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div style={riseIn(panel === 1, 0)} className="text-[1.3vw] tracking-[0.5em] text-white/60">
          NATIONWIDE SERVICE · 全国服务网络
        </div>
        <div style={riseIn(panel === 1, 150)} className="flex flex-col items-center gap-3">
          <div
            className="font-mono text-[9vw] font-bold leading-none tracking-tight"
            style={{ color: ORANGE, animation: panel === 1 ? "breathe 4s ease-in-out infinite" : undefined }}
          >
            {families.toLocaleString()}
            <span className="text-[4vw]" style={{ color: "rgba(240,101,30,0.8)" }}>+</span>
          </div>
          <div className="text-[1.5vw] font-light tracking-[0.3em] text-white/70">
            FAMILIES SERVED · 温暖三万个家
          </div>
        </div>
        <div className="flex items-center gap-[3vw]">
          {CITIES.map((c, i) => (
            <div key={c.en} className="flex items-center gap-[3vw]" style={riseIn(panel === 1, 300 + i * 120)}>
              <div className="text-center">
                <div className="text-[1.4vw] font-semibold tracking-wider">{c.en}</div>
                <div className="mt-1 text-[0.95vw] font-light text-white/65">{c.zh}</div>
              </div>
              {i < CITIES.length - 1 && (
                <div className="h-1.5 w-1.5 rounded-full" style={{ background: "rgba(240,101,30,0.6)" }} />
              )}
            </div>
          ))}
        </div>
        <div style={{ ...riseIn(panel === 1, 900), color: "rgba(240,101,30,0.65)" }} className="text-[1vw] tracking-[0.35em]">
          LANDMARK PROJECTS COAST TO COAST · 五大城市标志性工程
        </div>
      </section>

      {/* 板块 3：交钥匙工程 */}
      <section
        className={
          "absolute inset-0 flex flex-col items-center justify-center gap-[7vh] transition-opacity duration-1000 " +
          (panel === 2 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div style={riseIn(panel === 2, 0)} className="text-[1.3vw] tracking-[0.5em] text-white/60">
          TURNKEY SHADING SOLUTIONS · 交钥匙遮阳工程
        </div>
        <div className="flex items-center">
          {TURNKEY_STEPS.map((s, i) => (
            <div key={s.en} className="flex items-center" style={riseIn(panel === 2, 150 + i * 130)}>
              <div
                className="flex w-[12.5vw] flex-col items-center gap-2 rounded-2xl px-[1vw] py-[3.5vh]"
                style={{ border: "1px solid rgba(240,101,30,0.4)", background: "rgba(255,255,255,0.07)" }}
              >
                <div className="font-mono text-[1vw]" style={{ color: "rgba(240,101,30,0.85)" }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="text-center text-[1.05vw] font-semibold leading-snug">{s.en}</div>
                <div className="text-[0.9vw] font-light text-white/65">{s.zh}</div>
              </div>
              {i < TURNKEY_STEPS.length - 1 && (
                <div className="w-[1.2vw] border-t border-dashed" style={{ borderColor: "rgba(240,101,30,0.4)" }} />
              )}
            </div>
          ))}
        </div>
        <div style={riseIn(panel === 2, 1000)} className="flex gap-[2vw]">
          {["商业建筑 COMMERCIAL", "政府项目 INSTITUTIONAL", "学校 SCHOOLS", "酒店 HOTELS", "办公楼 OFFICES", "住宅项目 RESIDENTIAL"].map((s) => (
            <div key={s} className="text-[0.85vw] tracking-wider text-white/45">
              {s}
            </div>
          ))}
        </div>
      </section>

      {/* 板块 4：电机技术合作伙伴 */}
      <section
        className={
          "absolute inset-0 flex flex-col items-center justify-center gap-[7vh] transition-opacity duration-1000 " +
          (panel === 3 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div style={riseIn(panel === 3, 0)} className="text-[1.3vw] tracking-[0.5em] text-white/60">
          MOTORIZATION PARTNERS · 电机技术合作伙伴
        </div>
        <div className="grid grid-cols-4 gap-[2vw]">
          {PARTNERS.map((p, i) => (
            <div
              key={p.en}
              className="flex flex-col items-center gap-[2vh]"
              style={riseIn(panel === 3, 150 + i * 150)}
            >
              <div className="flex h-[18vh] w-[17vw] items-center justify-center rounded-2xl bg-white/95 px-[2vw] shadow-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.en} className="max-h-[10vh] max-w-[13vw] object-contain" />
              </div>
              <div className="text-center">
                <div className="text-[1.1vw] font-semibold">{p.en}</div>
                <div className="mt-0.5 text-[0.85vw] font-light text-white/65">{p.zh}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...riseIn(panel === 3, 800), color: "rgba(240,101,30,0.65)" }} className="text-[1vw] tracking-[0.35em]">
          WORLD-CLASS MOTORIZATION TECHNOLOGY · 全球一线电动化技术
        </div>
      </section>

      {/* 板块 5：客户墙 */}
      <section
        className={
          "absolute inset-0 flex flex-col items-center justify-center gap-[6vh] transition-opacity duration-1000 " +
          (panel === 4 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div style={riseIn(panel === 4, 0)} className="text-[1.3vw] tracking-[0.5em] text-white/60">
          TRUSTED BY · 他们选择了 SUNNY
        </div>
        <div className="grid grid-cols-4 gap-[1.6vw]">
          {CLIENTS.map((c, i) => (
            <div
              key={c.name}
              className="flex flex-col items-center gap-[1.5vh]"
              style={riseIn(panel === 4, 120 + i * 110)}
            >
              <div className="flex h-[15vh] w-[17vw] items-center justify-center rounded-2xl bg-white/95 px-[1.5vw] shadow-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.src} alt={c.name} className="max-h-[9vh] max-w-[13vw] object-contain" />
              </div>
              <div className="max-w-[17vw] text-center text-[0.9vw] font-light leading-snug text-white/75">
                {c.name}
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...riseIn(panel === 4, 1100), color: "rgba(240,101,30,0.65)" }} className="text-[1vw] tracking-[0.35em]">
          BANKS · GOVERNMENT · CONSTRUCTION · HOSPITALITY · EDUCATION · HEALTHCARE
        </div>
      </section>

      {/* 板块 6：智能化与 AI */}
      <section
        className={
          "absolute inset-0 flex items-center justify-center gap-[5vw] transition-opacity duration-1000 " +
          (panel === 5 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div className="flex max-w-[42vw] flex-col gap-[5vh]">
          <div style={riseIn(panel === 5, 0)} className="text-[1.3vw] tracking-[0.5em] text-white/60">
            SMART BUILDINGS · 建筑智能化
          </div>
          <div className="grid grid-cols-2 gap-[1.2vw]">
            {CAPABILITIES.map((c, i) => (
              <div
                key={c.en}
                className="rounded-2xl px-[1.5vw] py-[3vh]"
                style={{
                  ...riseIn(panel === 5, 150 + i * 130),
                  border: "1px solid rgba(240,101,30,0.4)",
                  background: "rgba(255,255,255,0.07)",
                }}
              >
                <div className="text-[1.15vw] font-semibold leading-snug">{c.en}</div>
                <div className="mt-1 text-[0.95vw] font-light text-white/65">{c.zh}</div>
              </div>
            ))}
          </div>
          <div
            className="rounded-2xl px-[1.5vw] py-[2.5vh]"
            style={{
              ...riseIn(panel === 5, 700),
              border: "1px solid rgba(74,222,128,0.35)",
              background: "linear-gradient(120deg, rgba(240,101,30,0.08), rgba(74,222,128,0.07))",
            }}
          >
            <div className="text-[1.1vw] font-semibold" style={{ color: GREEN }}>
              AI-Assisted Project Management · 青砚 AI 项目管理
            </div>
            <div className="mt-2 text-[0.95vw] font-light leading-relaxed text-white/60">
              从测量、报价到安装交付，全流程由自研 AI 系统驱动 —
              improving occupant comfort, reducing heat gain and modernizing building operations.
            </div>
          </div>
        </div>
        <div style={riseIn(panel === 5, 400)}>
          <Showcase />
        </div>
      </section>

      {/* 底部跑马灯 */}
      <div className="absolute bottom-[7vh] left-0 right-0 overflow-hidden border-t border-white/[0.06] py-[1.2vh]">
        <div
          className="flex w-max whitespace-nowrap"
          style={{ animation: "ticker 50s linear infinite" }}
        >
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center">
              {TICKER_ITEMS.map((item, i) => (
                <div key={`${dup}-${i}`} className="flex items-center">
                  <span className="text-[0.85vw] tracking-[0.25em] text-white/55">{item}</span>
                  <span
                    className="mx-[1.6vw] inline-block h-1 w-1 rounded-full"
                    style={{ background: i % 3 === 2 ? GREEN : ORANGE, opacity: 0.6 }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 底部板块指示点 */}
      <div className="absolute bottom-[3vh] left-1/2 flex -translate-x-1/2 gap-3">
        {Array.from({ length: PANEL_COUNT }).map((_, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all duration-500"
            style={{
              width: i === panel ? "2rem" : "0.375rem",
              background: i === panel ? ORANGE : "rgba(255,255,255,0.2)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
