-- A-P4（Agent 三栈合并收官）：清理死模型 ToolExecution
-- 依据：全代码库对 db.toolExecution 零引用，生产库该表零写入（历史审计见架构升级计划）。
-- DropTable（自带外键约束随表删除；AgentTask / AgentTaskStep 不受影响）
DROP TABLE IF EXISTS "ToolExecution";
