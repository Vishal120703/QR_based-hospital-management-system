# Local infrastructure

Start PostgreSQL and Redis with:

```bash
docker compose -f deploy/docker-compose.yml up -d
```

The credentials are development-only defaults. Production secrets must come from the deployment environment and must not be committed.
