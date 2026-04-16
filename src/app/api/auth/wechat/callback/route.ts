import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import crypto from "crypto";

const STATE_COOKIE = "qy_wx_state";
const WX_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token";
const WX_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo";

interface WxTokenResponse {
  access_token?: string;
  openid?: string;
  errcode?: number;
  errmsg?: string;
}

interface WxUserInfo {
  openid: string;
  nickname?: string;
  headimgurl?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

function errorRedirect(request: NextRequest, reason: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/login?wechat=error&reason=${encodeURIComponent(reason)}`, request.url),
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const wxError = searchParams.get("error");

  if (wxError) {
    return errorRedirect(request, wxError);
  }

  if (!code || !state) {
    return errorRedirect(request, "missing_params");
  }

  // ── 验证 state（CSRF 防护）──────────────────────────
  const cookie = request.cookies.get(STATE_COOKIE)?.value;
  if (!cookie) {
    return errorRedirect(request, "state_expired");
  }

  const separatorIdx = cookie.indexOf(":");
  const savedState = cookie.slice(0, separatorIdx);
  const next = cookie.slice(separatorIdx + 1) || "/";

  if (!savedState || !crypto.timingSafeEqual(
    Buffer.from(state),
    Buffer.from(savedState),
  )) {
    return errorRedirect(request, "state_mismatch");
  }

  // ── 用 code 换 access_token + openid ───────────────
  const appId = process.env.WECHAT_OPEN_APP_ID?.trim();
  const appSecret = process.env.WECHAT_OPEN_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    return errorRedirect(request, "not_configured");
  }

  let tokenData: WxTokenResponse;
  try {
    const tokenUrl = `${WX_TOKEN_URL}?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`;
    const tokenRes = await fetch(tokenUrl);
    tokenData = await tokenRes.json();
  } catch (err) {
    console.error("[wechat-callback] token exchange failed:", err);
    return errorRedirect(request, "token_fail");
  }

  if (tokenData.errcode || !tokenData.access_token || !tokenData.openid) {
    console.error("[wechat-callback] token error:", tokenData);
    return errorRedirect(request, `wx_${tokenData.errcode || "unknown"}`);
  }

  const { access_token, openid } = tokenData;

  // ── 获取微信用户信息 ────────────────────────────────
  let userInfo: WxUserInfo;
  try {
    const infoUrl = `${WX_USERINFO_URL}?access_token=${access_token}&openid=${openid}&lang=zh_CN`;
    const infoRes = await fetch(infoUrl);
    userInfo = await infoRes.json();
  } catch (err) {
    console.error("[wechat-callback] userinfo failed:", err);
    return errorRedirect(request, "userinfo_fail");
  }

  if (userInfo.errcode) {
    console.error("[wechat-callback] userinfo error:", userInfo);
    return errorRedirect(request, `wx_info_${userInfo.errcode}`);
  }

  const wxNickname = userInfo.nickname || "微信用户";
  const wxAvatar = userInfo.headimgurl || null;

  // ── 查找或创建用户 ─────────────────────────────────
  let user = await db.user.findUnique({ where: { wechatOpenId: openid } });
  let isNewUser = false;

  if (!user) {
    const placeholderEmail = `wx_${openid.slice(0, 16)}@wechat.user`;
    user = await db.user.create({
      data: {
        email: placeholderEmail,
        name: wxNickname,
        nickname: wxNickname,
        avatar: wxAvatar,
        authProvider: "wechat",
        wechatOpenId: openid,
        status: "active",
      },
    });
    isNewUser = true;

    try {
      await bootstrapWeChatUser(user.id, wxNickname);
    } catch (err) {
      console.error("[wechat-callback] bootstrap failed:", err);
    }
  } else {
    await db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(wxAvatar && { avatar: wxAvatar }),
        ...(wxNickname !== "微信用户" && { nickname: wxNickname }),
      },
    });
  }

  if (user.status !== "active") {
    return errorRedirect(request, "account_disabled");
  }

  // ── 签发 session ────────────────────────────────────
  const token = await createSession({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.redirect(new URL(next, request.url));
  setSessionCookie(response, token);

  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  await logAudit({
    userId: user.id,
    action: isNewUser ? AUDIT_ACTIONS.CREATE : AUDIT_ACTIONS.LOGIN,
    targetType: AUDIT_TARGETS.USER,
    targetId: user.id,
    afterData: { provider: "wechat" },
    request,
  });

  return response;
}

async function bootstrapWeChatUser(userId: string, displayName: string) {
  const orgCode = `personal-${userId.slice(0, 8)}`;

  await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: `${displayName}的工作区`,
        code: orgCode,
        ownerId: userId,
        planType: "free",
      },
    });

    await tx.organizationMember.create({
      data: {
        orgId: org.id,
        userId,
        role: "org_admin",
        status: "active",
      },
    });
  });
}
