# infrastructure

Local development only, for now.

- `../compose.yaml` starts the database, the API and the web console.
- `postgres/init/` holds scripts PostgreSQL runs once, when its data volume is first created.
- `../apps/api/Dockerfile` and `../apps/web/Dockerfile` build the two application images.

Cloud deployment is deliberately not here yet. It is designed when the platform leaves the laptop.
