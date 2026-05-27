import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const root = process.cwd();
const wranglerPath = join(root, "wrangler.toml");
const bootstrapWranglerPath = join(root, "wrangler.bootstrap.toml");
const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

const randomSuffix = () => randomBytes(4).toString("hex");
const DEFAULT_BUCKET_NAME = "markdownbox";
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

const wrangler = (args) => run(`${npxBin} wrangler --config "${bootstrapWranglerPath}" ${args}`);

const putSecret = async (name, value) => {
    // Windows 上 spawn(npx.cmd, ...) 在部分环境会抛 EINVAL，改为 execSync + input。
    execSync(`${npxBin} wrangler --config "${bootstrapWranglerPath}" secret put ${name}`, {
        stdio: ["pipe", "inherit", "inherit"],
        input: value,
        encoding: "utf8"
    });
};

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
    try {
        wrangler(`r2 bucket create ${bucketName}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already exists, and you own it|bucket you tried to create already exists|code:\s*10004/i.test(message)) {
            return bucketName;
        }
        throw error;
    }
    return bucketName;
};

const parseBucketNameFromWrangler = (content) => {
    const match = content.match(/bucket_name\s*=\s*"([^"]+)"/);
    return match ? match[1] : DEFAULT_BUCKET_NAME;
};

const hasR2Bucket = (bucketName) => {
    try {
        const output = wrangler("r2 bucket list --json");
        const normalized = String(output || "");
        const start = normalized.indexOf("[");
        const end = normalized.lastIndexOf("]");
        if (start >= 0 && end > start) {
            const parsed = JSON.parse(normalized.slice(start, end + 1));
            if (Array.isArray(parsed)) {
                return parsed.some((item) => item && item.name === bucketName);
            }
        }

        // 兼容某些 wrangler 版本/输出格式不是纯 JSON 的情况。
        const plainOutput = wrangler("r2 bucket list");
        const escaped = bucketName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`name:\\s+${escaped}(?:\\s|$)`, "i").test(plainOutput);
    } catch {
        return false;
    }
};

const ensureR2BucketExists = (bucketName) => {
    if (hasR2Bucket(bucketName)) {
        return bucketName;
    }
    return ensureR2(bucketName);
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
    const configuredBucketName = parseBucketNameFromWrangler(wranglerToml);
    const bucketName = !configuredBucketName || configuredBucketName === "REPLACE_DOCS_BUCKET"
        ? DEFAULT_BUCKET_NAME
        : configuredBucketName;

    const usersKvName = `markdown-box-users-${suffix}`;
    const sessionsKvName = `markdown-box-sessions-${suffix}`;
    const docsKvName = `markdown-box-docs-${suffix}`;
    const sharesKvName = `markdown-box-shares-${suffix}`;

    if (needsCreateResources) {
        const usersKvId = ensureKv(usersKvName);
        const sessionsKvId = ensureKv(sessionsKvName);
        const docsKvId = ensureKv(docsKvName);
        const sharesKvId = ensureKv(sharesKvName);
        ensureR2BucketExists(bucketName);

        updateWranglerToml({
            REPLACE_USERS_KV_ID: usersKvId,
            REPLACE_SESSIONS_KV_ID: sessionsKvId,
            REPLACE_DOCS_KV_ID: docsKvId,
            REPLACE_SHARES_KV_ID: sharesKvId,
            REPLACE_DOCS_BUCKET: bucketName
        });
    }

    // 无论是否占位符模式，都保证 wrangler.toml 配置的 bucket 存在。
    ensureR2BucketExists(bucketName);

    if (process.env.PASSWORD_PEPPER) {
        const pepper = process.env.PASSWORD_PEPPER;
        await putSecret("PASSWORD_PEPPER", pepper);
        console.log("已使用环境变量 PASSWORD_PEPPER 覆盖现有密钥。\n");
    } else if (!hasSecret("PASSWORD_PEPPER")) {
        const pepper = randomBytes(24).toString("base64url");
        await putSecret("PASSWORD_PEPPER", pepper);
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
