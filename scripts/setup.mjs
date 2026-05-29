import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const root = process.cwd();
const wranglerPath = join(root, "wrangler.toml");
const bootstrapWranglerPath = join(root, "wrangler.bootstrap.toml");
const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

const DEFAULT_BUCKET_NAME = "markdownbox";
const PLACEHOLDERS = [
    "REPLACE_DOCS_BUCKET"
];
const NAMESPACE_ID_REGEX = /^[0-9a-f]{32}$/i;

const sanitizeWranglerOutput = (output) =>
    String(output || "")
        .replace(/^\uFEFF/, "")
        .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const normalizeTomlText = (content) =>
    String(content || "")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const hasIllegalControlChar = (text) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);

const validateNamespaceId = (id, context = "") => {
    const normalized = String(id || "").trim();
    if (!NAMESPACE_ID_REGEX.test(normalized)) {
        throw new Error(
            `检测到非法 KV Namespace ID${context ? ` (${context})` : ""}: "${normalized}"，必须是 32 位十六进制字符串`
        );
    }
    return normalized;
};

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
    const cleaned = sanitizeWranglerOutput(output);
    const match = cleaned.match(/id\s*=\s*"([^"]+)"/);
    if (!match) {
        throw new Error(`无法从输出中解析 KV Namespace ID:\n${cleaned}`);
    }
    return validateNamespaceId(match[1], "kv namespace create 输出");
};

const ensureKv = (namespaceName) => {
    const output = wrangler(`kv namespace create ${namespaceName}`);
    return parseKvNamespaceId(output);
};

const parseJsonArrayFromOutput = (output) => {
    const normalized = sanitizeWranglerOutput(output);
    const start = normalized.indexOf("[");
    const end = normalized.lastIndexOf("]");
    if (start < 0 || end <= start) {
        return null;
    }

    try {
        const parsed = JSON.parse(normalized.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const parseKvNamespacesFromOutput = (output) => {
    const text = sanitizeWranglerOutput(output).trim();
    if (!text) {
        return [];
    }

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => item && (!item.id || NAMESPACE_ID_REGEX.test(String(item.id).trim())));
        }
        if (parsed && Array.isArray(parsed.namespaces)) {
            return parsed.namespaces.filter((item) => item && (!item.id || NAMESPACE_ID_REGEX.test(String(item.id).trim())));
        }
    } catch {
        // 某些版本输出会混杂日志，继续尝试提取 JSON 数组。
    }

    const fromSlice = parseJsonArrayFromOutput(text);
    return fromSlice || [];
};

const listKvNamespaces = () => {
    const candidates = [
        "kv namespace list",
        "kv namespace list --format json",
        "kv namespace list --json"
    ];

    for (const args of candidates) {
        try {
            const output = wrangler(args);
            const parsed = parseKvNamespacesFromOutput(output);
            if (parsed) {
                return parsed;
            }
        } catch {
            // 尝试下一个兼容参数。
        }
    }

    return [];
};

const parseKvBindingsFromWrangler = (content) => {
    const blocks = content.match(/\[\[kv_namespaces\]\][\s\S]*?(?=\n\s*\[\[|\n\s*\[|$)/g) || [];
    return blocks
        .map((block) => {
            const bindingMatch = block.match(/^\s*binding\s*=\s*"([^"]+)"/m);
            if (!bindingMatch) {
                return null;
            }
            const idMatch = block.match(/^\s*id\s*=\s*"([^"]*)"/m);
            return {
                binding: bindingMatch[1],
                id: idMatch ? idMatch[1] : ""
            };
        })
        .filter(Boolean);
};

const isMissingKvId = (id) => !id || /^REPLACE_/i.test(id);

const updateKvNamespaceIdsInWrangler = (idByBinding) => {
    Object.entries(idByBinding).forEach(([binding, id]) => {
        validateNamespaceId(id, binding);
    });

    let content = normalizeTomlText(readFileSync(wranglerPath, "utf8"));
    let changed = false;

    content = content.replace(/\[\[kv_namespaces\]\][\s\S]*?(?=\n\s*\[\[|\n\s*\[|$)/g, (block) => {
        const bindingMatch = block.match(/^\s*binding\s*=\s*"([^"]+)"/m);
        if (!bindingMatch) {
            return block;
        }

        const binding = bindingMatch[1];
        const nextId = idByBinding[binding];
        if (!nextId) {
            return block;
        }

        changed = true;
        if (/^\s*id\s*=\s*"[^"]*"/m.test(block)) {
            return block.replace(/^\s*id\s*=\s*"[^"]*"/m, `id = "${nextId}"`);
        }

        return block.replace(/^\s*binding\s*=\s*"[^"]+"/m, (line) => `${line}\nid = "${nextId}"`);
    });

    if (changed) {
        const nextContent = normalizeTomlText(content);
        if (hasIllegalControlChar(nextContent)) {
            throw new Error("wrangler.toml 包含非法控制字符，已阻止写入");
        }
        writeFileSync(wranglerPath, nextContent, "utf8");
    }
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
const generateBootstrapPassword = () => `${randomBytes(12).toString("base64url")}A1!`;

const ensureKvNamespacesByBinding = (wranglerToml) => {
    const kvEntries = parseKvBindingsFromWrangler(wranglerToml);
    const missingEntries = kvEntries.filter((item) => isMissingKvId(item.id));
    if (missingEntries.length === 0) {
        console.log("KV Namespace ID 已配置，跳过回填。\n");
        return;
    }

    const existing = listKvNamespaces();
    const idByBinding = {};

    for (const entry of missingEntries) {
        const matched = existing.find((item) => item && item.title === entry.binding && item.id);
        if (matched) {
            idByBinding[entry.binding] = matched.id;
            console.log(`检测到已存在 KV Namespace（${entry.binding}），已回填 ID。`);
            continue;
        }

        const createdId = ensureKv(entry.binding);
        idByBinding[entry.binding] = createdId;
        console.log(`未找到 ${entry.binding} 对应 Namespace，已自动创建并写回 ID。`);
    }

    updateKvNamespaceIdsInWrangler(idByBinding);
    console.log("");
};

const updateWranglerToml = (replacements) => {
    let content = normalizeTomlText(readFileSync(wranglerPath, "utf8"));
    for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(key, value);
    }
    if (hasIllegalControlChar(content)) {
        throw new Error("wrangler.toml 包含非法控制字符，已阻止写入");
    }
    writeFileSync(wranglerPath, content, "utf8");
};

const normalizeWranglerTomlOnDisk = () => {
    const current = readFileSync(wranglerPath, "utf8");
    const normalized = normalizeTomlText(current);
    if (current !== normalized) {
        writeFileSync(wranglerPath, normalized, "utf8");
    }
};

const main = async () => {
    ensureWranglerLogin();
    normalizeWranglerTomlOnDisk();

    const wranglerToml = readFileSync(wranglerPath, "utf8");
    const needsCreateResources = PLACEHOLDERS.some((placeholder) => wranglerToml.includes(placeholder));

    ensureKvNamespacesByBinding(wranglerToml);

    const configuredBucketName = parseBucketNameFromWrangler(wranglerToml);
    const bucketName = !configuredBucketName || configuredBucketName === "REPLACE_DOCS_BUCKET"
        ? DEFAULT_BUCKET_NAME
        : configuredBucketName;

    if (needsCreateResources) {
        ensureR2BucketExists(bucketName);

        updateWranglerToml({
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

    if (process.env.ADMIN_BOOTSTRAP_PASSWORD) {
        await putSecret("ADMIN_BOOTSTRAP_PASSWORD", process.env.ADMIN_BOOTSTRAP_PASSWORD);
        console.log("已使用环境变量 ADMIN_BOOTSTRAP_PASSWORD 覆盖首次登录密码。\n");
    } else if (!hasSecret("ADMIN_BOOTSTRAP_PASSWORD")) {
        const bootstrapPassword = generateBootstrapPassword();
        await putSecret("ADMIN_BOOTSTRAP_PASSWORD", bootstrapPassword);
        console.log("已自动生成首次登录密码并写入 ADMIN_BOOTSTRAP_PASSWORD。\n");
        console.log(`首次登录账号: admin`);
        console.log(`首次登录密码: ${bootstrapPassword}\n`);
    } else {
        console.log("检测到 ADMIN_BOOTSTRAP_PASSWORD 已存在，本次保持不变。\n");
    }

    console.log("Cloudflare 资源初始化完成。\n");
    console.log("下一步直接执行: npm run deploy");
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
