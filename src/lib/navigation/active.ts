/**
 * 统一 active path 判断
 */

export function pathMatches(
  pathname: string,
  href: string | undefined,
  opts?: { exact?: boolean; matchPaths?: string[] },
): boolean {
  if (opts?.matchPaths?.length) {
    return opts.matchPaths.some((p) => {
      if (p === "/") return pathname === "/";
      return pathname === p || pathname.startsWith(`${p}/`);
    });
  }
  if (!href) return false;
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
      pathname.startsWith("/operations/brand")
    );
  }

  return pathname === href || pathname.startsWith(`${href}/`);
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
  if (pathname.startsWith("/operations/brand")) return true;
  if (pathname.startsWith("/operations/assets")) return true;
  // 经营中心不属于增长
  if (isOperationsCenterPath(pathname)) return false;
  return false;
}
