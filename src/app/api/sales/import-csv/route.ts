import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { importCustomersCsv } from '@/lib/sales/csv-import';
import { resolveSalesOrgIdForRequest } from '@/lib/sales/org-context';

export const POST = withAuth(async (request, _ctx, user) => {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const formOrg = formData.get('orgId');
  const bodyOrgId = typeof formOrg === 'string' && formOrg.trim() ? formOrg.trim() : null;

  const orgRes = await resolveSalesOrgIdForRequest(request as unknown as NextRequest, user, {
    bodyOrgId,
  });
  if (!orgRes.ok) return orgRes.response;

  if (!file) {
    return NextResponse.json({ error: '请上传 CSV 文件' }, { status: 400 });
  }

  if (!file.name.endsWith('.csv')) {
    return NextResponse.json({ error: '仅支持 .csv 文件' }, { status: 400 });
  }

  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: '文件大小不能超过 5MB' }, { status: 400 });
  }

  try {
    const csvText = await file.text();
    const result = await importCustomersCsv(csvText, user.id, orgRes.orgId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sales/import-csv] Error:', err);
    return NextResponse.json(
      { error: '导入失败，请检查文件格式' },
      { status: 500 },
    );
  }
});
