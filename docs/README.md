# CARE QR documentation

CARE QR is one React frontend and one Express/Prisma backend. Start with the guide that matches your task:

| If you want to…                                                         | Read                                                                                                      |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Understand the product, roles, demo data, and local setup               | [Easy guide](./guides/easy-guide.md)                                                                      |
| Trace a request from QR scan to completion                              | [Data-flow diagrams and sequences](./architecture/data-flow.md)                                           |
| Find the files, checks, transaction, and tests behind one API request   | [Code map](./architecture/code-map.md)                                                                    |
| Understand module boundaries and the folder layout                      | [Architecture](./architecture/README.md) and [module catalog](./architecture/modules.md)                  |
| See tables, columns, and relationships                                  | [Generated ER diagrams](./database/er-diagram.md) and [`schema.prisma`](../services/prisma/schema.prisma) |
| Add a feature without breaking the boundaries                           | [Adding a feature](./adding-a-feature.md)                                                                 |
| Test every role and workflow                                            | [Full testing guide](./guides/full-testing-guide.md)                                                      |
| Check what is implemented versus still planned                          | [Project status](./project-status.md)                                                                     |
| Deploy the API on Render and the web app on Vercel                      | [Deployment guide](./deployment.md)                                                                       |
| Understand notifications, recipients, retries, and setup                | [Notification architecture and verification](./architecture/notifications.md)                             |
| See the latest UI, backend, schema, and security fixes and test results | [Current platform review](./final-audit/14-current-platform-review.md)                                    |
| Review the complete audit remediation and remaining deployment risks    | [Audit remediation](./final-audit/17-remediation-2026-10-22.md)                                           |

The ER diagram is generated from the Prisma model. The API route inventory is generated at [`services/openapi.json`](../services/openapi.json). After changing the schema or routes, run the corresponding `npm run docs:er` or `npm run docs:api` command from `services/`; CI runs both drift checks. Never run database integration tests against the development or production database; they require an isolated `TEST_DATABASE_URL`.
