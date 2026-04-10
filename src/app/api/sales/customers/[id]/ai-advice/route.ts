import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { createCompletion } from '@/lib/ai/client';
import { getExpertSystemPrompt } from '@/lib/ai/expert-roles';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { id } = await ctx.params;

  const customer = await db.salesCustomer.findUnique({
    where: { id },
    include: {
      opportunities: { orderBy: { updatedAt: 'desc' }, take: 5 },
      interactions: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { createdBy: { select: { name: true } } },
      },
      quotes: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: true },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 });
  }

  const lines: string[] = [
    `客户: ${customer.name}`,
    `电话: ${customer.phone || '无'} | 邮箱: ${customer.email || '无'}`,
    `地址: ${customer.address || '无'} | 来源: ${customer.source || '未知'}`,
    customer.notes ? `备注: ${customer.notes}` : '',
  ];

  if (customer.opportunities.length > 0) {
    lines.push('', '## 销售机会');
    for (const opp of customer.opportunities) {
      lines.push(
        `- ${opp.title} | ${opp.stage} | ${opp.priority}` +
        (opp.estimatedValue ? ` | $${opp.estimatedValue}` : '') +
        (opp.nextFollowupAt ? ` | 跟进: ${new Date(opp.nextFollowupAt).toISOString().slice(0, 10)}` : '') +
        ` | 更新: ${new Date(opp.updatedAt).toISOString().slice(0, 10)}`
      );
    }
  }

  if (customer.interactions.length > 0) {
    lines.push('', '## 最近互动');
    for (const int of customer.interactions) {
      lines.push(
        `- [${new Date(int.createdAt).toISOString().slice(0, 10)}] ${int.type}: ${int.summary}`
      );
    }
  }

  if (customer.quotes.length > 0) {
    lines.push('', '## 报价');
    for (const q of customer.quotes) {
      lines.push(
        `- v${q.version} $${Number(q.grandTotal).toFixed(2)} (${q.status}) ${q.items.map(i => i.product).join(', ')}`
      );
    }
  }

  const expertPrompt = getExpertSystemPrompt('sales_advisor') || '';

  const userPrompt = `以下是客户资料：

${lines.filter(Boolean).join('\n')}

请用简洁的方式给出：
1. 客户当前阶段判断（1句话）
2. 推荐的下一步行动（2-3条，具体可执行）
3. 如果需要跟进，建议的跟进话术要点（中英文）

输出保持简洁，直接可用。`;

  try {
    const result = await createCompletion({
      systemPrompt: expertPrompt,
      userPrompt,
      mode: 'balanced',
    });

    return NextResponse.json({ advice: result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI 生成失败' },
      { status: 500 }
    );
  }
}
