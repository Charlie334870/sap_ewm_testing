# MCP server image. Build from the repository root:  docker build -f apps/mcp/Dockerfile .
# It only needs the bundled server file, which is committed to the repository.
FROM node:22-slim
WORKDIR /app
COPY apps/mcp/dist/ewm-mcp.mjs ./ewm-mcp.mjs
ENV NODE_ENV=production
USER node
# stdout carries the MCP protocol; run it with stdin attached (docker run -i).
CMD ["node", "ewm-mcp.mjs"]
