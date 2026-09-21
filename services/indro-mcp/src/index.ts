import { McpServer } from "@modelcontextprotocol/server";
import OAuthProvider, { type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";

const SERVICE_NAME = "Indro CommandHUD";
const SERVICE_VERSION = "0.1.0";
const OAUTH_STATE_TTL_SECONDS = 600;
const OAUTH_STATE_PREFIX = "github-oauth-state:";

type AppEnv = Env & {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	OAUTH_PROVIDER: OAuthHelpers;
	HOME_EXECUTOR_TOKEN: string;
	HOME_EXECUTOR_URL: string;
};

type GitHubTokenResponse = { access_token?: string; error?: string; error_description?: string };
type GitHubUser = { id?: number; login?: string };

function createServer(env: AppEnv) {
	const server = new McpServer({ name: SERVICE_NAME, version: SERVICE_VERSION });
	server.registerTool(
		"commandhud.status",
		{ description: "Report the status and capabilities of the Indro CommandHUD remote control plane." },
		async () => ({
			content: [{
				type: "text",
				text: JSON.stringify({
					service: SERVICE_NAME,
					version: SERVICE_VERSION,
					status: "ready",
					transport: "streamable-http",
					execution: "read-only",
					authority: "git",
				}, null, 2),
			}],
		}),
	);
server.registerTool("commandhud.home.status", { description: "Report whether the authenticated home Windows executor is reachable." }, async () => { const response = await fetch(env.HOME_EXECUTOR_URL + "/health", { headers: { Authorization: "Bearer " + env.HOME_EXECUTOR_TOKEN } }); if (!response.ok) throw new Error("Home executor returned HTTP " + response.status + "."); const result = await response.json(); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }; });
	return server;
}


function randomState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function stateKey(state: string): string {
	return `${OAUTH_STATE_PREFIX}${state}`;
}

async function beginAuthorization(request: Request, env: AppEnv): Promise<Response> {
	const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
	const state = randomState();
	await env.OAUTH_KV.put(stateKey(state), JSON.stringify(authRequest), { expirationTtl: OAUTH_STATE_TTL_SECONDS });

	const requestUrl = new URL(request.url);
	const githubAuthorize = new URL("https://github.com/login/oauth/authorize");
	githubAuthorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
	githubAuthorize.searchParams.set("redirect_uri", `${requestUrl.origin}/callback`);
	githubAuthorize.searchParams.set("state", state);
	return Response.redirect(githubAuthorize.toString(), 302);
}

async function finishAuthorization(request: Request, env: AppEnv): Promise<Response> {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (!code || !state) return new Response("Missing OAuth callback parameters", { status: 400 });

	const key = stateKey(state);
	const saved = await env.OAUTH_KV.get(key);
	if (!saved) return new Response("OAuth state is invalid or expired", { status: 400 });
	await env.OAUTH_KV.delete(key);

	let authRequest: AuthRequest;
	try {
		authRequest = JSON.parse(saved) as AuthRequest;
	} catch {
		return new Response("Stored OAuth request is invalid", { status: 400 });
	}

	const callbackUrl = `${url.origin}/callback`;
	const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			code,
			redirect_uri: callbackUrl,
		}),
	});
	if (!tokenResponse.ok) return new Response("GitHub token exchange failed", { status: 502 });

	const token = (await tokenResponse.json()) as GitHubTokenResponse;
	if (!token.access_token) {
		return new Response(token.error_description ?? token.error ?? "GitHub authorization failed", { status: 401 });
	}

	const userResponse = await fetch("https://api.github.com/user", {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token.access_token}`,
			"User-Agent": "Indro-CommandHUD",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!userResponse.ok) return new Response("GitHub identity lookup failed", { status: 502 });

	const githubUser = (await userResponse.json()) as GitHubUser;
	if (typeof githubUser.id !== "number" || !Number.isSafeInteger(githubUser.id) || typeof githubUser.login !== "string" || githubUser.login.length === 0) {
		return new Response("GitHub identity response is invalid", { status: 502 });
	}

	const identity = { provider: "github", id: githubUser.id, login: githubUser.login };
	const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
		request: authRequest,
		userId: String(githubUser.id),
		metadata: identity,
		scope: authRequest.scope,
		props: identity,
	});
	return Response.redirect(redirectTo, 302);
}

const protectedMcpHandler = {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
		return createMcpHandler(() => createServer(env))(request, env, ctx);
	},
} satisfies ExportedHandler<AppEnv>;

const defaultHandler = {
	async fetch(request: Request, env: AppEnv): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
			return Response.json({
				service: SERVICE_NAME,
				version: SERVICE_VERSION,
				status: "ok",
				mcp: "/mcp",
				authentication: "github-oauth",
			});
		}
		if (url.pathname === "/authorize") {
			if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
			return beginAuthorization(request, env);
		}
		if (url.pathname === "/callback") {
			if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
			return finishAuthorization(request, env);
		}
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<AppEnv>;

export default new OAuthProvider<AppEnv>({
	apiRoute: "/mcp",
	apiHandler: protectedMcpHandler,
	defaultHandler,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});
