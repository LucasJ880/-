-- 签单约定金额：与 Part B formDataJson 中 deposit/balance 对齐，供登记定金预填
ALTER TABLE "SalesQuote" ADD COLUMN "agreedDepositAmount" DOUBLE PRECISION;
ALTER TABLE "SalesQuote" ADD COLUMN "agreedBalanceAmount" DOUBLE PRECISION;
