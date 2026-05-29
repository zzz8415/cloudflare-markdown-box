import type { DocMeta, Env, UserRecord } from "./types";

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_HASH_ITERATIONS = 120000;
const DOC_ENCRYPTION_PREFIX = "enc:v1:";
const DOC_IV_BYTES = 12;

const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8"
        }
    });

const badRequest = (message: string) => json({ error: message }, 400);
const unauthorized = () => json({ error: "未登录或会话已失效" }, 401);
const notFound = () => json({ error: "资源不存在" }, 404);
const contentMissing = () =>
    json({ error: "文档正文不存在，可能是 R2 bucket 已更换或对象被删除。" }, 409);

const parseCookies = (cookieHeader: string | null): Record<string, string> => {
    if (!cookieHeader) return {};
    return cookieHeader.split(";").reduce<Record<string, string>>((acc, item) => {
        const [rawKey, ...rawValue] = item.trim().split("=");
        if (!rawKey) return acc;
        acc[rawKey] = decodeURIComponent(rawValue.join("="));
        return acc;
    }, {});
};

const getSessionToken = (request: Request): string | null => {
    const cookies = parseCookies(request.headers.get("cookie"));
    return cookies.session || null;
};

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const randomToken = (length = 32): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const digestSHA256 = async (value: string): Promise<Uint8Array> => {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return new Uint8Array(hash);
};

const hashPasswordSha256 = async (password: string, salt: string, pepper = ""): Promise<string> => {
    const digest = await digestSHA256(`${salt}:${password}:${pepper}`);
    return toBase64(digest);
};

const hashPasswordPbkdf2 = async (
    password: string,
    salt: string,
    pepper = "",
    iterations = DEFAULT_HASH_ITERATIONS
): Promise<string> => {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(`${password}:${pepper}`),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            iterations,
            salt: new TextEncoder().encode(salt)
        },
        keyMaterial,
        256
    );
    return toBase64(new Uint8Array(bits));
};

const getHashIterations = (env: Env): number => {
    const value = Number(env.PASSWORD_HASH_ITERATIONS || DEFAULT_HASH_ITERATIONS);
    if (!Number.isFinite(value)) return DEFAULT_HASH_ITERATIONS;
    const rounded = Math.round(value);
    return Math.min(300000, Math.max(60000, rounded));
};

const verifyPassword = async (
    user: UserRecord,
    password: string,
    pepper: string,
    iterations: number
): Promise<{ ok: boolean; shouldUpgrade: boolean }> => {
    if (user.hashAlgorithm === "pbkdf2") {
        const pbkdf2Hash = await hashPasswordPbkdf2(password, user.salt, pepper, user.hashIterations || iterations);
        return { ok: pbkdf2Hash === user.hash, shouldUpgrade: false };
    }

    const legacyHash = await hashPasswordSha256(password, user.salt, pepper);
    return { ok: legacyHash === user.hash, shouldUpgrade: legacyHash === user.hash };
};

let cachedDocKey: CryptoKey | null = null;

const getDocEncryptionKey = async (env: Env): Promise<CryptoKey> => {
    if (cachedDocKey) return cachedDocKey;
    const secret = env.PASSWORD_PEPPER || "";
    if (!secret) {
        throw new Error("缺少 PASSWORD_PEPPER，无法加密文档内容");
    }
    const digest = await digestSHA256(`doc:${secret}`);
    cachedDocKey = await crypto.subtle.importKey("raw", toArrayBuffer(digest), "AES-GCM", false, ["encrypt", "decrypt"]);
    return cachedDocKey;
};

const encryptDocContent = async (env: Env, content: string): Promise<string> => {
    const key = await getDocEncryptionKey(env);
    const iv = crypto.getRandomValues(new Uint8Array(DOC_IV_BYTES));
    const data = new TextEncoder().encode(content);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    return `${DOC_ENCRYPTION_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`;
};

const decryptDocContent = async (env: Env, payload: string): Promise<string> => {
    const body = payload.slice(DOC_ENCRYPTION_PREFIX.length);
    const [ivB64, cipherB64] = body.split(":");
    if (!ivB64 || !cipherB64) {
        throw new Error("文档密文格式不合法");
    }
    const key = await getDocEncryptionKey(env);
    const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(fromBase64(ivB64)) },
        key,
        toArrayBuffer(fromBase64(cipherB64))
    );
    return new TextDecoder().decode(plain);
};

const validateUsername = (username: string): boolean => /^[a-zA-Z0-9_-]{3,32}$/.test(username);

const getSessionCookie = (token: string, ttlSeconds: number): string => {
    const maxAge = Math.max(60, ttlSeconds);
    return `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}; Secure`;
};

const clearSessionCookie = "session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure";

const getSessionUser = async (request: Request, env: Env): Promise<string | null> => {
    const cookies = parseCookies(request.headers.get("cookie"));
    const token = cookies.session;
    if (!token) return null;
    return env.SESSIONS_KV.get(`session:${token}`);
};

const readJson = async <T>(request: Request): Promise<T | null> => {
    try {
        return (await request.json()) as T;
    } catch {
        return null;
    }
};

const saveUser = async (env: Env, user: UserRecord) => {
    await env.USERS_KV.put(`user:${user.username}`, JSON.stringify(user));
};

const ensureDefaultAdmin = async (env: Env) => {
    // Only bootstrap default admin when there are no users at all.
    // This keeps single-account semantics when username is changed from "admin".
    const existingUsers = await env.USERS_KV.list({ prefix: "user:", limit: 1 });
    if (existingUsers.keys.length > 0) return;

    const bootstrapPassword = (env.ADMIN_BOOTSTRAP_PASSWORD || "").trim();
    if (!bootstrapPassword) {
        throw new Error("缺少 ADMIN_BOOTSTRAP_PASSWORD，无法初始化首个账号");
    }

    const salt = randomToken(16);
    const iterations = getHashIterations(env);
    const hash = await hashPasswordPbkdf2(bootstrapPassword, salt, env.PASSWORD_PEPPER || "", iterations);
    await saveUser(env, {
        username: DEFAULT_ADMIN_USERNAME,
        salt,
        hash,
        createdAt: new Date().toISOString(),
        hashAlgorithm: "pbkdf2",
        hashIterations: iterations
    });
};

const saveDocMeta = async (env: Env, meta: DocMeta): Promise<void> => {
    await env.DOCS_KV.put(`doc:${meta.id}`, JSON.stringify(meta));
    await env.DOCS_KV.put(
        `owner:${meta.owner}:${meta.id}`,
        JSON.stringify({
            id: meta.id,
            title: meta.title,
            updatedAt: meta.updatedAt,
            shareToken: meta.shareToken ?? ""
        })
    );
};

const saveDoc = async (env: Env, meta: DocMeta, content: string): Promise<void> => {
    await saveDocMeta(env, meta);
    const encryptedContent = await encryptDocContent(env, content);
    await env.DOCS_BUCKET.put(`doc/${meta.owner}/${meta.id}.md`, encryptedContent, {
        httpMetadata: {
            contentType: "text/markdown; charset=utf-8"
        }
    });
};

const readDocContent = async (env: Env, owner: string, id: string): Promise<string | null> => {
    const object = await env.DOCS_BUCKET.get(`doc/${owner}/${id}.md`);
    if (!object) return null;
    const raw = await object.text();
    if (!raw.startsWith(DOC_ENCRYPTION_PREFIX)) {
        return raw;
    }
    return decryptDocContent(env, raw);
};

const getDocById = async (env: Env, id: string): Promise<DocMeta | null> => {
    const raw = await env.DOCS_KV.get(`doc:${id}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as DocMeta;
    } catch {
        return null;
    }
};

const handleLogin = async (request: Request, env: Env): Promise<Response> => {
    await ensureDefaultAdmin(env);
    const body = await readJson<{ username: string; password: string }>(request);
    if (!body) return badRequest("请求体不是合法 JSON");

    const username = (body.username || "").trim();
    const password = body.password || "";
    const raw = await env.USERS_KV.get(`user:${username}`);
    if (!raw) return json({ error: "用户名或密码错误" }, 401);

    let user: UserRecord;
    try {
        user = JSON.parse(raw) as UserRecord;
    } catch {
        return json({ error: "用户数据损坏" }, 500);
    }

    const iterations = getHashIterations(env);
    const verify = await verifyPassword(user, password, env.PASSWORD_PEPPER || "", iterations);
    if (!verify.ok) return json({ error: "用户名或密码错误" }, 401);

    if (verify.shouldUpgrade) {
        user.hash = await hashPasswordPbkdf2(password, user.salt, env.PASSWORD_PEPPER || "", iterations);
        user.hashAlgorithm = "pbkdf2";
        user.hashIterations = iterations;
        await saveUser(env, user);
    }

    const token = randomToken(24);
    const ttlSeconds = Number(env.SESSION_TTL_SECONDS || "259200");
    await env.SESSIONS_KV.put(`session:${token}`, user.username, {
        expirationTtl: ttlSeconds
    });

    const response = json({ ok: true, username: user.username });
    response.headers.set("set-cookie", getSessionCookie(token, ttlSeconds));
    return response;
};

const handleLogout = async (request: Request, env: Env): Promise<Response> => {
    const cookies = parseCookies(request.headers.get("cookie"));
    const token = cookies.session;
    if (token) {
        await env.SESSIONS_KV.delete(`session:${token}`);
    }
    const response = json({ ok: true });
    response.headers.set("set-cookie", clearSessionCookie);
    return response;
};

const handleMe = async (request: Request, env: Env): Promise<Response> => {
    await ensureDefaultAdmin(env);
    const username = await getSessionUser(request, env);
    if (!username) return unauthorized();
    return json({ username });
};

const handleChangePassword = async (request: Request, env: Env): Promise<Response> => {
    await ensureDefaultAdmin(env);
    const username = await getSessionUser(request, env);
    if (!username) return unauthorized();

    const body = await readJson<{ oldPassword: string; newPassword?: string; newUsername?: string }>(request);
    if (!body) return badRequest("请求体不是合法 JSON");

    const newUsername = (body.newUsername || username).trim();
    const newPassword = body.newPassword || "";

    if (!validateUsername(newUsername)) return badRequest("账号名格式不合法，需 3-32 位字母数字或 _-");
    if (newPassword && newPassword.length < 6) return badRequest("新密码至少 6 位");
    if (!newPassword && newUsername === username) return badRequest("未提供可更新内容");

    const raw = await env.USERS_KV.get(`user:${username}`);
    if (!raw) return unauthorized();

    const user = JSON.parse(raw) as UserRecord;
    const iterations = getHashIterations(env);
    const verifyOld = await verifyPassword(user, body.oldPassword || "", env.PASSWORD_PEPPER || "", iterations);
    if (!verifyOld.ok) return json({ error: "旧密码错误" }, 401);

    if (verifyOld.shouldUpgrade) {
        user.hash = await hashPasswordPbkdf2(body.oldPassword || "", user.salt, env.PASSWORD_PEPPER || "", iterations);
        user.hashAlgorithm = "pbkdf2";
        user.hashIterations = iterations;
    }

    const usernameChanged = newUsername !== username;
    const passwordChanged = !!newPassword;

    if (usernameChanged) {
        const existing = await env.USERS_KV.get(`user:${newUsername}`);
        if (existing) return badRequest("账号名已存在");
    }

    let nextSalt = user.salt;
    let nextHash = user.hash;
    let nextHashAlgorithm: UserRecord["hashAlgorithm"] = user.hashAlgorithm || "pbkdf2";
    let nextHashIterations: UserRecord["hashIterations"] = user.hashIterations || iterations;
    if (passwordChanged) {
        nextSalt = randomToken(16);
        nextHash = await hashPasswordPbkdf2(newPassword, nextSalt, env.PASSWORD_PEPPER || "", iterations);
        nextHashAlgorithm = "pbkdf2";
        nextHashIterations = iterations;
    }

    if (usernameChanged) {
        const list = await env.DOCS_KV.list({ prefix: `owner:${username}:`, limit: 1000 });
        for (const item of list.keys) {
            const id = item.name.replace(`owner:${username}:`, "");
            if (!id) continue;
            const meta = await getDocById(env, id);
            if (!meta || meta.owner !== username) continue;

            const content = (await readDocContent(env, username, id)) || "";

            const oldOwner = username;
            meta.owner = newUsername;
            await saveDoc(env, meta, content);

            await env.DOCS_KV.delete(`owner:${oldOwner}:${id}`);
            await env.DOCS_BUCKET.delete(`doc/${oldOwner}/${id}.md`);
        }
    }

    await saveUser(env, {
        ...user,
        username: newUsername,
        salt: nextSalt,
        hash: nextHash,
        hashAlgorithm: nextHashAlgorithm,
        hashIterations: nextHashIterations
    });

    // Enforce single-account mode: keep only the current account record.
    const users = await env.USERS_KV.list({ prefix: "user:", limit: 1000 });
    await Promise.all(
        users.keys
            .map((item) => item.name)
            .filter((key) => key !== `user:${newUsername}`)
            .map((key) => env.USERS_KV.delete(key))
    );

    if (usernameChanged) {
        const token = getSessionToken(request);
        if (token) {
            const ttlSeconds = Number(env.SESSION_TTL_SECONDS || "259200");
            await env.SESSIONS_KV.put(`session:${token}`, newUsername, { expirationTtl: ttlSeconds });
        }
    }

    return json({ ok: true, username: newUsername });
};

const handleDocList = async (request: Request, env: Env): Promise<Response> => {
    const username = await getSessionUser(request, env);
    if (!username) return unauthorized();

    const list = await env.DOCS_KV.list({ prefix: `owner:${username}:`, limit: 1000 });
    const docs = await Promise.all(
        list.keys.map(async (item) => {
            const raw = await env.DOCS_KV.get(item.name);
            if (!raw) return null;
            try {
                return JSON.parse(raw) as { id: string; title: string; updatedAt: string; shareToken?: string };
            } catch {
                return null;
            }
        })
    );

    return json({
        docs: docs
            .filter((item): item is { id: string; title: string; updatedAt: string; shareToken?: string } => !!item)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    });
};

const handleDocCreate = async (request: Request, env: Env): Promise<Response> => {
    const username = await getSessionUser(request, env);
    if (!username) return unauthorized();

    const body = await readJson<{ title: string; content: string }>(request);
    if (!body) return badRequest("请求体不是合法 JSON");

    const title = (body.title || "").trim() || "未命名文档";
    const content = body.content || "";
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const meta: DocMeta = {
        id,
        owner: username,
        title,
        createdAt: now,
        updatedAt: now
    };

    await saveDoc(env, meta, content);
    return json({ ok: true, doc: meta });
};

const handleDocGet = async (request: Request, env: Env, id: string): Promise<Response> => {
    const username = await getSessionUser(request, env);
    if (!username) return unauthorized();
    const meta = await getDocById(env, id);
    if (!meta || meta.owner !== username) return notFound();

    const content = await readDocContent(env, meta.owner, meta.id);
    if (content === null) return contentMissing();
    return json({ doc: meta, content });
};

const handleDocUpdate = async (request: Request, env: Env, id: string): Promise<Response> => {
    const username = await getSessionUser(request, env);
    if (!username) return unauthorized();

    const meta = await getDocById(env, id);
    if (!meta || meta.owner !== username) return notFound();

    const body = await readJson<{ title: string; content: string }>(request);
    if (!body) return badRequest("请求体不是合法 JSON");

    meta.title = (body.title || "").trim() || "未命名文档";
    meta.updatedAt = new Date().toISOString();
    await saveDoc(env, meta, body.content || "");
    return json({ ok: true, doc: meta });
};

const handleDocDelete = async (request: Request, env: Env, id: string): Promise<Response> => {
    const username = await getSessionUser(request, env);
    if (!username) return unauthorized();

    const meta = await getDocById(env, id);
    if (!meta || meta.owner !== username) return notFound();

    await env.DOCS_KV.delete(`doc:${id}`);
    await env.DOCS_KV.delete(`owner:${username}:${id}`);
    await env.DOCS_BUCKET.delete(`doc/${username}/${id}.md`);

    if (meta.shareToken) {
        await env.SHARES_KV.delete(`share:${meta.shareToken}`);
    }

    return json({ ok: true });
};

const handleDocShare = async (request: Request, env: Env, id: string): Promise<Response> => {
    const username = await getSessionUser(request, env);
    if (!username) return unauthorized();

    const meta = await getDocById(env, id);
    if (!meta || meta.owner !== username) return notFound();

    const hasBody = request.headers.get("content-length") !== null && request.headers.get("content-length") !== "0";
    let rotate = false;
    if (hasBody) {
        const body = await readJson<{ rotate?: boolean }>(request);
        if (!body) return badRequest("请求体不是合法 JSON");
        rotate = body.rotate === true;
    }

    let shareToken = meta.shareToken;
    const previousShareToken = shareToken;

    if (!shareToken || rotate) {
        shareToken = randomToken(18);
        meta.shareToken = shareToken;

        if (previousShareToken && previousShareToken !== shareToken) {
            await env.SHARES_KV.delete(`share:${previousShareToken}`);
        }

        await saveDocMeta(env, meta);
    }

    await env.SHARES_KV.put(`share:${shareToken}`, meta.id);
    const shareUrl = new URL(request.url);
    shareUrl.pathname = `/share/${shareToken}`;
    shareUrl.search = "";

    return json({ ok: true, shareUrl: shareUrl.toString(), shareToken });
};

const handlePublicDoc = async (env: Env, shareToken: string): Promise<Response> => {
    const docId = await env.SHARES_KV.get(`share:${shareToken}`);
    if (!docId) return notFound();

    const meta = await getDocById(env, docId);
    if (!meta || meta.shareToken !== shareToken) return notFound();

    const content = await readDocContent(env, meta.owner, meta.id);
    if (content === null) return contentMissing();

    return json({
        id: meta.id,
        title: meta.title,
        updatedAt: meta.updatedAt,
        content
    });
};

const handleApi = async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname === "/api/auth/login" && method === "POST") return handleLogin(request, env);
    if (url.pathname === "/api/auth/logout" && method === "POST") return handleLogout(request, env);
    if (url.pathname === "/api/auth/me" && method === "GET") return handleMe(request, env);
    if (url.pathname === "/api/auth/password" && method === "POST") return handleChangePassword(request, env);

    if (url.pathname === "/api/docs" && method === "GET") return handleDocList(request, env);
    if (url.pathname === "/api/docs" && method === "POST") return handleDocCreate(request, env);

    if (url.pathname.startsWith("/api/docs/")) {
        const rest = url.pathname.replace("/api/docs/", "");
        const [id, action] = rest.split("/");
        if (!id) return notFound();
        if (!action && method === "GET") return handleDocGet(request, env, id);
        if (!action && method === "PUT") return handleDocUpdate(request, env, id);
        if (!action && method === "DELETE") return handleDocDelete(request, env, id);
        if (action === "share" && method === "POST") return handleDocShare(request, env, id);
    }

    if (url.pathname.startsWith("/api/public/") && method === "GET") {
        const token = url.pathname.replace("/api/public/", "");
        if (!token) return notFound();
        return handlePublicDoc(env, token);
    }

    return notFound();
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        try {
            if (url.pathname.startsWith("/api/")) {
                return await handleApi(request, env);
            }

            if (
                url.pathname.startsWith("/share/") ||
                url.pathname.startsWith("/s/") ||
                url.pathname === "/docs" ||
                url.pathname.startsWith("/docs/") ||
                url.pathname === "/login" ||
                url.pathname === "/"
            ) {
                // Fetch the app shell from "/" instead of "/index.html" because
                // the asset layer may redirect /index.html -> / and strip the original route.
                const appShellReq = new Request(new URL("/", request.url), request);
                return env.ASSETS.fetch(appShellReq);
            }

            return env.ASSETS.fetch(request);
        } catch (error) {
            const message = error instanceof Error ? error.message : "unknown";
            return json({ error: `服务异常: ${message}` }, 500);
        }
    }
};
