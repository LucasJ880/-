"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Brain, BookOpen, Users, Shield, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

export default function DigitalEmployeesHubPage() {
  const router = useRouter();
  const { isPlatformAdmin, loading } = useCurrentUser();

  useEffect(() => {
    if (!loading && !isPlatformAdmin) {
      router.replace("/settings");
    }
  }, [loading, isPlatformAdmin, router]);

  if (loading || !isPlatformAdmin) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="数字员工学习"
        description="真人员工与数字员工协作学习：个人偏好、部门候选方法、已批准 Playbook。默认关闭，不监控私人行为。"
      />

      <div className="mt-6 space-y-3">
        <Link
          href="/settings/digital-employees/my-profile"
          className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-white p-4 hover:bg-[#fafafa]"
        >
          <Brain className="mt-0.5 h-5 w-5 text-[#202422]" />
          <div>
            <div className="text-[14px] font-semibold text-[#171a19]">我的 AI 偏好</div>
            <div className="mt-0.5 text-[12px] text-[#68706c]">
              查看/确认个人偏好、学习授权与近期反馈
            </div>
          </div>
        </Link>
        <Link
          href="/settings/digital-employees/team-learning"
          className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-white p-4 hover:bg-[#fafafa]"
        >
          <Users className="mt-0.5 h-5 w-5 text-[#202422]" />
          <div>
            <div className="text-[14px] font-semibold text-[#171a19]">部门学习审核</div>
            <div className="mt-0.5 text-[12px] text-[#68706c]">
              主管审核候选工作方法（不会自动生效）
            </div>
          </div>
        </Link>
        <Link
          href="/settings/digital-employees/playbooks"
          className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-white p-4 hover:bg-[#fafafa]"
        >
          <BookOpen className="mt-0.5 h-5 w-5 text-[#202422]" />
          <div>
            <div className="text-[14px] font-semibold text-[#171a19]">部门 Playbook</div>
            <div className="mt-0.5 text-[12px] text-[#68706c]">
              已批准方法的版本、发布与回滚
            </div>
          </div>
        </Link>
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <Shield className="mt-0.5 h-5 w-5 text-amber-800" />
          <div className="text-[12px] leading-relaxed text-amber-950">
            <strong>隐私说明：</strong>系统只记录工作建议的接受/修改/拒绝与经授权的部门学习样本。
            不记录私人聊天、私人邮箱、键盘轨迹、屏幕录像或情绪人格推断。不根据 AI 接受率做员工排名。
          </div>
        </div>
      </div>
    </div>
  );
}
