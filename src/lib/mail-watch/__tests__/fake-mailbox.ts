/**
 * MAIL-2 测试共用：内存里的假邮箱（不是测试文件，不需要注册）。
 * 模拟 Gmail 的历史增量（history.list）、线程成员（threads.get minimal）、邮件元数据（messages.get metadata）。
 * 记录每一次调用；来信观察不该碰的接口（附件、修改、发送、草稿、取正文）一调用就抛错。
 */

import type { GmailReadApi, GmailReadDeps } from "@/lib/google-email";
import { GMAIL_COMPOSE_SCOPE, GMAIL_READONLY_SCOPE } from "@/lib/google-email";

export type FakeMail = {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  labels: string[];
  date: number;
  rfcMessageId?: string | null;
  replyTo?: string;
  /** 正文：假邮箱里有，但元数据接口从不返回它（用来断言正文没有流出） */
  body?: string;
};

export type MailboxCall = { api: string; args: Record<string, unknown> };

export const READ_SCOPES = `${GMAIL_COMPOSE_SCOPE} ${GMAIL_READONLY_SCOPE} https://www.googleapis.com/auth/userinfo.email`;
export const COMPOSE_ONLY_SCOPES = `${GMAIL_COMPOSE_SCOPE} https://www.googleapis.com/auth/userinfo.email`;

export class FakeMailbox {
  private seq = 1000;
  private records: Array<{ id: number; messageIds: string[] }> = [];
  readonly messages = new Map<string, FakeMail>();
  readonly calls: MailboxCall[] = [];
  /** 下一次 history.list 返回 404（游标过期），用一次即清 */
  expireNextHistory = false;
  /** 这些邮件读元数据时抛错 */
  readonly failingMessageIds = new Set<string>();
  /** history.list 每页多少条记录（测试翻页用） */
  pageSize = 100;
  /** 所有调用都抛这个错（授权失效等） */
  failAll: unknown = null;
  private n = 0;

  /** idPrefix：自动编号的邮件 id 前缀。Gmail 的邮件 id 只在一个邮箱内唯一，多个假邮箱用不同前缀 */
  constructor(private readonly idPrefix = "m") {}

  /** 当前位置（getProfile 的 historyId） */
  get head(): string {
    return String(this.seq);
  }

  /** 投递一封信：生成一条历史记录。不给 id 就自动编号；不给 threadId 就是新线程 */
  deliver(mail: Partial<FakeMail> & { from: string; subject: string }): FakeMail {
    const id = mail.id ?? `${this.idPrefix}${(++this.n).toString(16).padStart(6, "0")}`;
    const full: FakeMail = {
      id,
      threadId: mail.threadId ?? id,
      from: mail.from,
      to: mail.to ?? "owner@fixture.test",
      subject: mail.subject,
      labels: mail.labels ?? ["INBOX", "UNREAD"],
      date: mail.date ?? Date.UTC(2026, 10, 12, 15, 0, 0),
      rfcMessageId: mail.rfcMessageId === undefined ? `<${id}@mail.fixture.test>` : mail.rfcMessageId,
      replyTo: mail.replyTo ?? "",
      body: mail.body ?? "这是正文，来信观察不应该读到它。",
    };
    this.messages.set(id, full);
    this.records.push({ id: ++this.seq, messageIds: [id] });
    return full;
  }

  /** 放进邮箱但不产生历史记录（比如青砚自己发出的那封，或首次勾选前的旧信之外的线程成员） */
  seed(mail: Partial<FakeMail> & { id: string; from: string; subject: string }): FakeMail {
    const full: FakeMail = {
      id: mail.id,
      threadId: mail.threadId ?? mail.id,
      from: mail.from,
      to: mail.to ?? "client@example.com",
      subject: mail.subject,
      labels: mail.labels ?? ["SENT"],
      date: mail.date ?? Date.UTC(2026, 10, 10, 15, 0, 0),
      rfcMessageId: mail.rfcMessageId ?? `<${mail.id}@mail.fixture.test>`,
      replyTo: "",
      body: mail.body ?? "",
    };
    this.messages.set(full.id, full);
    return full;
  }

  callsOf(api: string): MailboxCall[] {
    return this.calls.filter((c) => c.api === api);
  }

  api(): GmailReadApi {
    const record = (api: string, args: Record<string, unknown>) => {
      this.calls.push({ api, args });
      if (this.failAll) throw this.failAll;
    };
    const forbidden = (api: string) => async (args: Record<string, unknown>) => {
      this.calls.push({ api, args });
      throw new Error(`来信观察不应调用 ${api}`);
    };
    const api = {
      users: {
        getProfile: async (args: Record<string, unknown>) => {
          record("getProfile", args);
          return { data: { historyId: this.head } };
        },
        history: {
          list: async (args: { startHistoryId: string; historyTypes?: string[]; labelId?: string; pageToken?: string }) => {
            record("history.list", args);
            if (this.expireNextHistory) {
              this.expireNextHistory = false;
              throw Object.assign(new Error("Requested entity was not found."), { code: 404 });
            }
            const start = Number(args.startHistoryId);
            const eligible = this.records
              .filter((r) => r.id > start)
              .map((r) => ({
                id: r.id,
                messageIds: r.messageIds.filter((id) => !args.labelId || this.messages.get(id)?.labels.includes(args.labelId)),
              }))
              .filter((r) => r.messageIds.length > 0);
            const offset = args.pageToken ? Number(args.pageToken) : 0;
            const page = eligible.slice(offset, offset + this.pageSize);
            const next = offset + this.pageSize < eligible.length ? String(offset + this.pageSize) : null;
            return {
              data: {
                history: page.map((r) => ({
                  id: String(r.id),
                  messagesAdded: r.messageIds.map((id) => ({ message: { id, threadId: this.messages.get(id)!.threadId } })),
                })),
                historyId: this.head,
                nextPageToken: next,
              },
            };
          },
        },
        threads: {
          get: async (args: { id: string; format?: string }) => {
            record("threads.get", args);
            if (args.format !== "minimal") throw new Error(`来信观察读线程只能用 minimal，实际 ${args.format}`);
            const members = [...this.messages.values()].filter((m) => m.threadId === args.id);
            if (members.length === 0) throw Object.assign(new Error("not found"), { code: 404 });
            return { data: { messages: members.map((m) => ({ id: m.id, threadId: m.threadId })) } };
          },
        },
        messages: {
          list: forbidden("messages.list"),
          get: async (args: { id: string; format?: string; metadataHeaders?: string[] }) => {
            record("messages.get", args);
            if (args.format !== "metadata") throw new Error(`来信观察读邮件只能用 metadata，实际 ${args.format}`);
            if (this.failingMessageIds.has(args.id)) throw Object.assign(new Error("backend error"), { code: 500 });
            const m = this.messages.get(args.id);
            if (!m) throw Object.assign(new Error("not found"), { code: 404 });
            const wanted = new Set((args.metadataHeaders ?? []).map((h) => h.toLowerCase()));
            const all: Array<{ name: string; value: string }> = [
              { name: "From", value: m.from },
              { name: "To", value: m.to ?? "" },
              { name: "Subject", value: m.subject },
              { name: "Date", value: new Date(m.date).toUTCString() },
              ...(m.rfcMessageId ? [{ name: "Message-ID", value: m.rfcMessageId }] : []),
              ...(m.replyTo ? [{ name: "Reply-To", value: m.replyTo }] : []),
            ];
            return {
              data: {
                id: m.id,
                threadId: m.threadId,
                labelIds: m.labels,
                internalDate: String(m.date),
                payload: { headers: all.filter((h) => wanted.size === 0 || wanted.has(h.name.toLowerCase())) },
              },
            };
          },
          attachments: { get: forbidden("attachments.get") },
          send: forbidden("messages.send"),
          modify: forbidden("messages.modify"),
          trash: forbidden("messages.trash"),
        },
        drafts: { create: forbidden("drafts.create") },
      },
    };
    return api as unknown as GmailReadApi;
  }

  /** 读接口函数的依赖：授权记录 + 这个假邮箱 */
  deps(provider: Record<string, unknown> | null = { id: "p1", accessToken: "enc", refreshToken: null, tokenExpiry: null, grantedScopes: READ_SCOPES }): GmailReadDeps {
    return {
      getProvider: (async () => provider) as unknown as GmailReadDeps["getProvider"],
      getGmail: async () => this.api(),
    };
  }
}
