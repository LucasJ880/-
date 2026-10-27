-- 2026-10 价表新增 Roman Shade 品类：企业折扣设置增加 romanShade 列（与 zebra 等同级；默认 30%）。纯新增（带默认值的非空列），无数据改写。

-- AlterTable
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN     "romanShade" DOUBLE PRECISION NOT NULL DEFAULT 0.3;
