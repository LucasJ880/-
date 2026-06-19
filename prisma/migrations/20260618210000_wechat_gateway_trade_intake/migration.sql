-- AlterTable
ALTER TABLE "WeChatGateway" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'assistant',
ADD COLUMN     "fulfillmentOrgId" TEXT;
