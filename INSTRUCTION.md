# The problem
Managing financial accounts and their associated operations requires more than just storing account information. It also requires controlled access, secure authentication, clear onboarding, and accountability for important actions.

BalanceVault is a web application designed to bring these capabilities together. It focuses on structured account management, role-based access, onboarding workflows, and auditability.

### What I built
- The current implementation includes:
- A deployed React-based frontend.
- A Node.js backend with API routes.
- PostgreSQL database integration using Prisma.
- Database migrations and separate database roles for different responsibilities.
- Authentication and role-based access-control implementation.
- Account-holder registration and account onboarding workflows.
- Admin functionality designed for user management, onboarding, and audit-log access.
- Redis integration for backend rate limiting.
- Backend health and readiness endpoints.

Current limitation: The deployment infrastructure and health/readiness checks are verified, but the first administrator bootstrap and complete end-to-end admin login flow are still being tested. I will not claim those features are fully verified until they work on the live deployment.

How to run it
npm run db:generate

Apply database migrations to a configured development database:

npm run db:migrate

Start the application using the development scripts defined in the root package.json and the individual workspace configurations.

For a local demonstration, both the frontend and backend must be configured to use the local database and Redis instances.

AI tools I used
ChatGPT — technical explanations, architecture discussions, debugging, and deployment troubleshooting. OpenAI Codex in VS Code — code implementation, repository inspection, and code review.

What the AI got wrong, and what I fixed myself
During deployment, AI initially confused database role membership with permission to administer another PostgreSQL role.

It suggested changing a role password through the project-owner connection, but Neon rejected the operation with SQLSTATE 42501.

I investigated the actual PostgreSQL role configuration and discovered that:

The bootstrap login existed and had login permission.

It had membership in the bootstrap operator role.

The membership allowed SET ROLE.

The bootstrap operator had permission to execute the admin bootstrap function.

This showed that the original permission assumptions were incomplete. Instead of blindly granting broader database privileges, I inspected the role memberships, function permissions, and bootstrap implementation to narrow down the failure.

This reinforced an important lesson: AI-generated suggestions must be checked against the actual database configuration and execution environment.

# What is not finished
The following work remains:
- Complete and verify the first-admin bootstrap process.
- Verify admin login against the deployed backend.
- Test the complete registration and onboarding workflows end to end.
- Verify admin user management and audit-log functionality through the live interface.
- Complete browser-based testing of the deployed application.
- Improve deployment monitoring and operational reliability.
- The current deployment is intended as a hackathon demonstration using synthetic data, not as a production financial service or a system for handling real funds.

