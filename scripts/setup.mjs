import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const root = process.cwd();
const wranglerPath = join(root, "wrangler.toml");
const bootstrapWranglerPath = join(root, "wrangler.bootstrap.toml");

const randomSuffix = () => randomBytes(4).toString("hex");
const PLACEHOLDERS = [
    "REPLACE_USERS_KV_ID",
    "REPLACE_SESSIONS_KV_ID",
    "REPLACE_DOCS_KV_ID",
    "REPLACE_SHARES_KV_ID",
    "REPLACE_DOCS_BUCKET"
];

const run = (cmd) => {
    try {
        return execSync(cmd, {
            stdio: ["pipe", "pipe", "pipe"],
            encoding: "utf8"
        });
    } catch (error) {
        const message = error.stderr || error.stdout || error.message;
        throw new Error(message);
    }
};

const wrangler = (args) => run(`npx wrangler --config ${bootstrapWranglerPath} ${args}`);

const ensureWranglerLogin = () => {
    try {
        wrangler("whoami --json");
    } catch {
        console.error("未检测到 Wrangler 登录状态，请先执行: npx wrangler login --config wrangler.bootstrap.toml");
        process.exit(1);
    }
};

const parseKvNamespaceId = (output) => {
    const match = output.match(/id\s*=\s*"([^"]+)"/);
    if (!match) {
        throw new Error(`无法从输出中解析 KV Namespace ID:\n${output}`);
    }
    return match[1];
};

const ensureKv = (namespaceName) => {
    const output = wrangler(`kv namespace create ${namespaceName}`);
    return parseKvNamespaceId(output);
};

const ensureR2 = (bucketName) => {
    wrangler(`r2 bucket create ${bucketName}`);
    return bucketName;
};

const listSecrets = () => {
    try {
        const output = wrangler("secret list --format json");
        const parsed = JSON.parse(output);
        if (Array.isArray(parsed)) {
            return parsed;
        }
        return [];
    } catch {
        return [];
    }
};

const hasSecret = (name) => listSecrets().some((item) => item && item.name === name);

const updateWranglerToml = (replacements) => {
    let content = readFileSync(wranglerPath, "utf8");
    for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(key, value);
    }
    writeFileSync(wranglerPath, content, "utf8");
};

const main = async () => {
    ensureWranglerLogin();

    const wranglerToml = readFileSync(wranglerPath, "utf8");
    const needsCreateResources = PLACEHOLDERS.some((placeholder) => wranglerToml.includes(placeholder));

    if (!needsCreateResources) {
        console.log("wrangler.toml 已存在资源 ID，跳过自动创建。若需重建，请先恢复占位符。\n");
    }

    const suffix = randomSuffix();
    const usersKvName = `markdown-box-users-${suffix}`;
    const sessionsKvName = `markdown-box-sessions-${suffix}`;
    const docsKvName = `markdown-box-docs-${suffix}`;
    const sharesKvName = `markdown-box-shares-${suffix}`;
    const bucketName = `markdown-box-${suffix}`;

    if (needsCreateResources) {
        const usersKvId = ensureKv(usersKvName);
        const sessionsKvId = ensureKv(sessionsKvName);
        const docsKvId = ensureKv(docsKvName);
        const sharesKvId = ensureKv(sharesKvName);
        ensureR2(bucketName);

        updateWranglerToml({
            REPLACE_USERS_KV_ID: usersKvId,
            REPLACE_SESSIONS_KV_ID: sessionsKvId,
            REPLACE_DOCS_KV_ID: docsKvId,
            REPLACE_SHARES_KV_ID: sharesKvId,
            REPLACE_DOCS_BUCKET: bucketName
        });
    }

    if (process.env.PASSWORD_PEPPER) {
        const pepper = process.env.PASSWORD_PEPPER;
        const wranglerProc = spawn("npx", ["wrangler", "--config", bootstrapWranglerPath, "secret", "put", "PASSWORD_PEPPER"], {
            stdio: ["pipe", "inherit", "inherit"],
            shell: true
        });
        wranglerProc.stdin.write(pepper);
        wranglerProc.stdin.end();
        await new Promise((resolve, reject) => {
            wranglerProc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`wrangler exit code: ${code}`)));
        });
        console.log("已使用环境变量 PASSWORD_PEPPER 覆盖现有密钥。\n");
    } else if (!hasSecret("PASSWORD_PEPPER")) {
        const pepper = randomBytes(24).toString("base64url");
        const wranglerProc = spawn("npx", ["wrangler", "--config", bootstrapWranglerPath, "secret", "put", "PASSWORD_PEPPER"], {
            stdio: ["pipe", "inherit", "inherit"],
            shell: true
        });
        wranglerProc.stdin.write(pepper);
        wranglerProc.stdin.end();
        await new Promise((resolve, reject) => {
            wranglerProc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`wrangler exit code: ${code}`)));
        });
        console.log("已自动生成并写入随机 PASSWORD_PEPPER。\n");
    } else {
        console.log("检测到 PASSWORD_PEPPER 已存在，本次保持不变。\n");
    }

    console.log("Cloudflare 资源初始化完成。\n");
    console.log("下一步直接执行: npm run deploy");
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
