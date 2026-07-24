# Digital Employees Phase 1 Activation

## Goal

Activate the existing Qingyan digital employees safely for Sunny without enabling automatic email sending or unapproved high-risk writes.

## Phase 1 scope

Enabled for controlled rollout:

- Daily business brief
- Customer follow-up review
- Quote risk review
- Project health review
- Marketing brief
- Web AI Operator
- Gmail draft creation only

Kept disabled until later acceptance:

- Supervisor for all users
- Employee AI learning and playbook publishing
- Real product-content image generation
- Automatic email sending
- Automatic high-risk CRM writes

## Required sequence

1. Deploy this branch to Preview.
2. Run the read-only audit:

```bash
npx tsx scripts/audit-digital-employees-phase1.ts \
  --org-id=<SUNNY_ORG_ID> \
  --user-id=<LUCAS_USER_ID>
```

3. Confirm:
   - OpenAI is configured.
   - CRON_SECRET is configured.
   - Lucas belongs to Sunny and has the intended platform role.
   - At least one active WeChat/WeCom binding exists if mobile use is required.
   - Gmail OAuth is connected and includes compose permission before testing drafts.
4. Copy `.env.digital-employees.example` into Preview environment variables and replace placeholders.
5. Redeploy Preview.
6. Test read-only requests first.
7. Test PendingAction approval flows.
8. Only after acceptance, copy the same scoped configuration to Production.

## Acceptance prompts

- 给我今日业务简报
- 哪些客户今天需要跟进？
- 哪些报价有风险？
- 哪些项目快截止？
- 查询当前销售 Pipeline
- 帮我给客户写一封报价跟进邮件草稿
- 把客户的下次跟进日期改到周五

## Safety acceptance

- Read operations use real organization-scoped data.
- Cross-organization access is denied.
- CRM writes create PendingAction approval instead of writing immediately.
- Gmail creates a draft only and never sends.
- Users outside the allowlist remain on the existing path.
- Supervisor and learning remain disabled in Phase 1.

## Rollback

Set:

```env
DIGITAL_EMPLOYEES_ENABLED=0
AI_OPERATOR_ENABLED=0
GMAIL_DRAFT_ENABLED=false
```

Redeploy. Existing database records and PendingActions remain auditable; no destructive rollback is required.
