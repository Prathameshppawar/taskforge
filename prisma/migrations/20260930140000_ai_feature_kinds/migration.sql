-- Usage categories for the features that follow: PR review, release notes,
-- production triage and incident post-mortems. ADD VALUE only; nothing reads
-- the new values inside this migration, so running it in a transaction is fine.
ALTER TYPE "AiFeature" ADD VALUE 'PR_REVIEW';
ALTER TYPE "AiFeature" ADD VALUE 'RELEASE_NOTES';
ALTER TYPE "AiFeature" ADD VALUE 'TRIAGE';
ALTER TYPE "AiFeature" ADD VALUE 'POSTMORTEM';
