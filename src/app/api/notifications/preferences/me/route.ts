import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import {
  getUserNotificationPreferenceDTO,
  updateUserNotificationPreference,
} from "@/lib/notifications/preferences";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const pref = await getUserNotificationPreferenceDTO(auth.user.id);
  return NextResponse.json({ preference: pref });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({}));

  const patch: Parameters<typeof updateUserNotificationPreference>[1] = {};
  if (typeof body.enableInAppNotifications === "boolean")
    patch.enableInAppNotifications = body.enableInAppNotifications;
  if (typeof body.onlyHighPriority === "boolean") patch.onlyHighPriority = body.onlyHighPriority;
  if (typeof body.onlyMyItems === "boolean") patch.onlyMyItems = body.onlyMyItems;
  if (typeof body.includeWatchedProjects === "boolean")
    patch.includeWatchedProjects = body.includeWatchedProjects;
  if (typeof body.quietHoursEnabled === "boolean") patch.quietHoursEnabled = body.quietHoursEnabled;
  if (body.quietHoursStart !== undefined)
    patch.quietHoursStart =
      body.quietHoursStart === null || body.quietHoursStart === ""
        ? null
        : String(body.quietHoursStart);
  if (body.quietHoursEnd !== undefined)
    patch.quietHoursEnd =
      body.quietHoursEnd === null || body.quietHoursEnd === ""
        ? null
        : String(body.quietHoursEnd);
  if (typeof body.emailEnabled === "boolean") patch.emailEnabled = body.emailEnabled;
  if (typeof body.pushEnabled === "boolean") patch.pushEnabled = body.pushEnabled;
  if (Array.isArray(body.enabledTypes)) patch.enabledTypes = body.enabledTypes.map(String);

  const pref = await updateUserNotificationPreference(auth.user.id, patch);
  return NextResponse.json({ preference: pref });
}
