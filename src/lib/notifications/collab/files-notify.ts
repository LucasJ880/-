/**
 * 协作通知 COLLAB-2：项目文件上传接线（design D8）
 *
 * 只在 `POST /api/projects/[id]/files` 有文件上传成功之后 await 这里：每次上传请求一条 project_update，
 * 发给 active 项目成员与项目负责人（上传人除外）。不向外抛错：任何一步出错只记 console.error。
 */

import { deliverCollabNotification } from "./deliver";
import { projectFilesEvent } from "./events";
import { projectFileRecipients } from "./recipients";

export async function notifyProjectFilesUploaded(input: {
  project: { id: string; name: string; orgId: string | null; ownerId: string | null };
  /** 本次上传成功的文档，按上传顺序 */
  documents: ReadonlyArray<{ id: string; title: string }>;
  actor: { id: string; name: string };
}): Promise<void> {
  const { project, documents, actor } = input;
  try {
    if (documents.length === 0) return;
    const recipientIds = await projectFileRecipients({ projectId: project.id, ownerId: project.ownerId });
    const event = projectFilesEvent({
      projectId: project.id,
      projectName: project.name,
      orgId: project.orgId,
      actorId: actor.id,
      actorName: actor.name,
      documents,
      recipientIds,
    });
    if (event) await deliverCollabNotification(event);
  } catch (err) {
    console.error(`[collab-notify] 项目文件上传通知失败 project=${project.id}`, err);
  }
}
