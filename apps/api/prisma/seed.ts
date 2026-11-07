import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const permissions = [
  ['company.read', 'View company records'], ['company.manage', 'Manage company configuration'],
  ['branch.read', 'View branches'], ['branch.manage', 'Manage branches'],
  ['user.read', 'View users'], ['user.manage', 'Manage users and assignments'],
  ['role.manage', 'Manage roles and permission grants'], ['account.read', 'View chart of accounts'],
  ['account.manage', 'Manage chart of accounts'], ['period.read', 'View fiscal years and periods'],
  ['period.manage', 'Manage fiscal years and periods'], ['audit.read', 'View audit events'],
  ['journal.read', 'View journal entries'], ['journal.post', 'Create and post journal entries'],
] as const;
const roles = [
  ['SYSTEM_ADMINISTRATOR', 'System Administrator'], ['MANAGING_PARTNER', 'Managing Partner'],
  ['FINANCE_MANAGER', 'Finance Manager'], ['CHIEF_ACCOUNTANT', 'Chief Accountant'],
  ['ACCOUNTANT', 'Accountant'], ['BOOKKEEPER', 'Bookkeeper'],
  ['TAX_COMPLIANCE_OFFICER', 'Tax Compliance Officer'], ['HR_MANAGER', 'HR Manager'],
  ['HR_OFFICER', 'HR Officer'], ['PROCUREMENT_OFFICER', 'Procurement Officer'],
  ['WAREHOUSE_OFFICER', 'Warehouse Officer'], ['SALES_MANAGER', 'Sales Manager'],
  ['CRM_OFFICER', 'CRM Officer'], ['PROJECT_MANAGER', 'Project Manager'],
  ['AUDITOR_READ_ONLY', 'Auditor / Read-only User'], ['CLIENT_PORTAL_USER', 'Client Portal User'],
] as const;

async function main() {
  for (const [code, description] of permissions) {
    await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }

  for (const [code, name] of roles) {
    const role = await prisma.role.upsert({ where: { code }, update: { name }, create: { code, name } });
    const grants = code === 'SYSTEM_ADMINISTRATOR'
      ? permissions.map(([permission]) => permission)
      : code === 'AUDITOR_READ_ONLY'
        ? ['company.read', 'branch.read', 'account.read', 'period.read', 'audit.read', 'journal.read']
        : code === 'CLIENT_PORTAL_USER'
          ? []
          : ['company.read', 'branch.read', 'account.read', 'period.read',
              ...( ['MANAGING_PARTNER', 'FINANCE_MANAGER', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'BOOKKEEPER'].includes(code)
                ? ['journal.read'] : []),
              ...( ['MANAGING_PARTNER', 'FINANCE_MANAGER', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT'].includes(code)
                ? ['journal.post'] : [])];

    for (const permissionCode of grants) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permissionCode } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const companyName = process.env.BOOTSTRAP_COMPANY_NAME?.trim();
  if (email || password || companyName) {
    if (!email || !password || !companyName || password.length < 14) {
      throw new Error('Set all bootstrap variables; admin password must be at least 14 characters.');
    }
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_ADMINISTRATOR' } });
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        displayName: 'System Administrator',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    const company = await prisma.company.create({ data: { name: companyName } });
    await prisma.userCompany.create({
      data: { userId: user.id, companyId: company.id, roles: { create: { roleId: adminRole.id } } },
    });
  }
}

main().finally(async () => prisma.$disconnect());
