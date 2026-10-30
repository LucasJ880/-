import { requireMarketingReadAccess } from "@/lib/marketing/access";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { runMarketingHealthGrader } from "@/lib/ai-grader/graders/marketing-health-grader";

export const GET = withAuth(async(request,_ctx,user)=>{const orgRes=await resolveRequestOrgIdForUser(user,request.nextUrl.searchParams.get("orgId"));if(!orgRes.ok)return orgRes.response;const readDenied=await requireMarketingReadAccess(user,orgRes.orgId);if(readDenied)return readDenied;return NextResponse.json(await runMarketingHealthGrader({orgId:orgRes.orgId,userId:user.id}));});
