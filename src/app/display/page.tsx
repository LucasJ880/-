"use client";

/**
 * 门口大屏展示页 — /display?token=DISPLAY_TOKEN
 *
 * 全屏深色 kiosk 页面（独立于主应用布局，无侧边栏/登录态）：
 *   板块 1  品牌主视觉：Sunny + SmartShade 定位语 + 实时时钟
 *   板块 2  经营脉搏：聚合数字滚动动画
 *   板块 3  青砚 AI：AI 工作数据 + 效果图轮播（public/display/showcase-*.jpg，可选）
 *
 * 数据每 60 秒刷新，板块每 18 秒轮换；断网时保留上一次数据不黑屏。
 * 电视端浏览器打开本页并全屏（kiosk 模式）即可。
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Summary {
  customersTotal: number;
  customersThisMonth: number;
  installsCompleted: number;
  ordersInProgress: number;
  rendersTotal: number;
  aiMessagesToday: number;
}

const PANEL_COUNT = 4;

/** 品牌事实（与 sunnyshutter.ca 对齐） */
const PRODUCTS = [
  { en: "Zebra Blinds", zh: "斑马帘" },
  { en: "Roller Shades", zh: "卷帘" },
  { en: "Motorized Blinds", zh: "电动智能帘" },
  { en: "Honeycomb Shades", zh: "蜂巢帘" },
  { en: "Vinyl Shutters", zh: "百叶窗" },
  { en: "Drapery & Sheers", zh: "窗帘与窗纱" },
];
const USPS = [
  "FACTORY DIRECT · 工厂直销",
  "MADE IN CANADA · 加拿大制造",
  "PERFECT FIT GUARANTEE · 完美贴合保证",
  "FREE IN-HOME CONSULTATION · 免费上门量房",
];
const PANEL_INTERVAL_MS = 18_000;
const REFRESH_INTERVAL_MS = 60_000;
const SHOWCASE_CANDIDATES = [1, 2, 3, 4, 5, 6].map(
  (i) => `/display/showcase-${i}.jpg`,
);

// ── 数字滚动动画 ─────────────────────────────────────────────

function useCountUp(target: number, durationMs = 1600): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

function BigStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const display = useCountUp(value);
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={
          "font-mono text-[7vw] font-bold leading-none tracking-tight " +
          (accent ? "text-amber-300" : "text-white")
        }
      >
        {display.toLocaleString()}
      </div>
      <div className="text-[1.4vw] font-light tracking-[0.3em] text-white/50">
        {label}
      </div>
    </div>
  );
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
      <div className="font-mono text-[6vw] font-light leading-none text-white">
        {now.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false })}
      </div>
      <div className="mt-3 text-[1.2vw] tracking-[0.4em] text-white/40">
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
    <div className="relative h-[46vh] w-[42vw] overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
      {available.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          className={
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 " +
            (i === index ? "opacity-100" : "opacity-0")
          }
        />
      ))}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-6 py-4 text-[1vw] tracking-widest text-white/80">
        青砚 AI · 拍照即见装好效果
      </div>
    </div>
  );
}

// ── 主页面 ───────────────────────────────────────────────────

function DisplayContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [panel, setPanel] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/display/summary?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) {
          setSummary(data);
          setError(false);
        }
      } catch {
        // 断网/失败：保留上一次数据，不黑屏
        if (!cancelled) setError(true);
      }
    }
    load();
    const t = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  useEffect(() => {
    const t = setInterval(() => setPanel((p) => (p + 1) % PANEL_COUNT), PANEL_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05070f] text-white">
      {/* 背景光晕（极慢流动） */}
      <div className="pointer-events-none absolute -left-1/4 -top-1/4 h-[80vh] w-[80vh] animate-pulse rounded-full bg-blue-600/10 blur-[120px] [animation-duration:8s]" />
      <div className="pointer-events-none absolute -bottom-1/4 -right-1/4 h-[70vh] w-[70vh] animate-pulse rounded-full bg-amber-500/10 blur-[120px] [animation-duration:11s]" />

      {/* 顶栏 */}
      <div className="absolute left-0 right-0 top-0 flex items-center justify-between px-[4vw] py-[2.5vh]">
        <div className="text-[1.6vw] font-bold tracking-[0.25em]">SUNNY SHUTTER</div>
        <div className="text-[1vw] tracking-[0.3em] text-white/40">
          POWERED BY 青砚 AI{error ? " · OFFLINE" : ""}
        </div>
      </div>

      {/* 板块 1：品牌主视觉 */}
      <section
        className={
          "absolute inset-0 flex flex-col items-center justify-center gap-[5vh] transition-opacity duration-1000 " +
          (panel === 0 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <Clock />
        <div className="text-center">
          <div className="text-[3.2vw] font-bold leading-tight">
            Premium Window Treatments
          </div>
          <div className="mt-5 text-[1.6vw] font-light leading-snug text-white/85">
            SmartShade Retrofit
            <span className="text-amber-300"> & </span>
            Energy Optimization
          </div>
          <div className="mt-3 text-[1.1vw] font-light tracking-[0.35em] text-white/50">
            FOR HOMES & COMMERCIAL BUILDINGS · 智能遮阳改造与能耗优化
          </div>
        </div>
        <div className="text-[1vw] tracking-[0.25em] text-white/35">
          680 PROGRESS AVE UNIT 2, SCARBOROUGH · 647-857-8669 · SERVING TORONTO & GTA
        </div>
      </section>

      {/* 板块 2：产品与优势 */}
      <section
        className={
          "absolute inset-0 flex flex-col items-center justify-center gap-[7vh] transition-opacity duration-1000 " +
          (panel === 1 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div className="text-[1.4vw] tracking-[0.5em] text-white/40">
          OUR PRODUCTS · 产品系列
        </div>
        <div className="grid grid-cols-3 gap-[2vw]">
          {PRODUCTS.map((p) => (
            <div
              key={p.en}
              className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-[3vw] py-[3.5vh]"
            >
              <div className="text-[1.5vw] font-semibold">{p.en}</div>
              <div className="text-[1vw] font-light text-white/50">{p.zh}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-[2.5vw]">
          <div className="flex items-center gap-2 text-[1.2vw] font-semibold text-amber-300">
            ★ 4.7<span className="text-[0.9vw] font-light text-white/50">GOOGLE RATING</span>
          </div>
          {USPS.map((u) => (
            <div key={u} className="text-[0.85vw] tracking-wider text-white/45">
              {u}
            </div>
          ))}
        </div>
      </section>

      {/* 板块 3：经营脉搏 */}
      <section
        className={
          "absolute inset-0 flex flex-col items-center justify-center gap-[8vh] transition-opacity duration-1000 " +
          (panel === 2 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div className="text-[1.4vw] tracking-[0.5em] text-white/40">BUSINESS PULSE · 经营脉搏</div>
        {summary && panel === 2 && (
          <div className="grid grid-cols-2 gap-x-[12vw] gap-y-[8vh]">
            <BigStat label="服务客户 CUSTOMERS" value={summary.customersTotal} />
            <BigStat label="完成安装 INSTALLED" value={summary.installsCompleted} />
            <BigStat label="本月新增 THIS MONTH" value={summary.customersThisMonth} accent />
            <BigStat label="进行中订单 IN PROGRESS" value={summary.ordersInProgress} />
          </div>
        )}
      </section>

      {/* 板块 4：青砚 AI */}
      <section
        className={
          "absolute inset-0 flex items-center justify-center gap-[6vw] transition-opacity duration-1000 " +
          (panel === 3 ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        <div className="flex flex-col gap-[8vh]">
          <div className="text-[1.4vw] tracking-[0.5em] text-white/40">AI AT WORK · 青砚在工作</div>
          {summary && panel === 3 && (
            <>
              <BigStat label="AI 效果图 RENDERS" value={summary.rendersTotal} accent />
              <BigStat label="今日 AI 消息 MESSAGES TODAY" value={summary.aiMessagesToday} />
            </>
          )}
        </div>
        <Showcase />
      </section>

      {/* 底部板块指示点 */}
      <div className="absolute bottom-[3vh] left-1/2 flex -translate-x-1/2 gap-3">
        {Array.from({ length: PANEL_COUNT }).map((_, i) => (
          <div
            key={i}
            className={
              "h-1.5 rounded-full transition-all duration-500 " +
              (i === panel ? "w-8 bg-amber-300" : "w-1.5 bg-white/20")
            }
          />
        ))}
      </div>
    </div>
  );
}

export default function DisplayPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#05070f]" />}>
      <DisplayContent />
    </Suspense>
  );
}
