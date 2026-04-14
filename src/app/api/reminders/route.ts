import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { generateReminderLayers } from "@/lib/reminders/generator";

export const GET = withAuth(async (_request, _ctx, user) => {
  const layers = await generateReminderLayers(user.id);
  return NextResponse.json(layers);
});
