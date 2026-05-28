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

const parseJsonArrayFromOutput = (output) => {
    const normalized = String(output || "");
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
    const text = String(output || "").trim();
    if (!text) {
        return [];
    }

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return parsed;
        }
        if (parsed && Array.isArray(parsed.namespaces)) {
            return parsed.namespaces;
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
    let content = readFileSync(wranglerPath, "utf8");
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
        writeFileSync(wranglerPath, content, "utf8");
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

    console.log("Cloudflare 资源初始化完成。\n");
    console.log("下一步直接执行: npm run deploy");
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
