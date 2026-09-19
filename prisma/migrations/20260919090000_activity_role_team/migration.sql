-- Role and team changes are audited like everything else. Without these the
-- activity log would be silent about exactly the actions that alter who can do
-- what, which is the last place an audit trail should have a gap.
ALTER TYPE "ActivityEntity" ADD VALUE IF NOT EXISTS 'ROLE';
ALTER TYPE "ActivityEntity" ADD VALUE IF NOT EXISTS 'TEAM';
