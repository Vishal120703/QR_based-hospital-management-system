-- CreateEnum
CREATE TYPE "HospitalStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('HOSPITAL', 'FLOOR', 'WARD');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('SYSTEM', 'STAFF');

-- CreateTable
CREATE TABLE "Hospital" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "HospitalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalSetting" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalMembership" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionKey" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeAssignment" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "userRoleId" UUID NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" UUID NOT NULL,

    CONSTRAINT "ScopeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorMembershipId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_code_key" ON "Hospital"("code");

-- CreateIndex
CREATE INDEX "HospitalSetting_hospitalId_idx" ON "HospitalSetting"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalSetting_hospitalId_id_key" ON "HospitalSetting"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalSetting_hospitalId_key_key" ON "HospitalSetting"("hospitalId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "HospitalMembership_userId_idx" ON "HospitalMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalMembership_hospitalId_id_key" ON "HospitalMembership"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalMembership_hospitalId_userId_key" ON "HospitalMembership"("hospitalId", "userId");

-- CreateIndex
CREATE INDEX "Role_hospitalId_idx" ON "Role"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_hospitalId_id_key" ON "Role"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Role_hospitalId_name_key" ON "Role"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "RolePermission_hospitalId_roleId_idx" ON "RolePermission"("hospitalId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_hospitalId_roleId_permissionKey_key" ON "RolePermission"("hospitalId", "roleId", "permissionKey");

-- CreateIndex
CREATE INDEX "UserRole_hospitalId_roleId_idx" ON "UserRole"("hospitalId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_hospitalId_id_key" ON "UserRole"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_hospitalId_membershipId_roleId_key" ON "UserRole"("hospitalId", "membershipId", "roleId");

-- CreateIndex
CREATE INDEX "ScopeAssignment_hospitalId_scopeType_scopeId_idx" ON "ScopeAssignment"("hospitalId", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeAssignment_hospitalId_userRoleId_scopeType_scopeId_key" ON "ScopeAssignment"("hospitalId", "userRoleId", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffSession_hospitalId_membershipId_idx" ON "StaffSession"("hospitalId", "membershipId");

-- CreateIndex
CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_createdAt_idx" ON "AuditLog"("hospitalId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_targetType_targetId_idx" ON "AuditLog"("hospitalId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "HospitalSetting" ADD CONSTRAINT "HospitalSetting_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalMembership" ADD CONSTRAINT "HospitalMembership_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalMembership" ADD CONSTRAINT "HospitalMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_hospitalId_roleId_fkey" FOREIGN KEY ("hospitalId", "roleId") REFERENCES "Role"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_hospitalId_membershipId_fkey" FOREIGN KEY ("hospitalId", "membershipId") REFERENCES "HospitalMembership"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_hospitalId_roleId_fkey" FOREIGN KEY ("hospitalId", "roleId") REFERENCES "Role"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeAssignment" ADD CONSTRAINT "ScopeAssignment_hospitalId_userRoleId_fkey" FOREIGN KEY ("hospitalId", "userRoleId") REFERENCES "UserRole"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_hospitalId_membershipId_fkey" FOREIGN KEY ("hospitalId", "membershipId") REFERENCES "HospitalMembership"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
