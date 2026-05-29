import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const wranglerPath = join(root, "wrangler.toml");
const bootstrapWranglerPath = join(root, "wrangler.bootstrap.toml");
const wranglerCachePath = join(root, ".wrangler");

const PLACEHOLDERS = {
    USERS_KV: "REPLACE_USERS_KV_ID",
    SESSIONS_KV: "REPLACE_SESSIONS_KV_ID",
    DOCS_KV: "REPLACE_DOCS_KV_ID",
    SHARES_KV: "REPLACE_SHARES_KV_ID",
    DOCS_BUCKET: "REPLACE_DOCS_BUCKET"
};

const log = (message) => console.log(message);

const runWrangler = (args, { input, allowFailure = false } = {}) => {
    const result = spawnSync("npx", ["wrangler", "--config", bootstrapWranglerPath, ...args], {
        cwd: root,
        encoding: "utf8",
        input
    });

    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    if (result.status !== 0 && !allowFailure) {
        throw new Error((stderr || stdout || `命令执行失败: wrangler ${args.join(" ")}`).trim());
    }

    return {
        status: result.status ?? 1,
        stdout,
        stderr
    };
};

const ensureWranglerLogin = () => {
    const result = runWrangler(["whoami", "--json"], { allowFailure: true });
    if (result.status === 0) return;

    console.error("未检测到 Wrangler 登录状态，请先执行: npx wrangler login --config wrangler.bootstrap.toml");
    process.exit(1);
};

const readWranglerToml = () => readFileSync(wranglerPath, "utf8");

const extractByRegex = (content, regex) => content.match(regex)?.[1] ?? null;

const extractWorkerName = (content) => extractByRegex(content, /^name = "([^"]+)"/m);

const extractKvId = (content, binding) =>
    extractByRegex(content, new RegExp(`\\[\\[kv_namespaces\\]\\]\\s*binding = "${binding}"\\s*id = "([^"]+)"`, "m"));

const extractBucketName = (content) =>
    extractByRegex(content, /\[\[r2_buckets\]\]\s*binding = "DOCS_BUCKET"\s*bucket_name = "([^"]+)"/m);

const isPlaceholder = (value) => !value || value.startsWith("REPLACE_");

const safeDelete = (label, args, options = {}) => {
    const result = runWrangler(args, { ...options, allowFailure: true });
    if (result.status === 0) {
        log(`已删除 ${label}`);
        return true;
    }

    const message = (result.stderr || result.stdout || "").trim();
    log(`跳过 ${label}: ${message || "资源不存在或已删除"}`);
    return false;
};

const listDocMetaKeys = (docsKvId) => {
    if (isPlaceholder(docsKvId)) return [];

    const result = runWrangler(["kv", "key", "list", "--namespace-id", docsKvId, "--remote", "--prefix", "doc:"], {
        allowFailure: true
    });

    if (result.status !== 0 || !result.stdout.trim()) return [];

    try {
        const parsed = JSON.parse(result.stdout);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item) => item?.name).filter(Boolean);
    } catch {
        return [];
    }
};

const readDocMeta = (docsKvId, key) => {
    const result = runWrangler(["kv", "key", "get", key, "--namespace-id", docsKvId, "--remote", "--text"], {
        allowFailure: true
    });

    if (result.status !== 0 || !result.stdout.trim()) return null;

    try {
        return JSON.parse(result.stdout);
    } catch {
        return null;
    }
};

const deleteBucketObjects = (bucketName, docsKvId) => {
    if (isPlaceholder(bucketName) || isPlaceholder(docsKvId)) return;

    const metaKeys = listDocMetaKeys(docsKvId);
    if (!metaKeys.length) {
        log("未发现可清理的 R2 文档对象索引，继续执行 bucket 删除。");
        return;
    }

    for (const key of metaKeys) {
        const meta = readDocMeta(docsKvId, key);
        if (!meta?.owner || !meta?.id) continue;

        safeDelete(`R2 对象 doc/${meta.owner}/${meta.id}.md`, [
            "r2",
            "object",
            "delete",
            `${bucketName}/doc/${meta.owner}/${meta.id}.md`,
            "--remote",
            "-y"
        ]);
    }
};

const resetWranglerToml = () => {
    let content = readWranglerToml();

    const replaceKv = (binding, placeholder) => {
        content = content.replace(
            new RegExp(`(\\[\\[kv_namespaces\\]\\]\\s*binding = "${binding}"\\s*id = ")[^"]+(")`, "m"),
            `$1${placeholder}$2`
        );
    };

    replaceKv("USERS_KV", PLACEHOLDERS.USERS_KV);
    replaceKv("SESSIONS_KV", PLACEHOLDERS.SESSIONS_KV);
    replaceKv("DOCS_KV", PLACEHOLDERS.DOCS_KV);
    replaceKv("SHARES_KV", PLACEHOLDERS.SHARES_KV);

    content = content.replace(
        /(\[\[r2_buckets\]\]\s*binding = "DOCS_BUCKET"\s*bucket_name = ")[^"]+(")/m,
        `$1${PLACEHOLDERS.DOCS_BUCKET}$2`
    );

    writeFileSync(wranglerPath, content, "utf8");
    log("已将 wrangler.toml 恢复为资源占位状态。");
};

const main = () => {
    ensureWranglerLogin();

    const wranglerToml = readWranglerToml();
    const workerName = extractWorkerName(wranglerToml);
    const usersKvId = extractKvId(wranglerToml, "USERS_KV");
    const sessionsKvId = extractKvId(wranglerToml, "SESSIONS_KV");
    const docsKvId = extractKvId(wranglerToml, "DOCS_KV");
    const sharesKvId = extractKvId(wranglerToml, "SHARES_KV");
    const bucketName = extractBucketName(wranglerToml);

    log("开始删除 Cloudflare 资源...\n");

    if (workerName) {
        safeDelete(`Secret PASSWORD_PEPPER (${workerName})`, ["secret", "delete", "PASSWORD_PEPPER", "--name", workerName], {
            input: "y\n"
        });
        safeDelete(`Secret ADMIN_BOOTSTRAP_PASSWORD (${workerName})`, ["secret", "delete", "ADMIN_BOOTSTRAP_PASSWORD", "--name", workerName], {
            input: "y\n"
        });
        safeDelete(`Worker ${workerName}`, ["delete", workerName, "--force"]);
    }

    deleteBucketObjects(bucketName, docsKvId);

    if (!isPlaceholder(bucketName)) {
        safeDelete(`R2 Bucket ${bucketName}`, ["r2", "bucket", "delete", bucketName], { input: "y\n" });
    }

    if (!isPlaceholder(usersKvId)) safeDelete(`KV USERS_KV (${usersKvId})`, ["kv", "namespace", "delete", "--namespace-id", usersKvId, "-y"]);
    if (!isPlaceholder(sessionsKvId)) safeDelete(`KV SESSIONS_KV (${sessionsKvId})`, ["kv", "namespace", "delete", "--namespace-id", sessionsKvId, "-y"]);
    if (!isPlaceholder(docsKvId)) safeDelete(`KV DOCS_KV (${docsKvId})`, ["kv", "namespace", "delete", "--namespace-id", docsKvId, "-y"]);
    if (!isPlaceholder(sharesKvId)) safeDelete(`KV SHARES_KV (${sharesKvId})`, ["kv", "namespace", "delete", "--namespace-id", sharesKvId, "-y"]);

    resetWranglerToml();

    if (existsSync(wranglerCachePath)) {
        rmSync(wranglerCachePath, { recursive: true, force: true });
        log("已删除本地 .wrangler 缓存目录。");
    }

    log("\nCloudflare 资源清理完成。现在可以重新执行 npm run setup && npm run deploy 做从零测试。");
};

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
}