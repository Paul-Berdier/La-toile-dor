import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { SESSION_COOKIE, validateSession, getUserPermissions } from "@toile/auth";
import { STREAMER_COOKIE } from "@/lib/streamer";
import { getAccessContext, canViewMissionConfidentialDetails } from "@/server/missions";

export const dynamic = "force-dynamic";

/**
 * Sert une image de preuve d'un rapport de mission — mêmes règles d'accès
 * que le rapport lui-même (modération ou groupe attribué). En mode Streamer,
 * rien ne part en clair : 404 comme pour un accès refusé.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return new NextResponse(null, { status: 404 });
  if (req.cookies.get(STREAMER_COOKIE)?.value === "1") {
    return new NextResponse(null, { status: 404 });
  }

  const { id } = await params;
  const image = await prisma.missionReportImage.findUnique({
    where: { id },
    select: {
      imageData: true,
      imageMime: true,
      report: {
        select: {
          isFinal: true,
          reportingGroupId: true,
          mission: {
            select: {
              id: true,
              assignedGroupId: true,
              assignments: { where: { active: true }, select: { groupId: true, active: true } },
            },
          },
        },
      },
    },
  });
  if (!image) return new NextResponse(null, { status: 404 });

  const permissions = await getUserPermissions(session.userId);
  const ctx = await getAccessContext({ session, permissions });
  const canViewMission = canViewMissionConfidentialDetails(ctx, image.report.mission);
  const canViewFinal =
    ctx.isModerator ||
    (image.report.reportingGroupId
      ? ctx.ledGroups.some((group) => group.id === image.report.reportingGroupId)
      : ctx.ledGroups.some((group) =>
          image.report.mission.assignments.some((assignment) => assignment.groupId === group.id) ||
          (image.report.mission.assignments.length === 0 && image.report.mission.assignedGroupId === group.id),
        ));
  if (!canViewMission || (image.report.isFinal && !canViewFinal)) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Buffer.from(image.imageData), {
    headers: {
      "Content-Type": image.imageMime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
