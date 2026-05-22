import { execSync } from "node:child_process";

const BOOTSTRAP_CONFIG = "wrangler.bootstrap.toml";

const run = (command, stdio = "inherit") => {
    execSync(command, {
        stdio,
        encoding: "utf8"
    });
};

const isAuthorized = () => {
    try {
        run(`npx wrangler whoami --config ${BOOTSTRAP_CONFIG}`, "pipe");
        return true;
    } catch {
        return false;
    }
};

const ensureLogin = () => {
    if (isAuthorized()) {
        console.log("已检测到 Wrangler 授权，跳过登录。\n");
        return;
    }

    console.log("未检测到 Wrangler 授权，开始登录流程...\n");
    run(`npx wrangler login --config ${BOOTSTRAP_CONFIG}`);
};

const main = () => {
    ensureLogin();
    run("npm install");
    run("npm run setup");
    run("npm run deploy");
};

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
}
