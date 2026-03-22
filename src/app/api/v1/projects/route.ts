import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyApiToken, hasPermission } from "@/lib/auth/api-token";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  WORKFLOW_TEMPLATES,
  resolveTaskDueDate,
} from "@/lib/workflow/templates";
import type { ApiTokenPayload } from "@/lib/auth/api-token";

const VALID_PRIORITIES = ["high", "medium", "low"];
const VALID_RECOMMENDATIONS = [
  "pursue",
  "review_carefully",
  "low_probability",
  "skip",
];
const VALID_RISK_LEVELS = ["low", "medium", "high", "unassessed"];
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://rho-sage.vercel.app";

export async function POST(request: NextRequest) {
  const authResult = await verifyApiToken(request);
  if (authResult instanceof NextResponse) return authResult;

  const tokenPayload = authResult as ApiTokenPayload;
  if (!hasPermission(tokenPayload, "project:create")) {
    return NextResponse.json(
      { error: "Insufficient permissions", code: "PERMISSION_DENIED" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const requestId = request.headers.get("x-request-id") || undefined;
  const sourceSystem = request.headers.get("x-source-system") || tokenPayload.system;

  // --- Validate required fields ---
  const extRef = body.external_ref as Record<string, unknown> | undefined;
  const project = body.project as Record<string, unknown> | undefined;

  if (!extRef?.system || !extRef?.id) {
    return NextResponse.json(
      { error: "external_ref.system and external_ref.id are required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  if (!project?.name) {
    return NextResponse.json(
      { error: "project.name is required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const refSystem = String(extRef.system);
  const refId = String(extRef.id);

  // --- Duplicate check ---
  const existing = await db.externalReference.findUnique({
    where: { system_externalId: { system: refSystem, externalId: refId } },
    include: { project: { select: { id: true, name: true } } },
  });

  if (existing) {
    return NextResponse.json(
      {
        error: "Project already exists for this external reference",
        code: "DUPLICATE_EXTERNAL_REF",
        existing_project_id: existing.project.id,
        existing_project_url: `${BASE_URL}/projects/${existing.project.id}`,
      },
      { status: 409 }
    );
  }

  // --- Normalize input ---
  const projectName = String(project.name).trim();
  const projectDesc = project.description ? String(project.description) : null;
  const priority = VALID_PRIORITIES.includes(String(project.priority))
    ? String(project.priority)
    : "medium";
  const deadline = project.deadline ? new Date(String(project.deadline)) : null;

  const intelligence = body.intelligence as Record<string, unknown> | undefined;
  const documents = body.documents as Array<Record<string, unknown>> | undefined;
  const metadata = body.metadata as Record<string, unknown> | undefined;
  const workflowTemplate = body.workflow_template
    ? String(body.workflow_template)
    : null;

  // --- Find or create system user for API operations ---
  let systemUser = await db.user.findFirst({
    where: { email: "system@qingyan.internal" },
  });
  if (!systemUser) {
    systemUser = await db.user.create({
      data: {
        email: "system@qingyan.internal",
        name: "System (API)",
        role: "user",
        status: "active",
        passwordHash: "",
      },
    });
  }

  // --- Find a default org, or create without org ---
  let orgId: string | null = null;
  const defaultOrg = await db.organization.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
  });
  if (defaultOrg) orgId = defaultOrg.id;

  // --- Create project in transaction ---
  const result = await db.$transaction(async (tx) => {
    const newProject = await tx.project.create({
      data: {
        name: projectName,
        description: projectDesc,
        status: "active",
        priority,
        category: project.category ? String(project.category) : "tender_opportunity",
        tenderStatus: "new",
        sourceSystem,
        sourcePlatform: project.source_platform ? String(project.source_platform) : null,
        clientOrganization: project.client_organization
          ? String(project.client_organization)
          : null,
        location: project.location ? String(project.location) : null,
        estimatedValue: project.estimated_value
          ? Number(project.estimated_value)
          : null,
        currency: project.currency ? String(project.currency) : null,
        solicitationNumber: project.solicitation_number
          ? String(project.solicitation_number)
          : null,
        dueDate: deadline,
        workflowTemplate,
        sourceMetadataJson: metadata ? JSON.stringify(metadata) : null,
        ownerId: systemUser!.id,
        orgId,
        color: "#4F7C78",
      },
    });

    // External reference
    await tx.externalReference.create({
      data: {
        system: refSystem,
        externalId: refId,
        url: extRef.url ? String(extRef.url) : null,
        projectId: newProject.id,
      },
    });

    // Intelligence
    if (intelligence) {
      await tx.projectIntelligence.create({
        data: {
          projectId: newProject.id,
          recommendation: VALID_RECOMMENDATIONS.includes(
            String(intelligence.recommendation)
          )
            ? String(intelligence.recommendation)
            : "review_carefully",
          riskLevel: VALID_RISK_LEVELS.includes(String(intelligence.risk_level))
            ? String(intelligence.risk_level)
            : "unassessed",
          fitScore: intelligence.fit_score
            ? Math.min(100, Math.max(0, Number(intelligence.fit_score)))
            : 0,
          summary: intelligence.summary ? String(intelligence.summary) : null,
          fullReportUrl: intelligence.full_report_url
            ? String(intelligence.full_report_url)
            : null,
        },
      });
    }

    // Documents
    if (Array.isArray(documents) && documents.length > 0) {
      await tx.projectDocument.createMany({
        data: documents.map((doc, i) => ({
          projectId: newProject.id,
          title: String(doc.title || "Untitled"),
          url: String(doc.url || ""),
          fileType: String(doc.file_type || "link"),
          sortOrder: i,
        })),
      });
    }

    // Workflow template tasks
    const createdTasks: Array<{ task_id: string; name: string }> = [];
    const templateDef = workflowTemplate
      ? WORKFLOW_TEMPLATES[workflowTemplate]
      : null;

    if (templateDef) {
      const now = new Date();
      for (const tmpl of templateDef) {
        const dueDate = resolveTaskDueDate(tmpl, now, deadline);
        const task = await tx.task.create({
          data: {
            title: `[${tmpl.phase}] ${tmpl.name}`,
            description: tmpl.description || null,
            status: "todo",
            priority,
            dueDate,
            projectId: newProject.id,
            creatorId: systemUser!.id,
          },
        });
        createdTasks.push({ task_id: task.id, name: task.title });
      }
    }

    return { project: newProject, tasks: createdTasks };
  });

  // Audit log (non-blocking)
  logAudit({
    userId: systemUser.id,
    orgId: orgId ?? undefined,
    projectId: result.project.id,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: result.project.id,
    afterData: {
      source: sourceSystem,
      externalRef: { system: refSystem, id: refId },
      requestId,
      workflowTemplate,
      tasksCreated: result.tasks.length,
    },
    request,
  }).catch(() => {});

  return NextResponse.json(
    {
      project_id: result.project.id,
      project_url: `${BASE_URL}/projects/${result.project.id}`,
      status: "created",
      tasks_created: result.tasks,
    },
    { status: 201 }
  );
}
