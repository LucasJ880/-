/**
 * MAIL-1 测试共用：只读 Gmail API 的假实现（不是测试文件，不需要注册）。
 * 记录每一次调用；读信不该碰的接口（history / getProfile / 附件下载）一调用就抛错。
 */

import {
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READONLY_SCOPE,
  type GmailReadApi,
  type GmailReadDeps,
} from "@/lib/google-email";

export const b64 = (s: string) =>
  Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

export type GmailCall = { api: string; args: Record<string, unknown> };

export type FakeGmailOptions = {
  listIds?: string[];
  nextPageToken?: string;
  /** threadId → threads.get(format=full) 的 data */
  threads?: Record<string, unknown>;
  threadError?: unknown;
  listError?: unknown;
  /** 每封邮件的主题 / 摘要 / 发件人（缺省按 id 生成） */
  subjectOf?: (id: string) => string;
  snippetOf?: (id: string) => string;
  from?: string;
};

export function fakeGmail(opts: FakeGmailOptions = {}): { api: GmailReadApi; calls: GmailCall[] } {
  const calls: GmailCall[] = [];
  const forbidden = (api: string) => async (args: Record<string, unknown>) => {
    calls.push({ api, args });
    throw new Error(`不应调用 ${api}`);
  };
  const api = {
    users: {
      getProfile: forbidden("getProfile"),
      history: { list: forbidden("history.list") },
      threads: {
        get: async (args: { id: string; format?: string }) => {
          calls.push({ api: "threads.get", args });
          if (opts.threadError) throw opts.threadError;
          const t = opts.threads?.[args.id];
          if (!t) throw { code: 404 };
          return { data: t };
        },
      },
      messages: {
        list: async (args: Record<string, unknown>) => {
          calls.push({ api: "messages.list", args });
          if (opts.listError) throw opts.listError;
          return {
            data: {
              messages: (opts.listIds ?? []).map((id) => ({ id, threadId: `t${id}` })),
              nextPageToken: opts.nextPageToken ?? null,
            },
          };
        },
        get: async (args: { id: string; format?: string }) => {
          calls.push({ api: "messages.get", args });
          return {
            data: {
              id: args.id,
              threadId: `t${args.id}`,
              labelIds: ["INBOX", "UNREAD"],
              internalDate: String(Date.UTC(2026, 10, 10, 15, 0, 0)),
              snippet: opts.snippetOf ? opts.snippetOf(args.id) : `摘要-${args.id}`,
              payload: {
                headers: [
                  { name: "From", value: opts.from ?? "王总 <client@example.com>" },
                  { name: "To", value: "lynn@sunny.example" },
                  { name: "Subject", value: opts.subjectOf ? opts.subjectOf(args.id) : `主题-${args.id}` },
                ],
              },
            },
          };
        },
        attachments: { get: forbidden("attachments.get") },
      },
    },
  } as unknown as GmailReadApi;
  return { api, calls };
}

export const READ_OK = `${GMAIL_COMPOSE_SCOPE} ${GMAIL_READONLY_SCOPE}`;

/** 已绑定且含读信权限的授权记录（令牌是占位，不会被解密：getGmail 被替换） */
export const PROVIDER = { id: "p1", accessToken: "enc", refreshToken: null, tokenExpiry: null, grantedScopes: READ_OK };

export function gmailDeps(api: GmailReadApi, provider: Record<string, unknown> | null): GmailReadDeps {
  return {
    getProvider: (async () => provider) as unknown as GmailReadDeps["getProvider"],
    getGmail: async () => api,
  };
}
