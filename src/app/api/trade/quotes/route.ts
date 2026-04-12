import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listQuotes, createQuote } from "@/lib/trade/quote-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId") ?? "default";
  const status = searchParams.get("status") ?? undefined;
  const prospectId = searchParams.get("prospectId") ?? undefined;

  const quotes = await listQuotes(orgId, { status, prospectId });
  return NextResponse.json(quotes);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  if (!body.companyName) {
    return NextResponse.json({ error: "companyName 必填" }, { status: 400 });
  }

  const quote = await createQuote(
    { orgId: body.orgId ?? "default", ...body },
    auth.user.id,
  );
  return NextResponse.json(quote, { status: 201 });
}
