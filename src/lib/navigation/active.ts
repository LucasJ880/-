/**
 * 统一 active path 判断（最长匹配 / 父子分离）
 */

export type PathMatchOptions = {
  exact?: boolean;
  matchPaths?: string[];
  /** `?view=pipeline` 或 `view=pipeline`；用于带 query 的导航 href */
  search?: string;
};

function normalizeSearch(search?: string): URLSearchParams {
  if (!search) return new URLSearchParams();
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

function pathPrefixMatch(pathname: string, base: string): boolean {
  if (!base) return false;
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** 带 query 的 href：pathname 必须相等，且所需 query 全匹配 */
function matchHrefWithQuery(
  pathname: string,
  href: string,
  search?: string,
): boolean {
  const qIndex = href.indexOf("?");
  const hrefPath = qIndex >= 0 ? href.slice(0, qIndex) : href;
  const hrefQuery = qIndex >= 0 ? href.slice(qIndex + 1) : "";
  if (pathname !== hrefPath) return false;
  if (!hrefQuery) return true;
  const required = new URLSearchParams(hrefQuery);
  const actual = normalizeSearch(search);
  for (const [key, value] of required.entries()) {
    const actualVal = actual.get(key);
    if (actualVal === value) continue;
    // 销售管道默认视图：裸 /sales 等价 view=pipeline
    if (
      hrefPath === "/sales" &&
      key === "view" &&
      value === "pipeline" &&
      actualVal === null
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function matchSinglePath(
  pathname: string,
  href: string | undefined,
  opts?: PathMatchOptions,
): boolean {
  if (!href) return false;

  if (href.includes("?")) {
    return matchHrefWithQuery(pathname, href, opts?.search);
  }

  if (opts?.exact || href === "/") return pathname === href;

  // /projects 不吞掉 /projects/intelligence
  if (href === "/projects") {
    return (
      pathname === "/projects" ||
      (pathname.startsWith("/projects/") &&
        !pathname.startsWith("/projects/intelligence"))
    );
  }

  // /operations 不吞掉 /operations/center|/growth|…
  if (href === "/operations") {
    return (
      pathname === "/operations" ||
      pathname.startsWith("/operations/calendar") ||
      pathname.startsWith("/operations/assets") ||
      pathname.startsWith("/operations/matrix") ||
      pathname.startsWith("/operations/review") ||
      pathname.startsWith("/operations/dashboard") ||
      (pathname.startsWith("/operations/brand") || pathname.startsWith("/operations/tender-profile"))
    );
  }

  return pathPrefixMatch(pathname, href);
}

/**
 * 单项是否匹配。matchPaths 与 href 为 OR：任一命中即可。
 */
export function pathMatches(
  pathname: string,
  href: string | undefined,
  opts?: PathMatchOptions,
): boolean {
  const hrefOk = matchSinglePath(pathname, href, opts);
  if (!opts?.matchPaths?.length) return hrefOk;
  const pathsOk = opts.matchPaths.some((p) =>
    matchSinglePath(pathname, p, { exact: false, search: opts.search }),
  );
  return hrefOk || pathsOk;
}

/** 匹配特异度：路径越长越优先；带 query 的同路径优于裸路径 */
export function matchSpecificity(
  pathname: string,
  href: string | undefined,
  opts?: PathMatchOptions,
): number {
  if (!pathMatches(pathname, href, opts)) return -1;

  let best = 0;

  if (href) {
    if (href.includes("?")) {
      if (matchHrefWithQuery(pathname, href, opts?.search)) {
        const [pathPart, qs = ""] = href.split("?");
        best = Math.max(best, pathPart.length * 1000 + qs.length + 1);
      }
    } else if (matchSinglePath(pathname, href, opts)) {
      const base = opts?.exact || href === "/" ? href.length * 1000 : href.length * 1000;
      best = Math.max(best, base);
    }
  }

  if (opts?.matchPaths?.length) {
    for (const p of opts.matchPaths) {
      if (pathPrefixMatch(pathname, p) || pathname === p) {
        best = Math.max(best, p.length * 1000);
      }
    }
  }

  return best;
}

export type ActiveCandidate = {
  key: string;
  href?: string;
  exact?: boolean;
  matchPaths?: string[];
};

/**
 * 在所有候选中只选一个最具体的叶子（href/matchPath 最长）。
 * 禁止短前缀（如 /sales）抢占 /sales/opportunities。
 */
export function pickActiveNavKey(
  pathname: string,
  candidates: ActiveCandidate[],
  search?: string,
): string | null {
  let bestKey: string | null = null;
  let bestScore = -1;
  let bestHrefLen = -1;

  for (const c of candidates) {
    const score = matchSpecificity(pathname, c.href, {
      exact: c.exact,
      matchPaths: c.matchPaths,
      search,
    });
    if (score < 0) continue;
    const hrefLen = (c.href || "").length;
    if (
      score > bestScore ||
      (score === bestScore && hrefLen > bestHrefLen)
    ) {
      bestScore = score;
      bestHrefLen = hrefLen;
      bestKey = c.key;
    }
  }

  return bestKey;
}

export function isCapabilitiesPath(pathname: string): boolean {
  return pathname === "/capabilities" || pathname.startsWith("/capabilities/");
}

export function isOperationsCenterPath(pathname: string): boolean {
  return (
    pathname === "/operations/center" ||
    pathname.startsWith("/operations/center/")
  );
}

export function isGrowthPath(pathname: string): boolean {
  if (pathname.startsWith("/operations/growth")) return true;
  if (pathname.startsWith("/operations/intelligence")) return true;
  if (pathname.startsWith("/product-content")) return true;
  if (pathname.startsWith("/marketing")) return true;
  if (pathname === "/operations" || pathname.startsWith("/operations/calendar"))
    return true;
  if ((pathname.startsWith("/operations/brand") || pathname.startsWith("/operations/tender-profile"))) return true;
  if (pathname.startsWith("/operations/assets")) return true;
  // 经营中心不属于增长
  if (isOperationsCenterPath(pathname)) return false;
  return false;
}
