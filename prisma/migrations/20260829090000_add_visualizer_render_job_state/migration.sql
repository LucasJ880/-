-- 可视化 HD 渲染异步任务状态（轮询 + 断线续看 + 防重入）
ALTER TABLE "VisualizerVariant"
ADD COLUMN "renderJobStatus" TEXT,
ADD COLUMN "renderJobQuality" TEXT,
ADD COLUMN "renderJobError" TEXT,
ADD COLUMN "renderJobStartedAt" TIMESTAMP(3);
