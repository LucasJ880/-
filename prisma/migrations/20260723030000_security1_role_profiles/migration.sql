-- Security-1：RoleProfile / Permission Binding / Principal Binding / PositionTemplate

CREATE TABLE IF NOT EXISTS "RoleProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "principalType" TEXT NOT NULL DEFAULT 'HUMAN',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RoleProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RolePermissionBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "dataScope" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'ALLOW',
    "conditionsJson" JSONB,
    CONSTRAINT "RolePermissionBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PrincipalRoleBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrincipalRoleBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PositionTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "principalType" TEXT NOT NULL DEFAULT 'HUMAN',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "primaryRoleProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PositionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RoleProfile_orgId_key_key" ON "RoleProfile"("orgId", "key");
CREATE INDEX IF NOT EXISTS "RoleProfile_orgId_status_idx" ON "RoleProfile"("orgId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "RolePermissionBinding_roleProfileId_permissionKey_dataScope_key"
  ON "RolePermissionBinding"("roleProfileId", "permissionKey", "dataScope");
CREATE INDEX IF NOT EXISTS "RolePermissionBinding_orgId_permissionKey_idx"
  ON "RolePermissionBinding"("orgId", "permissionKey");

CREATE INDEX IF NOT EXISTS "PrincipalRoleBinding_orgId_principalType_principalId_status_idx"
  ON "PrincipalRoleBinding"("orgId", "principalType", "principalId", "status");
CREATE INDEX IF NOT EXISTS "PrincipalRoleBinding_roleProfileId_idx"
  ON "PrincipalRoleBinding"("roleProfileId");

CREATE UNIQUE INDEX IF NOT EXISTS "PositionTemplate_orgId_key_key" ON "PositionTemplate"("orgId", "key");
CREATE INDEX IF NOT EXISTS "PositionTemplate_orgId_status_idx" ON "PositionTemplate"("orgId", "status");

ALTER TABLE "RoleProfile"
  ADD CONSTRAINT "RoleProfile_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RolePermissionBinding"
  ADD CONSTRAINT "RolePermissionBinding_roleProfileId_fkey"
  FOREIGN KEY ("roleProfileId") REFERENCES "RoleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrincipalRoleBinding"
  ADD CONSTRAINT "PrincipalRoleBinding_roleProfileId_fkey"
  FOREIGN KEY ("roleProfileId") REFERENCES "RoleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PositionTemplate"
  ADD CONSTRAINT "PositionTemplate_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PositionTemplate"
  ADD CONSTRAINT "PositionTemplate_primaryRoleProfileId_fkey"
  FOREIGN KEY ("primaryRoleProfileId") REFERENCES "RoleProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
