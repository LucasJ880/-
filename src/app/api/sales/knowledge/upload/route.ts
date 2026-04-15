import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  indexBulkUpload,
  parseTextUpload,
  parseCsvUpload,
  type RawCommunication,
} from "@/lib/sales/knowledge-pipeline";

export const POST = withAuth(async (request) => {
  try {
    const body = await request.json();
    const { format, content, rows, customerId, opportunityId, sourceType } = body as {
      format: "text" | "csv" | "items";
      content?: string;
      rows?: Array<Record<string, string>>;
      items?: RawCommunication[];
      customerId?: string;
      opportunityId?: string;
      sourceType?: string;
    };

    let communications: RawCommunication[] = [];

    if (format === "text" && content) {
      communications = parseTextUpload(content, sourceType || "bulk_upload");
    } else if (format === "csv" && rows) {
      communications = parseCsvUpload(rows);
    } else if (format === "items" && body.items) {
      communications = body.items;
    } else {
      return NextResponse.json({ error: "无效的上传格式" }, { status: 400 });
    }

    if (customerId) {
      communications = communications.map((c) => ({ ...c, customerId }));
    }
    if (opportunityId) {
      communications = communications.map((c) => ({ ...c, opportunityId }));
    }

    if (communications.length === 0) {
      return NextResponse.json({ error: "没有可索引的内容" }, { status: 400 });
    }

    const result = await indexBulkUpload(communications);

    return NextResponse.json({
      success: true,
      total: result.total,
      indexed: result.success,
      errors: result.errors.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "上传处理失败" },
      { status: 500 },
    );
  }
});
