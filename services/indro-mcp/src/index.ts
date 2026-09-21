import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

const SERVICE_NAME = "Indro CommandHUD";
const SERVICE_VERSION = "0.1.0";

function createServer() {
        const server = new McpServer({
                name: SERVICE_NAME,
                version: SERVICE_VERSION,
        });

        server.registerTool(
                "commandhud.status",
                {
                        description:
                                "Report the status and capabilities of the Indro CommandHUD remote control plane.",
                },
                async () => ({
                        content: [
                                {
                                        type: "text",
                                        text: JSON.stringify(
                                                {
                                                        service: SERVICE_NAME,
                                                        version: SERVICE_VERSION,
                                                        status: "ready",
                                                        transport: "streamable-http",
                                                        execution: "read-only",
                                                        authority: "git",
                                                },
                                                null,
                                                2,
                                        ),
                                },
                        ],
                }),
        );

        return server;
}

const mcpHandler = createMcpHandler(createServer);

export default {
        fetch(request: Request, env: Env, ctx: ExecutionContext) {
                const url = new URL(request.url);

                if (url.pathname === "/health") {
                        if (request.method !== "GET") {
                                return new Response("Method Not Allowed", { status: 405 });
                        }

                        return Response.json({
                                service: SERVICE_NAME,
                                version: SERVICE_VERSION,
                                status: "ok",
                                mcp: "/mcp",
                        });
                }

                if (url.pathname === "/mcp") {
                        return mcpHandler(request, env, ctx);
                }

                return new Response("Not Found", { status: 404 });
        },
} satisfies ExportedHandler<Env>;
